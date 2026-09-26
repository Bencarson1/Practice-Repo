-- =====================================================================
-- NebedaHub — worldwide: currencies, exchange rates, yards or metres
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it after setup.sql, yards.sql, prices.sql, tailor-quote.sql,
-- tailors-near-me.sql and no-leakage.sql, then merge the app update
-- straight away.
--
-- What it does:
--   1. Currencies (GBP, NGN, GHS, USD, EUR, CAD, ZAR, KES … — every
--      currency used by a country in the countries table), with their
--      symbol and how money is written: £1,250 / ₦250,000 / $1,250.00.
--      Each country gets its currency, its phone code (+44, +234 …) and
--      whether fabric is sold there in yards (UK, Nigeria, Ghana, USA)
--      or metres (everywhere else).
--   2. A currency on every tailor, fabric seller, price list row, fabric,
--      order, invoice, payment, seller order line and ready-to-wear item.
--      New tailors and sellers get their country's currency; they can
--      change it in their profile (their prices are converted for them).
--      EVERYTHING ALREADY IN THE DATABASE IS GBP, AND ITS MONEY IS NOT
--      CHANGED (the report checks this).
--   3. Exchange rates: a small table with one rate per currency (against
--      the US dollar), updated every day by the GitHub Action
--      "Exchange rates" (scripts/update-exchange-rates.mjs). Everyone can
--      read them; only that Action (with the secret key) can change them.
--   4. Orders and quotes are priced and charged in the TAILOR's currency.
--      When a tailor's quote uses fabric from a seller in another
--      currency, THE DATABASE converts the fabric cost when the quote is
--      sent (wearvia_send_quote), saves the exchange rate on the order and
--      shows it on the quote. The seller is still paid in their own
--      currency (their order line keeps it). Walk-in orders work the same.
--   5. Fabric length: stock is always stored in yards. A tailor in a
--      metre country types metres in the quote (the app shows metres
--      everywhere for them), and the database converts exactly.
--   6. Customers: country, currency and inches or centimetres for body
--      measurements (measurements are always stored in inches).
--   7. A report at the end. It tries the whole thing for real — a London
--      tailor (GBP) and a Lagos tailor (NGN) quoting fabric from a Lagos
--      seller (NGN) — and then undoes it. Every line should say OK.
--
-- Safe to run more than once. Nothing is deleted, and existing orders,
-- invoices, payments, prices, fabrics and measurements are never changed
-- (the report checks this). Everything runs in one transaction: if any
-- step fails, nothing is changed.
--
-- If you ever run an earlier file again, run this one straight after it:
-- the earlier files put back their own versions of the order and quote
-- functions.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. A copy of what must not change, for the report at the end
--    (temporary tables: they disappear when you close the SQL Editor tab)
-- ---------------------------------------------------------------------
drop table if exists pg_temp.wv_ww_before;
create temp table wv_ww_before as
  select 'order' as kind, id::text as id, md5(row(designer_id, customer_id, order_number, fabric_id, fabric_yards, fabric_cost,
           tailoring_cost, embroidery_cost, delivery_cost, quote_total, deposit_amount, line_items, deposit_paid_at,
           balance_paid_at, stage, quote_status)::text) as fingerprint
  from public.orders
  union all select 'invoice', id::text, md5(row(order_id, total, line_items)::text) from public.invoices
  union all select 'payment', id::text, md5(row(order_id, amount, status)::text) from public.payments
  union all select 'price', id::text, md5(row(designer_id, kind, name, price, yards)::text) from public.price_list
  union all select 'fabric', id::text, md5(row(price_per_yard, yards_available, min_order_yards)::text) from public.fabrics
  union all select 'seller line', id::text, md5(row(yards, price_per_yard, total, status)::text) from public.fabric_order_lines
  union all select 'ready to wear', id::text, md5(row(price, cost, stock)::text) from public.ready_to_wear_items
  union all select 'ready to wear sale', id::text, md5(row(price, cost, status)::text) from public.ready_to_wear_sales
  union all select 'measurements', id::text, md5(row(chest, waist, shoulder, sleeve, trouser_length, neck, hip, garment_length)::text)
            from public.measurement_profiles;

-- When this file first ran: orders, invoices and payments from before then are GBP
create table if not exists public.wv_worldwide_runs (ran_at timestamptz primary key default now());
alter table public.wv_worldwide_runs enable row level security;
revoke all on public.wv_worldwide_runs from public, anon, authenticated;
insert into public.wv_worldwide_runs (ran_at) values (now()) on conflict do nothing;


-- ---------------------------------------------------------------------
-- 1. Currencies
-- ---------------------------------------------------------------------

create table if not exists public.currencies (
  code        text primary key check (code ~ '^[A-Z]{3}$'),   -- ISO 4217, e.g. GBP
  name        text not null,
  symbol      text not null,                                 -- £, ₦, GH₵, $, €, CA$, R, KSh …
  decimals    smallint not null default 2 check (decimals between 0 and 2),   -- ₦250,000 has none; $1,250.00 has two
  trim_zeros  boolean not null default false,                -- £1,250 rather than £1,250.00 when there are no pence
  sort_order  integer not null default 100
);

-- Only added if missing, so a symbol the admin has changed is kept
insert into public.currencies (code, name, symbol, decimals, trim_zeros, sort_order) values
  ('AED', 'United Arab Emirates Dirham', 'AED', 2, false, 100),
  ('AFN', 'Afghan Afghani', '؋', 0, false, 100),
  ('ALL', 'Albanian Lek', 'ALL', 0, false, 100),
  ('AMD', 'Armenian Dram', '֏', 2, false, 100),
  ('AOA', 'Angolan Kwanza', 'Kz', 2, false, 100),
  ('ARS', 'Argentine Peso', 'ARS', 2, false, 100),
  ('AUD', 'Australian Dollar', 'A$', 2, false, 100),
  ('AWG', 'Aruban Florin', 'AWG', 2, false, 100),
  ('AZN', 'Azerbaijani Manat', '₼', 2, false, 100),
  ('BAM', 'Bosnia-Herzegovina Convertible Mark', 'KM', 2, false, 100),
  ('BBD', 'Barbadian Dollar', 'BBD', 2, false, 100),
  ('BDT', 'Bangladeshi Taka', '৳', 2, false, 100),
  ('BHD', 'Bahraini Dinar', 'BHD', 2, false, 100),
  ('BIF', 'Burundian Franc', 'BIF', 0, false, 100),
  ('BMD', 'Bermudan Dollar', 'BMD', 2, false, 100),
  ('BND', 'Brunei Dollar', 'BND', 2, false, 100),
  ('BOB', 'Bolivian Boliviano', 'Bs', 2, false, 100),
  ('BRL', 'Brazilian Real', 'R$', 2, false, 100),
  ('BSD', 'Bahamian Dollar', 'BSD', 2, false, 100),
  ('BTN', 'Bhutanese Ngultrum', 'BTN', 2, false, 100),
  ('BWP', 'Botswanan Pula', 'P', 2, false, 100),
  ('BYN', 'Belarusian Ruble', 'BYN', 2, false, 100),
  ('BZD', 'Belize Dollar', 'BZD', 2, false, 100),
  ('CAD', 'Canadian Dollar', 'CA$', 2, false, 6),
  ('CDF', 'Congolese Franc', 'CDF', 2, false, 100),
  ('CHF', 'Swiss Franc', 'CHF', 2, false, 100),
  ('CLP', 'Chilean Peso', 'CLP', 0, false, 100),
  ('CNY', 'Chinese Yuan', 'CN¥', 2, false, 100),
  ('COP', 'Colombian Peso', 'COP', 0, false, 100),
  ('CRC', 'Costa Rican Colón', '₡', 2, false, 100),
  ('CUP', 'Cuban Peso', 'CUP', 2, false, 100),
  ('CVE', 'Cape Verdean Escudo', 'CVE', 2, false, 100),
  ('CZK', 'Czech Koruna', 'Kč', 2, false, 100),
  ('DJF', 'Djiboutian Franc', 'DJF', 0, false, 100),
  ('DKK', 'Danish Krone', 'DKK', 2, false, 100),
  ('DOP', 'Dominican Peso', 'DOP', 2, false, 100),
  ('DZD', 'Algerian Dinar', 'DZD', 2, false, 100),
  ('EGP', 'Egyptian Pound', 'E£', 2, false, 100),
  ('ERN', 'Eritrean Nakfa', 'ERN', 2, false, 100),
  ('ETB', 'Ethiopian Birr', 'ETB', 2, false, 100),
  ('EUR', 'Euro', '€', 2, false, 5),
  ('FJD', 'Fijian Dollar', 'FJD', 2, false, 100),
  ('FKP', 'Falkland Islands Pound', 'FKP', 2, false, 100),
  ('GBP', 'British Pound', '£', 2, true, 1),
  ('GEL', 'Georgian Lari', '₾', 2, false, 100),
  ('GHS', 'Ghanaian Cedi', 'GH₵', 2, false, 3),
  ('GIP', 'Gibraltar Pound', 'GIP', 2, false, 100),
  ('GMD', 'Gambian Dalasi', 'GMD', 2, false, 100),
  ('GNF', 'Guinean Franc', 'FG', 0, false, 100),
  ('GTQ', 'Guatemalan Quetzal', 'Q', 2, false, 100),
  ('GYD', 'Guyanaese Dollar', 'GYD', 2, false, 100),
  ('HKD', 'Hong Kong Dollar', 'HK$', 2, false, 100),
  ('HNL', 'Honduran Lempira', 'L', 2, false, 100),
  ('HTG', 'Haitian Gourde', 'HTG', 2, false, 100),
  ('HUF', 'Hungarian Forint', 'Ft', 0, false, 100),
  ('IDR', 'Indonesian Rupiah', 'Rp', 0, false, 100),
  ('ILS', 'Israeli New Shekel', '₪', 2, false, 100),
  ('INR', 'Indian Rupee', '₹', 2, false, 100),
  ('IQD', 'Iraqi Dinar', 'IQD', 0, false, 100),
  ('IRR', 'Iranian Rial', 'IRR', 0, false, 100),
  ('ISK', 'Icelandic Króna', 'ISK', 0, false, 100),
  ('JMD', 'Jamaican Dollar', 'JMD', 2, false, 100),
  ('JOD', 'Jordanian Dinar', 'JOD', 2, false, 100),
  ('JPY', 'Japanese Yen', '¥', 0, false, 100),
  ('KES', 'Kenyan Shilling', 'KSh', 2, false, 8),
  ('KGS', 'Kyrgyz Som', 'KGS', 2, false, 100),
  ('KHR', 'Cambodian Riel', '៛', 2, false, 100),
  ('KMF', 'Comorian Franc', 'CF', 0, false, 100),
  ('KPW', 'North Korean Won', '₩', 0, false, 100),
  ('KRW', 'South Korean Won', '₩', 0, false, 100),
  ('KWD', 'Kuwaiti Dinar', 'KWD', 2, false, 100),
  ('KYD', 'Cayman Islands Dollar', 'KYD', 2, false, 100),
  ('KZT', 'Kazakhstani Tenge', '₸', 2, false, 100),
  ('LAK', 'Laotian Kip', '₭', 0, false, 100),
  ('LBP', 'Lebanese Pound', 'L£', 0, false, 100),
  ('LKR', 'Sri Lankan Rupee', 'LKR', 2, false, 100),
  ('LRD', 'Liberian Dollar', 'LRD', 2, false, 100),
  ('LSL', 'Lesotho Loti', 'LSL', 2, false, 100),
  ('LYD', 'Libyan Dinar', 'LYD', 2, false, 100),
  ('MAD', 'Moroccan Dirham', 'MAD', 2, false, 100),
  ('MDL', 'Moldovan Leu', 'MDL', 2, false, 100),
  ('MGA', 'Malagasy Ariary', 'Ar', 0, false, 100),
  ('MKD', 'Macedonian Denar', 'MKD', 2, false, 100),
  ('MMK', 'Myanmar Kyat', 'K', 0, false, 100),
  ('MNT', 'Mongolian Tugrik', '₮', 2, false, 100),
  ('MOP', 'Macanese Pataca', 'MOP', 2, false, 100),
  ('MRU', 'Mauritanian Ouguiya', 'MRU', 2, false, 100),
  ('MUR', 'Mauritian Rupee', 'MUR', 2, false, 100),
  ('MVR', 'Maldivian Rufiyaa', 'MVR', 2, false, 100),
  ('MWK', 'Malawian Kwacha', 'MWK', 2, false, 100),
  ('MXN', 'Mexican Peso', 'MX$', 2, false, 100),
  ('MYR', 'Malaysian Ringgit', 'RM', 2, false, 100),
  ('MZN', 'Mozambican Metical', 'MZN', 2, false, 100),
  ('NAD', 'Namibian Dollar', 'NAD', 2, false, 100),
  ('NGN', 'Nigerian Naira', '₦', 0, false, 2),
  ('NIO', 'Nicaraguan Córdoba', 'C$', 2, false, 100),
  ('NOK', 'Norwegian Krone', 'NOK', 2, false, 100),
  ('NPR', 'Nepalese Rupee', 'NPR', 2, false, 100),
  ('NZD', 'New Zealand Dollar', 'NZ$', 2, false, 100),
  ('OMR', 'Omani Rial', 'OMR', 2, false, 100),
  ('PAB', 'Panamanian Balboa', 'PAB', 2, false, 100),
  ('PEN', 'Peruvian Sol', 'PEN', 2, false, 100),
  ('PGK', 'Papua New Guinean Kina', 'PGK', 2, false, 100),
  ('PHP', 'Philippine Peso', '₱', 2, false, 100),
  ('PKR', 'Pakistani Rupee', 'PKR', 0, false, 100),
  ('PLN', 'Polish Zloty', 'zł', 2, false, 100),
  ('PYG', 'Paraguayan Guarani', '₲', 0, false, 100),
  ('QAR', 'Qatari Riyal', 'QAR', 2, false, 100),
  ('RON', 'Romanian Leu', 'lei', 2, false, 100),
  ('RSD', 'Serbian Dinar', 'RSD', 2, false, 100),
  ('RUB', 'Russian Ruble', '₽', 2, false, 100),
  ('RWF', 'Rwandan Franc', 'RF', 0, false, 100),
  ('SAR', 'Saudi Riyal', 'SAR', 2, false, 100),
  ('SBD', 'Solomon Islands Dollar', 'SBD', 2, false, 100),
  ('SCR', 'Seychellois Rupee', 'SCR', 2, false, 100),
  ('SDG', 'Sudanese Pound', 'SDG', 2, false, 100),
  ('SEK', 'Swedish Krona', 'SEK', 2, false, 100),
  ('SGD', 'Singapore Dollar', 'SGD', 2, false, 100),
  ('SHP', 'St. Helena Pound', 'SHP', 2, false, 100),
  ('SLE', 'Sierra Leonean Leone', 'SLE', 2, false, 100),
  ('SOS', 'Somali Shilling', 'SOS', 0, false, 100),
  ('SRD', 'Surinamese Dollar', 'SRD', 2, false, 100),
  ('SSP', 'South Sudanese Pound', 'SSP', 2, false, 100),
  ('STN', 'São Tomé & Príncipe Dobra', 'Db', 2, false, 100),
  ('SYP', 'Syrian Pound', 'SYP', 0, false, 100),
  ('SZL', 'Swazi Lilangeni', 'SZL', 2, false, 100),
  ('THB', 'Thai Baht', '฿', 2, false, 100),
  ('TJS', 'Tajikistani Somoni', 'TJS', 2, false, 100),
  ('TMT', 'Turkmenistani Manat', 'TMT', 2, false, 100),
  ('TND', 'Tunisian Dinar', 'TND', 2, false, 100),
  ('TOP', 'Tongan Paʻanga', 'T$', 2, false, 100),
  ('TRY', 'Turkish Lira', '₺', 2, false, 100),
  ('TTD', 'Trinidad & Tobago Dollar', 'TTD', 2, false, 100),
  ('TWD', 'New Taiwan Dollar', 'NT$', 2, false, 100),
  ('TZS', 'Tanzanian Shilling', 'TSh', 2, false, 100),
  ('UAH', 'Ukrainian Hryvnia', '₴', 2, false, 100),
  ('UGX', 'Ugandan Shilling', 'USh', 0, false, 100),
  ('USD', 'US Dollar', '$', 2, false, 4),
  ('UYU', 'Uruguayan Peso', 'UYU', 2, false, 100),
  ('UZS', 'Uzbekistani Som', 'UZS', 2, false, 100),
  ('VES', 'Venezuelan Bolívar', 'VES', 2, false, 100),
  ('VND', 'Vietnamese Dong', '₫', 0, false, 100),
  ('VUV', 'Vanuatu Vatu', 'VUV', 0, false, 100),
  ('WST', 'Samoan Tala', 'WST', 2, false, 100),
  ('XAF', 'Central African CFA Franc', 'FCFA', 0, false, 100),
  ('XCD', 'East Caribbean Dollar', 'EC$', 2, false, 100),
  ('XCG', 'Caribbean guilder', 'Cg.', 2, false, 100),
  ('XOF', 'West African CFA Franc', 'F CFA', 0, false, 100),
  ('XPF', 'CFP Franc', 'CFPF', 0, false, 100),
  ('YER', 'Yemeni Rial', 'YER', 0, false, 100),
  ('ZAR', 'South African Rand', 'R', 2, false, 7),
  ('ZMW', 'Zambian Kwacha', 'ZK', 2, false, 100),
  ('ZWG', 'Zimbabwean Gold', 'ZWG', 2, false, 100)
on conflict (code) do nothing;

alter table public.currencies enable row level security;
drop policy if exists "currencies: everyone reads" on public.currencies;
create policy "currencies: everyone reads" on public.currencies for select using (true);
revoke all on public.currencies from public, anon, authenticated;
grant select on public.currencies to anon, authenticated;

-- Each country: its currency, phone code, and whether fabric is sold in yards or metres
alter table public.countries add column if not exists currency_code text;
alter table public.countries add column if not exists phone_code    text;
alter table public.countries add column if not exists fabric_unit   text;

update public.countries c
   set currency_code = coalesce(c.currency_code, v.currency),
       phone_code    = coalesce(c.phone_code, v.phone),
       fabric_unit   = coalesce(c.fabric_unit, v.unit)
  from (values
  ('AF','AFN','+93','m'), ('AX','EUR','+358','m'), ('AL','ALL','+355','m'), ('DZ','DZD','+213','m'), ('AS','USD','+1684','m'), ('AD','EUR','+376','m'),
  ('AO','AOA','+244','m'), ('AI','XCD','+1264','m'), ('AQ','USD','+672','m'), ('AG','XCD','+1268','m'), ('AR','ARS','+54','m'), ('AM','AMD','+374','m'),
  ('AW','AWG','+297','m'), ('AU','AUD','+61','m'), ('AT','EUR','+43','m'), ('AZ','AZN','+994','m'), ('BS','BSD','+1242','m'), ('BH','BHD','+973','m'),
  ('BD','BDT','+880','m'), ('BB','BBD','+1246','m'), ('BY','BYN','+375','m'), ('BE','EUR','+32','m'), ('BZ','BZD','+501','m'), ('BJ','XOF','+229','m'),
  ('BM','BMD','+1441','m'), ('BT','BTN','+975','m'), ('BO','BOB','+591','m'), ('BQ','USD','+5997','m'), ('BA','BAM','+387','m'), ('BW','BWP','+267','m'),
  ('BV','NOK','+47','m'), ('BR','BRL','+55','m'), ('IO','USD','+246','m'), ('BN','BND','+673','m'), ('BG','EUR','+359','m'), ('BF','XOF','+226','m'),
  ('BI','BIF','+257','m'), ('CV','CVE','+238','m'), ('KH','KHR','+855','m'), ('CM','XAF','+237','m'), ('CA','CAD','+1','m'), ('KY','KYD','+1345','m'),
  ('CF','XAF','+236','m'), ('TD','XAF','+235','m'), ('CL','CLP','+56','m'), ('CN','CNY','+86','m'), ('CX','AUD','+61','m'), ('CC','AUD','+61','m'),
  ('CO','COP','+57','m'), ('KM','KMF','+269','m'), ('CG','XAF','+242','m'), ('CD','CDF','+243','m'), ('CK','NZD','+682','m'), ('CR','CRC','+506','m'),
  ('CI','XOF','+225','m'), ('HR','EUR','+385','m'), ('CU','CUP','+53','m'), ('CW','XCG','+5999','m'), ('CY','EUR','+357','m'), ('CZ','CZK','+420','m'),
  ('DK','DKK','+45','m'), ('DJ','DJF','+253','m'), ('DM','XCD','+1767','m'), ('DO','DOP','+1809','m'), ('EC','USD','+593','m'), ('EG','EGP','+20','m'),
  ('SV','USD','+503','m'), ('GQ','XAF','+240','m'), ('ER','ERN','+291','m'), ('EE','EUR','+372','m'), ('SZ','SZL','+268','m'), ('ET','ETB','+251','m'),
  ('FK','FKP','+500','m'), ('FO','DKK','+298','m'), ('FJ','FJD','+679','m'), ('FI','EUR','+358','m'), ('FR','EUR','+33','m'), ('GF','EUR','+594','m'),
  ('PF','XPF','+689','m'), ('TF','EUR','+262','m'), ('GA','XAF','+241','m'), ('GM','GMD','+220','m'), ('GE','GEL','+995','m'), ('DE','EUR','+49','m'),
  ('GH','GHS','+233','yd'), ('GI','GIP','+350','m'), ('GR','EUR','+30','m'), ('GL','DKK','+299','m'), ('GD','XCD','+1473','m'), ('GP','EUR','+590','m'),
  ('GU','USD','+1671','m'), ('GT','GTQ','+502','m'), ('GG','GBP','+44','m'), ('GN','GNF','+224','m'), ('GW','XOF','+245','m'), ('GY','GYD','+592','m'),
  ('HT','HTG','+509','m'), ('HM','AUD','+61','m'), ('VA','EUR','+379','m'), ('HN','HNL','+504','m'), ('HK','HKD','+852','m'), ('HU','HUF','+36','m'),
  ('IS','ISK','+354','m'), ('IN','INR','+91','m'), ('ID','IDR','+62','m'), ('IR','IRR','+98','m'), ('IQ','IQD','+964','m'), ('IE','EUR','+353','m'),
  ('IM','GBP','+44','m'), ('IL','ILS','+972','m'), ('IT','EUR','+39','m'), ('JM','JMD','+1876','m'), ('JP','JPY','+81','m'), ('JE','GBP','+44','m'),
  ('JO','JOD','+962','m'), ('KZ','KZT','+7','m'), ('KE','KES','+254','m'), ('KI','AUD','+686','m'), ('KP','KPW','+850','m'), ('KR','KRW','+82','m'),
  ('KW','KWD','+965','m'), ('KG','KGS','+996','m'), ('LA','LAK','+856','m'), ('LV','EUR','+371','m'), ('LB','LBP','+961','m'), ('LS','LSL','+266','m'),
  ('LR','LRD','+231','m'), ('LY','LYD','+218','m'), ('LI','CHF','+423','m'), ('LT','EUR','+370','m'), ('LU','EUR','+352','m'), ('MO','MOP','+853','m'),
  ('MG','MGA','+261','m'), ('MW','MWK','+265','m'), ('MY','MYR','+60','m'), ('MV','MVR','+960','m'), ('ML','XOF','+223','m'), ('MT','EUR','+356','m'),
  ('MH','USD','+692','m'), ('MQ','EUR','+596','m'), ('MR','MRU','+222','m'), ('MU','MUR','+230','m'), ('YT','EUR','+262','m'), ('MX','MXN','+52','m'),
  ('FM','USD','+691','m'), ('MD','MDL','+373','m'), ('MC','EUR','+377','m'), ('MN','MNT','+976','m'), ('ME','EUR','+382','m'), ('MS','XCD','+1664','m'),
  ('MA','MAD','+212','m'), ('MZ','MZN','+258','m'), ('MM','MMK','+95','m'), ('NA','NAD','+264','m'), ('NR','AUD','+674','m'), ('NP','NPR','+977','m'),
  ('NL','EUR','+31','m'), ('NC','XPF','+687','m'), ('NZ','NZD','+64','m'), ('NI','NIO','+505','m'), ('NE','XOF','+227','m'), ('NG','NGN','+234','yd'),
  ('NU','NZD','+683','m'), ('NF','AUD','+672','m'), ('MK','MKD','+389','m'), ('MP','USD','+1670','m'), ('NO','NOK','+47','m'), ('OM','OMR','+968','m'),
  ('PK','PKR','+92','m'), ('PW','USD','+680','m'), ('PS','ILS','+970','m'), ('PA','PAB','+507','m'), ('PG','PGK','+675','m'), ('PY','PYG','+595','m'),
  ('PE','PEN','+51','m'), ('PH','PHP','+63','m'), ('PN','NZD','+64','m'), ('PL','PLN','+48','m'), ('PT','EUR','+351','m'), ('PR','USD','+1787','m'),
  ('QA','QAR','+974','m'), ('RE','EUR','+262','m'), ('RO','RON','+40','m'), ('RU','RUB','+7','m'), ('RW','RWF','+250','m'), ('BL','EUR','+590','m'),
  ('SH','SHP','+290','m'), ('KN','XCD','+1869','m'), ('LC','XCD','+1758','m'), ('MF','EUR','+590','m'), ('PM','EUR','+508','m'), ('VC','XCD','+1784','m'),
  ('WS','WST','+685','m'), ('SM','EUR','+378','m'), ('ST','STN','+239','m'), ('SA','SAR','+966','m'), ('SN','XOF','+221','m'), ('RS','RSD','+381','m'),
  ('SC','SCR','+248','m'), ('SL','SLE','+232','m'), ('SG','SGD','+65','m'), ('SX','XCG','+1721','m'), ('SK','EUR','+421','m'), ('SI','EUR','+386','m'),
  ('SB','SBD','+677','m'), ('SO','SOS','+252','m'), ('ZA','ZAR','+27','m'), ('GS','GBP','+500','m'), ('SS','SSP','+211','m'), ('ES','EUR','+34','m'),
  ('LK','LKR','+94','m'), ('SD','SDG','+249','m'), ('SR','SRD','+597','m'), ('SJ','NOK','+4779','m'), ('SE','SEK','+46','m'), ('CH','CHF','+41','m'),
  ('SY','SYP','+963','m'), ('TW','TWD','+886','m'), ('TJ','TJS','+992','m'), ('TZ','TZS','+255','m'), ('TH','THB','+66','m'), ('TL','USD','+670','m'),
  ('TG','XOF','+228','m'), ('TK','NZD','+690','m'), ('TO','TOP','+676','m'), ('TT','TTD','+1868','m'), ('TN','TND','+216','m'), ('TR','TRY','+90','m'),
  ('TM','TMT','+993','m'), ('TC','USD','+1649','m'), ('TV','AUD','+688','m'), ('UG','UGX','+256','m'), ('UA','UAH','+380','m'), ('AE','AED','+971','m'),
  ('GB','GBP','+44','yd'), ('US','USD','+1','yd'), ('UM','USD','+1','m'), ('UY','UYU','+598','m'), ('UZ','UZS','+998','m'), ('VU','VUV','+678','m'),
  ('VE','VES','+58','m'), ('VN','VND','+84','m'), ('VG','USD','+1284','m'), ('VI','USD','+1340','m'), ('WF','XPF','+681','m'), ('EH','MAD','+212','m'),
  ('YE','YER','+967','m'), ('ZM','ZMW','+260','m'), ('ZW','ZWG','+263','m')
  ) as v(code, currency, phone, unit)
 where c.code = v.code and (c.currency_code is null or c.phone_code is null or c.fabric_unit is null);
-- Any country the admin added themselves
update public.countries set currency_code = 'USD' where currency_code is null;
update public.countries set fabric_unit = 'm' where fabric_unit is null;
alter table public.countries alter column currency_code set default 'USD';
alter table public.countries alter column fabric_unit set default 'm';
alter table public.countries alter column currency_code set not null;
alter table public.countries alter column fabric_unit set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'countries_currency_fkey_wv') then
    alter table public.countries add constraint countries_currency_fkey_wv foreign key (currency_code) references public.currencies (code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'countries_fabric_unit_check_wv') then
    alter table public.countries add constraint countries_fabric_unit_check_wv check (fabric_unit in ('yd', 'm'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'countries_phone_code_check_wv') then
    alter table public.countries add constraint countries_phone_code_check_wv check (phone_code is null or phone_code ~ '^\+[0-9]{1,4}$');
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 2. Exchange rates
-- ---------------------------------------------------------------------
-- One row per currency: how many of it buy one US dollar. The GitHub
-- Action "Exchange rates" updates them every day through
-- wearvia_save_exchange_rates (below), which only the secret key can call.

create table if not exists public.exchange_rates (
  currency_code  text primary key references public.currencies (code),
  units_per_usd  numeric not null check (units_per_usd > 0),
  rate_date      date not null,
  source         text not null default '',
  updated_at     timestamptz not null default now()
);

alter table public.exchange_rates enable row level security;
drop policy if exists "exchange_rates: everyone reads" on public.exchange_rates;
create policy "exchange_rates: everyone reads" on public.exchange_rates for select using (true);
revoke all on public.exchange_rates from public, anon, authenticated;
grant select on public.exchange_rates to anon, authenticated;

-- The daily update. p_rates is {"USD": 1, "GBP": 0.74, "NGN": 1531.2, …} (units per US dollar).
-- A rate more than 3× away from yesterday's is skipped (a broken feed must never price an order).
create or replace function public.wearvia_save_exchange_rates(p_rates jsonb, p_date date, p_source text default '')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code    text;
  v_value   jsonb;
  v_rate    numeric;
  v_old     public.exchange_rates%rowtype;
  v_saved   integer := 0;
  v_skipped text[] := '{}';
begin
  if jsonb_typeof(p_rates) <> 'object' then
    raise exception 'Rates must be an object like {"USD": 1, "GBP": 0.74}.';
  end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 30 then
    raise exception 'The rates'' date (%) doesn''t look right.', p_date;
  end if;
  if coalesce((p_rates ->> 'USD')::numeric, 0) <> 1 then
    raise exception 'The rates must be against the US dollar (USD = 1).';
  end if;
  if not (p_rates ? 'GBP' and p_rates ? 'NGN' and p_rates ? 'GHS') then
    raise exception 'The rates must include GBP, NGN and GHS.';
  end if;

  for v_code, v_value in select key, value from jsonb_each(p_rates) loop
    v_code := upper(v_code);
    if not exists (select 1 from public.currencies c where c.code = v_code) then
      continue;                                   -- a currency NebedaHub doesn't use
    end if;
    begin
      v_rate := (v_value #>> '{}')::numeric;
    exception when others then
      v_rate := null;
    end;
    if v_rate is null or v_rate <= 0 then
      v_skipped := v_skipped || (v_code || ' (not a number)');
      continue;
    end if;
    select * into v_old from public.exchange_rates where currency_code = v_code;
    if v_old.currency_code is not null and v_old.rate_date > p_date then
      continue;                                   -- never go back to an older rate
    end if;
    if v_old.currency_code is not null and (v_rate > v_old.units_per_usd * 3 or v_rate < v_old.units_per_usd / 3) then
      v_skipped := v_skipped || (v_code || ' (moved too far: ' || trim_scale(v_old.units_per_usd) || ' → ' || trim_scale(v_rate) || ')');
      continue;
    end if;
    insert into public.exchange_rates (currency_code, units_per_usd, rate_date, source, updated_at)
    values (v_code, v_rate, p_date, left(coalesce(p_source, ''), 100), now())
    on conflict (currency_code) do update
      set units_per_usd = excluded.units_per_usd, rate_date = excluded.rate_date, source = excluded.source, updated_at = now();
    v_saved := v_saved + 1;
  end loop;

  return 'Saved ' || v_saved || ' exchange rates for ' || to_char(p_date, 'DD Mon YYYY')
         || case when cardinality(v_skipped) > 0 then '. Skipped: ' || array_to_string(v_skipped, ', ') else '' end;
end $$;

revoke execute on function public.wearvia_save_exchange_rates(jsonb, date, text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.wearvia_save_exchange_rates(jsonb, date, text) to service_role;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Helpers: money, rates, lengths
-- ---------------------------------------------------------------------

create or replace function public.wv_currency_decimals(p_code text) returns integer
language sql stable set search_path = public as $$
  select coalesce((select c.decimals::integer from public.currencies c where c.code = upper(p_code)), 2)
$$;

-- Rounds money the way the currency is written (₦ to the naira, £ to the penny)
create or replace function public.wv_round_money(p_amount numeric, p_code text) returns numeric
language sql stable set search_path = public as $$
  select round(p_amount, public.wv_currency_decimals(p_code))
$$;

-- £1,250 · £1,250.50 · ₦250,000 · $1,250.00 · GH₵1,250.00 · KSh 1,250.00
create or replace function public.wv_money_text(p_amount numeric, p_code text) returns text
language plpgsql stable set search_path = public as $$
declare
  c        public.currencies%rowtype;
  v_amount numeric;
  v_digits text;
begin
  if p_amount is null then
    return '';
  end if;
  select * into c from public.currencies where code = upper(coalesce(p_code, 'GBP'));
  if c.code is null then
    c.code := upper(coalesce(p_code, 'GBP')); c.symbol := c.code; c.decimals := 2; c.trim_zeros := false;
  end if;
  v_amount := round(abs(p_amount), c.decimals);
  v_digits := case when c.decimals = 0 or (c.trim_zeros and v_amount = trunc(v_amount))
                   then to_char(v_amount, 'FM999,999,999,990')
                   else to_char(v_amount, 'FM999,999,999,990.' || repeat('0', c.decimals)) end;
  return case when p_amount < 0 then '-' else '' end
         || c.symbol || case when char_length(c.symbol) > 1 and c.symbol ~ '[A-Za-z.]$' then ' ' else '' end || v_digits;
end $$;

-- The rate between two currencies from today's table: amount_in_p_to = amount_in_p_from × rate.
-- With p_strict (the default) it stops with a clear message if there is no rate, or the rates
-- are more than a week old; otherwise it returns no row.
create or replace function public.wv_fx(p_from text, p_to text, p_strict boolean default true)
returns table (rate numeric, rate_date date, source text)
language plpgsql stable security definer set search_path = public as $$
declare
  f public.exchange_rates%rowtype;
  t public.exchange_rates%rowtype;
begin
  if p_from is null or p_to is null or upper(p_from) = upper(p_to) then
    return query select 1::numeric, current_date, 'same currency'::text;
    return;
  end if;
  select * into f from public.exchange_rates x where x.currency_code = upper(p_from);
  select * into t from public.exchange_rates x where x.currency_code = upper(p_to);
  if f.currency_code is null or t.currency_code is null then
    if p_strict then
      raise exception 'There''s no exchange rate for % yet, so % can''t be converted to %. NebedaHub updates exchange rates every day — please try again later.',
        case when f.currency_code is null then upper(p_from) else upper(p_to) end, upper(p_from), upper(p_to);
    end if;
    return;
  end if;
  if p_strict and least(f.rate_date, t.rate_date) < current_date - 7 then
    raise exception 'The exchange rates are out of date (last updated %). Please try again later, or tell the NebedaHub admin.',
      to_char(least(f.rate_date, t.rate_date), 'DD Mon YYYY');
  end if;
  return query select round(t.units_per_usd / f.units_per_usd, 12), least(f.rate_date, t.rate_date),
                      coalesce(nullif(t.source, ''), f.source);
end $$;

-- An amount in another currency, rounded the way that currency is written
create or replace function public.wv_convert(p_amount numeric, p_from text, p_to text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_amount is null then null
              when upper(coalesce(p_from, p_to)) = upper(p_to) then public.wv_round_money(p_amount, p_to)
              else public.wv_round_money(p_amount * (select x.rate from public.wv_fx(p_from, p_to) x), p_to) end
$$;

-- A tidy price after converting a price list: three significant figures
-- (£280 → ₦566,000, £15 → $20)
create or replace function public.wv_nice_price(p_amount numeric, p_code text) returns numeric
language sql stable set search_path = public as $$
  select case when p_amount is null or p_amount <= 0 then p_amount
              else round(round(p_amount / power(10::numeric, greatest(floor(log(p_amount)) - 2, 0)))
                         * power(10::numeric, greatest(floor(log(p_amount)) - 2, 0)), public.wv_currency_decimals(p_code)) end
$$;

-- "£1 = ₦1,912.57" (always the way round that gives a number of 1 or more)
create or replace function public.wv_rate_text(p_rate numeric, p_from text, p_to text) returns text
language plpgsql stable set search_path = public as $$
declare
  v_big  boolean := p_rate >= 1;
  v_num  numeric := case when p_rate >= 1 then p_rate else 1 / p_rate end;
  v_one  text := case when p_rate >= 1 then upper(p_from) else upper(p_to) end;
  v_many text := case when p_rate >= 1 then upper(p_to) else upper(p_from) end;
  v_sym  text := coalesce((select c.symbol from public.currencies c where c.code = v_many), v_many);
  v_sym1 text := coalesce((select c.symbol from public.currencies c where c.code = v_one), v_one);
begin
  if p_rate is null or p_rate <= 0 then
    return '';
  end if;
  return v_sym1 || case when char_length(v_sym1) > 1 and v_sym1 ~ '[A-Za-z.]$' then ' ' else '' end || '1 = ' || v_sym || case when char_length(v_sym) > 1 and v_sym ~ '[A-Za-z.]$' then ' ' else '' end
         || case when v_num >= 100 then to_char(round(v_num, 2), 'FM999,999,999,990.00')
                 else to_char(round(v_num, 4), 'FM999,990.0099') end;
end $$;

-- Where fabric is sold in yards (the UK, Nigeria, Ghana, the USA) or metres
create or replace function public.wv_country_unit(p_country text) returns text
language sql stable set search_path = public as $$
  select coalesce((select c.fabric_unit from public.countries c where c.code = upper(p_country)), 'yd')
$$;

create or replace function public.wv_country_currency(p_country text) returns text
language sql stable set search_path = public as $$
  select coalesce((select c.currency_code from public.countries c where c.code = upper(p_country)), 'GBP')
$$;

-- "4.5 yd" or "4.11 m" (lengths are stored in yards)
create or replace function public.wv_length_text(p_yards numeric, p_unit text) returns text
language sql immutable set search_path = public as $$
  select case when p_yards is null then ''
              when p_unit = 'm' then trim_scale(round(p_yards * 0.9144, 2)) || ' m'
              else trim_scale(round(p_yards, 2)) || ' yd' end
$$;


-- ---------------------------------------------------------------------
-- 4. A currency on everything that holds money
-- ---------------------------------------------------------------------
-- Each column is added with GBP filled in for the rows already there
-- (adding a column this way changes no money and runs no triggers), then
-- the default is removed so every new row gets the right currency from
-- the rules below.

do $$
declare
  t text;
begin
  foreach t in array array['designers', 'suppliers', 'price_list', 'fabrics', 'orders', 'invoices', 'payments',
                           'fabric_order_lines', 'ready_to_wear_items', 'ready_to_wear_sales'] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'currency_code') then
      execute format('alter table public.%I add column currency_code text not null default %L', t, 'GBP');
    end if;
    execute format('alter table public.%I alter column currency_code drop default', t);
    if not exists (select 1 from pg_constraint where conname = t || '_currency_fkey_wv') then
      execute format('alter table public.%I add constraint %I foreign key (currency_code) references public.currencies (code)', t, t || '_currency_fkey_wv');
    end if;
  end loop;
end $$;

-- Orders: the fabric seller's side of a quote, and the exchange rate used
alter table public.orders add column if not exists fabric_currency_code  text;         -- the seller's currency
alter table public.orders add column if not exists fabric_price_per_yard numeric;      -- the seller's price when the quote was sent
alter table public.orders add column if not exists fabric_cost_in_fabric_currency numeric;  -- what the seller is paid
alter table public.orders add column if not exists exchange_rate         numeric;      -- 1 in the seller's currency = this in the order's; empty when no conversion
alter table public.orders add column if not exists exchange_rate_date    date;
alter table public.orders add column if not exists exchange_rate_source  text;
alter table public.orders add column if not exists fabric_unit           text not null default 'yd';  -- how the tailor measures fabric: yd or m
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_fabric_unit_check_wv') then
    alter table public.orders add constraint orders_fabric_unit_check_wv check (fabric_unit in ('yd', 'm'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_fabric_currency_fkey_wv') then
    alter table public.orders add constraint orders_fabric_currency_fkey_wv foreign key (fabric_currency_code) references public.currencies (code);
  end if;
end $$;

-- Fabric sellers: their country (for the currency, phone code and yards or metres)
alter table public.suppliers add column if not exists country_code text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_country_fkey_wv') then
    alter table public.suppliers add constraint suppliers_country_fkey_wv foreign key (country_code) references public.countries (code);
  end if;
end $$;

-- Customers: country, currency (for approximate prices) and inches or centimetres
alter table public.customers add column if not exists country_code     text;
alter table public.customers add column if not exists currency_code    text;
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'customers' and column_name = 'measurement_unit') then
    alter table public.customers add column measurement_unit text not null default 'in';   -- everything saved so far is in inches
  end if;
  alter table public.customers alter column measurement_unit drop default;
  if not exists (select 1 from pg_constraint where conname = 'customers_country_fkey_wv') then
    alter table public.customers add constraint customers_country_fkey_wv foreign key (country_code) references public.countries (code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_currency_fkey_wv') then
    alter table public.customers add constraint customers_currency_fkey_wv foreign key (currency_code) references public.currencies (code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_measurement_unit_check_wv') then
    alter table public.customers add constraint customers_measurement_unit_check_wv check (measurement_unit in ('in', 'cm'));
  end if;
end $$;

-- Who can read and change the new columns (the tables' column lists are
-- locked down by tailors-near-me.sql and no-leakage.sql)
grant select (currency_code) on public.designers to anon, authenticated;
grant update (currency_code) on public.designers to authenticated;
grant select (country_code, currency_code, measurement_unit) on public.customers to authenticated;
grant insert (country_code, currency_code, measurement_unit) on public.customers to authenticated;
grant update (country_code, currency_code, measurement_unit) on public.customers to authenticated;


-- ---------------------------------------------------------------------
-- 5. Rules that keep currencies right
-- ---------------------------------------------------------------------

-- Tailors: a new tailor gets their country's currency. When the owner changes
-- currency, their starting price is converted here and their price list,
-- ready-to-wear and services just after (wv_designers_currency_after).
create or replace function public.wv_designers_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.currency_code := coalesce(upper(nullif(trim(new.currency_code), '')), public.wv_country_currency(new.country_code));
  else
    new.currency_code := coalesce(upper(nullif(trim(new.currency_code), '')), old.currency_code);
    if new.currency_code is distinct from old.currency_code and new.starting_price is not null then
      new.starting_price := public.wv_nice_price(public.wv_convert(new.starting_price, old.currency_code, new.currency_code), new.currency_code);
    end if;
  end if;
  return new;
end $$;

create or replace function public.wv_designers_currency_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.currency_code is distinct from old.currency_code then
    perform public.wv_convert_designer_prices(new.id);
  end if;
  return null;
end $$;

-- Puts a tailor's price list, ready-to-wear and services into their currency
-- (tidied to three significant figures). Returns how many prices changed.
create or replace function public.wv_convert_designer_prices(p_designer_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cur text := (select d.currency_code from public.designers d where d.id = p_designer_id);
  v_n1  integer;
  v_n2  integer;
begin
  if v_cur is null then
    return 0;
  end if;
  update public.price_list p
     set price = public.wv_nice_price(public.wv_convert(p.price, p.currency_code, v_cur), v_cur), currency_code = v_cur
   where p.designer_id = p_designer_id and p.currency_code <> v_cur;
  get diagnostics v_n1 = row_count;
  update public.ready_to_wear_items i
     set price = public.wv_nice_price(public.wv_convert(i.price, i.currency_code, v_cur), v_cur),
         cost = public.wv_convert(i.cost, i.currency_code, v_cur), currency_code = v_cur, updated_at = now()
   where i.designer_id = p_designer_id and i.currency_code <> v_cur;
  get diagnostics v_n2 = row_count;
  return v_n1 + v_n2;
end $$;

-- Tailor's services (on their public page) have no currency of their own:
-- they're in the tailor's currency, converted with it
create or replace function public.wv_designer_services_convert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.currency_code is distinct from old.currency_code then
    update public.designer_services s
       set price = public.wv_nice_price(public.wv_convert(s.price, old.currency_code, new.currency_code), new.currency_code)
     where s.designer_id = new.id and s.price is not null;
  end if;
  return null;
end $$;

drop trigger if exists wv_designers_currency on public.designers;
create trigger wv_designers_currency before insert or update on public.designers
  for each row execute function public.wv_designers_currency();
drop trigger if exists wv_designers_currency_after on public.designers;
create trigger wv_designers_currency_after after update of currency_code on public.designers
  for each row execute function public.wv_designers_currency_after();
drop trigger if exists wv_designers_services_currency on public.designers;
create trigger wv_designers_services_currency after update of currency_code on public.designers
  for each row execute function public.wv_designer_services_convert();

-- The tailor asks for any prices still in another currency to be put into theirs
create or replace function public.wearvia_convert_price_list(p_designer_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_designer(p_designer_id) then
    raise exception 'Only the tailor''s team can change their prices.';
  end if;
  return public.wv_convert_designer_prices(p_designer_id);
end $$;

-- A new tailor's starting price list, in their currency (the same starting
-- prices NebedaHub began with, converted and tidied). Before the first
-- exchange rates arrive it starts in GBP; the tailor converts it later with
-- one tap in Business → Prices, and quotes convert it until then.
create or replace function public.wv_seed_price_list(p_designer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cur  text := coalesce((select d.currency_code from public.designers d where d.id = p_designer_id), 'GBP');
  v_rate numeric := (select x.rate from public.wv_fx('GBP', v_cur, false) x);
begin
  insert into public.price_list (designer_id, kind, name, price, yards, sort_order, currency_code)
  select p_designer_id, v.kind, v.name,
         case when v_cur = 'GBP' or v_rate is null then v.price else public.wv_nice_price(v.price * v_rate, v_cur) end,
         v.yards, v.sort_order, case when v_rate is null then 'GBP' else v_cur end
  from (values
    ('outfit', 'Agbada', 280, 10, 1), ('outfit', 'Kaftan', 150, 4.5, 2), ('outfit', 'Senator', 170, 4, 3),
    ('outfit', 'Bubu', 140, 5, 4), ('outfit', 'Two Piece', 180, 4, 5), ('outfit', 'Dress', 160, 3, 6),
    ('outfit', 'Wedding', 450, 10, 7), ('outfit', 'Suit', 350, 3.5, 8), ('outfit', 'Aso Ebi', 160, 5, 9),
    ('outfit', 'Custom', 200, 5, 10),
    ('embroidery', 'Gold', 60, null, 1), ('embroidery', 'Silver', 50, null, 2), ('embroidery', 'None', 0, null, 3),
    ('delivery', 'Delivery', 15, null, 1)) as v(kind, name, price, yards, sort_order)
  where p_designer_id is not null
    and not exists (select 1 from public.price_list p where p.designer_id = p_designer_id and p.kind = v.kind and p.name = v.name);
end $$;

-- A price list row is in its tailor's currency unless it says otherwise
create or replace function public.wv_price_list_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.currency_code := coalesce(upper(nullif(trim(new.currency_code), '')),
                                (select d.currency_code from public.designers d where d.id = new.designer_id), 'GBP');
  return new;
end $$;
drop trigger if exists wv_price_list_currency on public.price_list;
create trigger wv_price_list_currency before insert on public.price_list
  for each row execute function public.wv_price_list_currency();

-- Fabric sellers: a new shop gets its country's currency. When the seller
-- changes currency, their fabrics' prices are converted with it.
create or replace function public.wv_suppliers_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.country_code := nullif(upper(trim(coalesce(new.country_code, ''))), '');
  if tg_op = 'INSERT' then
    new.currency_code := coalesce(upper(nullif(trim(new.currency_code), '')), public.wv_country_currency(new.country_code));
  else
    new.currency_code := coalesce(upper(nullif(trim(new.currency_code), '')), old.currency_code);
  end if;
  return new;
end $$;

create or replace function public.wv_suppliers_currency_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.currency_code is distinct from old.currency_code then
    -- The seller's own prices, converted; the rule on fabrics sets their currency
    update public.fabrics f
       set price_per_yard = public.wv_convert(f.price_per_yard, f.currency_code, new.currency_code)
     where f.supplier_id = new.id and f.currency_code <> new.currency_code;
  end if;
  return null;
end $$;

drop trigger if exists wv_suppliers_currency on public.suppliers;
create trigger wv_suppliers_currency before insert or update on public.suppliers
  for each row execute function public.wv_suppliers_currency();
drop trigger if exists wv_suppliers_currency_after on public.suppliers;
create trigger wv_suppliers_currency_after after update of currency_code on public.suppliers
  for each row execute function public.wv_suppliers_currency_after();

-- A fabric is always priced in its seller's currency
create or replace function public.wv_fabrics_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.currency_code := coalesce((select s.currency_code from public.suppliers s where s.id = new.supplier_id),
                                case when tg_op = 'UPDATE' then old.currency_code end, new.currency_code, 'GBP');
  return new;
end $$;
drop trigger if exists wv_fabrics_currency on public.fabrics;
create trigger wv_fabrics_currency before insert or update on public.fabrics
  for each row execute function public.wv_fabrics_currency();

-- Payments, invoices, seller order lines and ready-to-wear follow what they belong to
create or replace function public.wv_payments_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.currency_code := coalesce((select o.currency_code from public.orders o where o.id = new.order_id),
                                case when tg_op = 'UPDATE' then old.currency_code end, 'GBP');
  return new;
end $$;
drop trigger if exists wv_payments_currency on public.payments;
create trigger wv_payments_currency before insert or update on public.payments
  for each row execute function public.wv_payments_currency();

create or replace function public.wv_invoices_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.currency_code := coalesce((select o.currency_code from public.orders o where o.id = new.order_id), new.currency_code, 'GBP');
  return new;
end $$;
drop trigger if exists wv_invoices_currency on public.invoices;
create trigger wv_invoices_currency before insert on public.invoices
  for each row execute function public.wv_invoices_currency();

create or replace function public.wv_fabric_lines_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.currency_code := coalesce(upper(nullif(trim(new.currency_code), '')),
                                (select s.currency_code from public.suppliers s where s.id = new.supplier_id), 'GBP');
  return new;
end $$;
drop trigger if exists wv_fabric_lines_currency on public.fabric_order_lines;
create trigger wv_fabric_lines_currency before insert on public.fabric_order_lines
  for each row execute function public.wv_fabric_lines_currency();

create or replace function public.wv_rtw_items_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or current_user in ('authenticated', 'anon') then
    new.currency_code := coalesce((select d.currency_code from public.designers d where d.id = new.designer_id),
                                  case when tg_op = 'UPDATE' then old.currency_code end, 'GBP');
  end if;
  return new;
end $$;
drop trigger if exists wv_rtw_items_currency on public.ready_to_wear_items;
create trigger wv_rtw_items_currency before insert or update on public.ready_to_wear_items
  for each row execute function public.wv_rtw_items_currency();

create or replace function public.wv_rtw_sales_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.currency_code := coalesce((select i.currency_code from public.ready_to_wear_items i where i.id = new.item_id), new.currency_code, 'GBP');
  return new;
end $$;
drop trigger if exists wv_rtw_sales_currency on public.ready_to_wear_sales;
create trigger wv_rtw_sales_currency before insert on public.ready_to_wear_sales
  for each row execute function public.wv_rtw_sales_currency();

-- Customers: a new customer's country, currency and inches or centimetres
-- come from their sign-up (or their country); they change them in Profile
create or replace function public.wv_customers_worldwide() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb;
begin
  if tg_op = 'INSERT' and new.auth_user_id is not null and (new.country_code is null or new.measurement_unit is null) then
    select u.raw_user_meta_data into v_meta from auth.users u where u.id = new.auth_user_id;
    new.country_code := coalesce(new.country_code,
      (select c.code from public.countries c where c.code = upper(coalesce(v_meta ->> 'country_code', ''))));
    new.measurement_unit := coalesce(new.measurement_unit,
      case when v_meta ->> 'measurement_unit' in ('in', 'cm') then v_meta ->> 'measurement_unit' end);
  end if;
  new.country_code := nullif(upper(trim(coalesce(new.country_code, ''))), '');
  new.currency_code := coalesce(upper(nullif(trim(new.currency_code), '')),
                                case when new.country_code is not null then public.wv_country_currency(new.country_code) end);
  new.measurement_unit := coalesce(new.measurement_unit,
                                   case when public.wv_country_unit(new.country_code) = 'm' and new.country_code is not null then 'cm' else 'in' end);
  return new;
end $$;
drop trigger if exists wv_customers_worldwide on public.customers;
create trigger wv_customers_worldwide before insert or update on public.customers
  for each row execute function public.wv_customers_worldwide();

-- Nobody changes an order's currency or exchange rate from the app: the
-- database sets them when the order is made and the quote is sent.
-- (Runs as the person making the change, like the quote rule in tailor-quote.sql.)
create or replace function public.wv_orders_guard_currency() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.currency_code is distinct from old.currency_code or new.fabric_currency_code is distinct from old.fabric_currency_code
    or new.fabric_price_per_yard is distinct from old.fabric_price_per_yard
    or new.fabric_cost_in_fabric_currency is distinct from old.fabric_cost_in_fabric_currency
    or new.exchange_rate is distinct from old.exchange_rate or new.exchange_rate_date is distinct from old.exchange_rate_date
    or new.exchange_rate_source is distinct from old.exchange_rate_source or new.fabric_unit is distinct from old.fabric_unit) then
    raise exception 'An order''s currency and exchange rate are set by NebedaHub when the quote is sent.';
  end if;
  return new;
end $$;
drop trigger if exists wv_orders_guard_currency on public.orders;
create trigger wv_orders_guard_currency before update on public.orders
  for each row execute function public.wv_orders_guard_currency();


-- ---------------------------------------------------------------------
-- 6. The quote, in the tailor's currency
-- ---------------------------------------------------------------------

-- The itemised quote. The fabric line says what the seller charges and, when
-- the seller uses another currency, the exchange rate used:
--   "Fabric — Aso Oke (4.5 yd × ₦15,000 = ₦67,500 · £1 = ₦1,912.57 on 25 Sep 2026)"
create or replace function public.wv_quote_lines_fx(
  p_fabric_name text, p_length numeric, p_unit text, p_price_per_yard numeric, p_fabric_currency text, p_fabric_amount numeric,
  p_rate numeric, p_rate_date date, p_currency text, p_fabric_cost numeric,
  p_outfit text, p_tailoring numeric, p_embroidery text, p_embroidery_cost numeric, p_delivery numeric)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_per   numeric := case when p_unit = 'm' then p_price_per_yard / 0.9144 else p_price_per_yard end;
  v_label text;
  v_line  jsonb;
begin
  if p_fabric_name is not null then
    v_label := 'Fabric — ' || p_fabric_name || ' (' || trim_scale(p_length) || ' ' || p_unit || ' × '
               || public.wv_money_text(v_per, p_fabric_currency);
    if p_rate is not null and p_fabric_currency <> p_currency then
      v_label := v_label || ' = ' || public.wv_money_text(p_fabric_amount, p_fabric_currency)
                 || ' · ' || public.wv_rate_text(p_rate, p_fabric_currency, p_currency)
                 || coalesce(' on ' || to_char(p_rate_date, 'FMDD Mon YYYY'), '');
    end if;
    v_line := jsonb_build_object('label', v_label || ')', 'amount', p_fabric_cost, 'kind', 'fabric',
                                 'fabric_currency', p_fabric_currency, 'fabric_amount', p_fabric_amount);
    if p_rate is not null and p_fabric_currency <> p_currency then
      v_line := v_line || jsonb_build_object('exchange_rate', p_rate, 'rate_date', p_rate_date);
    end if;
  end if;
  return case when v_line is null then '[]'::jsonb else jsonb_build_array(v_line) end
      || jsonb_build_array(
           jsonb_build_object('label', 'Tailoring (' || p_outfit || ')', 'amount', p_tailoring),
           jsonb_build_object('label', 'Embroidery (' || p_embroidery || ')', 'amount', p_embroidery_cost),
           jsonb_build_object('label', 'Delivery', 'amount', p_delivery));
end $$;

-- The tailor's price for something, in their currency (a row still in
-- another currency is converted at today's rate)
create or replace function public.wv_list_price(p_designer_id uuid, p_kind text, p_name text, p_currency text) returns numeric
language sql stable security definer set search_path = public as $$
  select public.wv_convert(p.price, p.currency_code, p_currency)
  from public.price_list p
  where p.designer_id = p_designer_id and p.kind = p_kind and (p_kind = 'delivery' or p.name = p_name)
  order by p.sort_order, p.name
  limit 1
$$;

-- ---- New orders ----
-- As in tailors-near-me.sql, plus: every order is in its tailor's currency.
-- A walk-in order's fabric is converted from the seller's currency here,
-- and its itemised quote is written here too.
create or replace function public.wv_orders_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team       boolean;
  v_designer   public.designers%rowtype;
  v_fabric     public.fabrics%rowtype;
  v_embroidery text := coalesce(nullif(trim(new.embroidery), ''), 'None');
  v_tailoring  numeric;
  v_emb_cost   numeric;
  v_delivery   numeric;
  v_fx         record;
  v_role       text;
  v_pick       text;
begin
  if new.designer_id is null then
    new.designer_id := public.wv_main_designer_id();
  end if;
  select * into v_designer from public.designers where id = new.designer_id;
  if not found then
    raise exception 'That tailor wasn''t found.';
  end if;
  v_team := public.can_manage_designer(new.designer_id);
  if new.order_number is null or new.order_number = '' or not v_team then
    new.order_number := 'NT-' || nextval('public.wearvia_order_number_seq');
  end if;

  -- The tailor's currency, and how they measure fabric
  new.currency_code := coalesce(v_designer.currency_code, 'GBP');
  new.fabric_unit := case when v_team and new.fabric_unit in ('yd', 'm') then new.fabric_unit
                          else public.wv_country_unit(v_designer.country_code) end;
  new.exchange_rate := null;
  new.exchange_rate_date := null;
  new.exchange_rate_source := null;
  new.fabric_price_per_yard := null;
  new.fabric_cost_in_fabric_currency := null;
  new.fabric_currency_code := null;

  if new.fabric_id is not null then
    select * into v_fabric from public.fabrics where id = new.fabric_id;
    if not found then
      raise exception 'That fabric is no longer available.';
    end if;
    new.fabric_supplier_id := v_fabric.supplier_id;
    new.fabric_currency_code := v_fabric.currency_code;
  end if;

  new.deposit_paid_at := null;
  new.balance_paid_at := null;
  new.quoted_at := null;
  new.quoted_by := null;
  new.fabric_problem := null;

  if not v_team then
    -- ---- A customer sends their order to the tailor ----
    if v_designer.admin_status <> 'approved' then
      raise exception '% isn''t taking orders on NebedaHub right now. Please choose another tailor.', v_designer.business_name;
    end if;
    if not v_designer.custom_orders then
      raise exception '% isn''t taking custom orders at the moment.', v_designer.business_name;
    end if;
    if new.fabric_id is null then
      raise exception 'Please choose a fabric for your order.';
    end if;
    if not public.wv_fabric_can_sell(v_fabric, null) then
      raise exception '% is no longer available. Please choose another fabric.', v_fabric.name;
    end if;
    if not exists (select 1 from public.price_list p where p.designer_id = new.designer_id and p.kind = 'outfit' and p.name = new.outfit_type) then
      raise exception 'Sorry, % doesn''t make "%" at the moment. Please choose another outfit.', v_designer.business_name, coalesce(new.outfit_type, '');
    end if;
    if not exists (select 1 from public.price_list p where p.designer_id = new.designer_id and p.kind = 'embroidery' and p.name = v_embroidery) then
      raise exception 'Sorry, "%" embroidery isn''t available. Please choose another.', v_embroidery;
    end if;
    if not exists (select 1 from public.price_list p where p.designer_id = new.designer_id and p.kind = 'delivery') then
      raise exception 'Sorry, % can''t take orders right now (no delivery price is set).', v_designer.business_name;
    end if;
    new.embroidery := v_embroidery;
    new.quote_status := 'requested';
    new.accepted_at := null;
    new.fabric_yards := null;
    new.fabric_cost := null;
    new.tailoring_cost := null;
    new.embroidery_cost := null;
    new.delivery_cost := null;
    new.quote_total := null;
    new.deposit_amount := null;
    new.line_items := null;
    new.stage := 'tailor_assigned';
    new.review_rating := null;
    new.review_text := null;
    new.wedding_order_id := null;
    new.assigned_cutting := null;
    new.assigned_sewing := null;
    new.assigned_embroidery := null;
    new.assigned_finishing := null;
    new.assigned_quality_control := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- ---- The tailor's team takes a walk-in order: yards entered directly ----
  new.quote_status := 'accepted';
  new.accepted_at := now();
  if new.fabric_id is not null then
    new.fabric_yards := round(coalesce(new.fabric_yards, 0), 4);
    new.fabric_price_per_yard := v_fabric.price_per_yard;
    new.fabric_cost_in_fabric_currency := public.wv_round_money(new.fabric_yards * v_fabric.price_per_yard, v_fabric.currency_code);
    if v_fabric.currency_code = new.currency_code then
      new.fabric_cost := new.fabric_cost_in_fabric_currency;
    else
      select * into v_fx from public.wv_fx(v_fabric.currency_code, new.currency_code);
      new.exchange_rate := v_fx.rate;
      new.exchange_rate_date := v_fx.rate_date;
      new.exchange_rate_source := v_fx.source;
      new.fabric_cost := public.wv_round_money(new.fabric_cost_in_fabric_currency * v_fx.rate, new.currency_code);
    end if;
  end if;
  -- The team's own prices are in their currency; anything left out comes from the price list
  if new.tailoring_cost is null then v_tailoring := public.wv_list_price(new.designer_id, 'outfit', new.outfit_type, new.currency_code); end if;
  if new.embroidery_cost is null then v_emb_cost := public.wv_list_price(new.designer_id, 'embroidery', v_embroidery, new.currency_code); end if;
  if new.delivery_cost is null then v_delivery := public.wv_list_price(new.designer_id, 'delivery', null, new.currency_code); end if;
  new.tailoring_cost := coalesce(new.tailoring_cost, v_tailoring, 0);
  new.embroidery_cost := coalesce(new.embroidery_cost, v_emb_cost, 0);
  new.delivery_cost := coalesce(new.delivery_cost, v_delivery, 0);
  new.quote_total := coalesce(new.fabric_cost, 0) + new.tailoring_cost + new.embroidery_cost + new.delivery_cost;
  new.deposit_amount := least(coalesce(new.deposit_amount, round(new.quote_total * 0.6)), new.quote_total);
  new.line_items := public.wv_quote_lines_fx(
    v_fabric.name, case when new.fabric_unit = 'm' then round(new.fabric_yards * 0.9144, 2) else new.fabric_yards end, new.fabric_unit,
    v_fabric.price_per_yard, v_fabric.currency_code, new.fabric_cost_in_fabric_currency, new.exchange_rate, new.exchange_rate_date,
    new.currency_code, new.fabric_cost, coalesce(new.outfit_type, 'Custom'), new.tailoring_cost, v_embroidery, new.embroidery_cost, new.delivery_cost);
  if new.stage is null then new.stage := 'tailor_assigned'; end if;

  foreach v_role in array array['cutting', 'sewing', 'embroidery', 'finishing', 'quality_control'] loop
    v_pick := case v_role
      when 'cutting' then new.assigned_cutting
      when 'sewing' then new.assigned_sewing
      when 'embroidery' then new.assigned_embroidery
      when 'finishing' then new.assigned_finishing
      else new.assigned_quality_control end;
    if coalesce(v_pick, '') = '' then
      v_pick := public.wv_pick_tailor(new.designer_id, v_role);
      case v_role
        when 'cutting' then new.assigned_cutting := v_pick;
        when 'sewing' then new.assigned_sewing := v_pick;
        when 'embroidery' then new.assigned_embroidery := v_pick;
        when 'finishing' then new.assigned_finishing := v_pick;
        else new.assigned_quality_control := v_pick;
      end case;
    end if;
  end loop;

  new.created_at := coalesce(new.created_at, now());
  new.updated_at := now();
  return new;
end $$;

-- Once an order is accepted (or a walk-in order is taken): take the fabric
-- out of stock, tell the seller (in THEIR currency), make the invoice (in
-- the order's currency)
create or replace function public.wv_order_take_fabric(o public.orders) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fabric  public.fabrics%rowtype;
  v_first   text;
  v_deliver text;
begin
  if o.fabric_id is not null and coalesce(o.fabric_yards, 0) > 0 then
    update public.fabrics
       set yards_available = round(yards_available - o.fabric_yards, 2)
     where id = o.fabric_id and yards_available >= o.fabric_yards
    returning * into v_fabric;
    if not found then
      raise exception 'There isn''t enough of that fabric left in stock.';
    end if;
  end if;
  if v_fabric.supplier_id is not null
     and not exists (select 1 from public.fabric_order_lines l where l.order_id = o.id and l.status <> 'cancelled') then
    select split_part(trim(c.name), ' ', 1) into v_first from public.customers c where c.id = o.customer_id;
    select d.business_name || coalesce(', ' || d.location, '') into v_deliver from public.designers d where d.id = o.designer_id;
    insert into public.fabric_order_lines
      (order_id, order_number, supplier_id, fabric_id, fabric_name, yards, price_per_yard, total,
       customer_first_name, deliver_to, created_at, currency_code)
    values
      (o.id, o.order_number, v_fabric.supplier_id, v_fabric.id, v_fabric.name, o.fabric_yards,
       coalesce(o.fabric_price_per_yard, v_fabric.price_per_yard), coalesce(o.fabric_cost_in_fabric_currency, o.fabric_cost),
       coalesce(v_first, ''), coalesce(v_deliver, ''), now(), coalesce(o.fabric_currency_code, v_fabric.currency_code));
  end if;

  if not exists (select 1 from public.invoices i where i.order_id = o.id) then
    insert into public.invoices (order_id, line_items, total, invoice_number, created_at, currency_code)
    values (o.id, o.line_items, o.quote_total,
            'INV-' || regexp_replace(o.order_number, '^[^0-9]*', ''), now(), o.currency_code);
  end if;
end $$;

-- ---- The tailor sends a quote ----
-- p_yards is the length the tailor typed, in p_unit: 'yd' (the default, and
-- what the app sent before this file) or 'm'. Stock is kept in yards, so
-- metres are converted exactly (1 yd = 0.9144 m). The quote is in the
-- tailor's currency; fabric from a seller in another currency is converted
-- at today's rate, which is saved on the order and shown on the quote.
drop function if exists public.wearvia_send_quote(uuid, numeric, uuid, text);
create or replace function public.wearvia_send_quote(
  p_order_id uuid, p_yards numeric, p_fabric_id uuid default null, p_note text default null, p_unit text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o            public.orders%rowtype;
  v_designer   public.designers%rowtype;
  v_fabric     public.fabrics%rowtype;
  v_unit       text := coalesce(nullif(lower(trim(p_unit)), ''), 'yd');
  v_len        numeric := round(coalesce(p_yards, 0), 2);
  v_yards      numeric;
  v_cur        text;
  v_fcur       text;
  v_fx         record;
  v_rate       numeric;
  v_rate_date  date;
  v_rate_src   text;
  v_emb        text;
  v_tailoring  numeric;
  v_emb_cost   numeric;
  v_delivery   numeric;
  v_cost_fc    numeric;
  v_cost       numeric;
  v_total      numeric;
  v_deposit    numeric;
  v_lines      jsonb;
  v_per        numeric;
  v_note       text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not public.can_manage_designer(o.designer_id) then
    raise exception 'Only the tailor''s team can send a quote for that order.';
  end if;
  if o.quote_status = 'accepted' then
    raise exception 'The customer has already accepted the quote for %. It can''t be changed now.', o.order_number;
  end if;
  if v_unit in ('yard', 'yards') then v_unit := 'yd'; end if;
  if v_unit in ('metre', 'metres', 'meter', 'meters') then v_unit := 'm'; end if;
  if v_unit not in ('yd', 'm') then
    raise exception 'Enter the fabric in yards or metres.';
  end if;
  select * into v_designer from public.designers where id = o.designer_id;

  select * into v_fabric from public.fabrics where id = coalesce(p_fabric_id, o.fabric_id);
  if not found then
    raise exception 'Choose a fabric for the quote.';
  end if;
  if v_len <= 0 or v_len > 100 or v_len * 4 <> round(v_len * 4) then
    raise exception 'Enter the % needed, in quarters (for example 4.5 or 5.25).', case when v_unit = 'm' then 'metres' else 'yards' end;
  end if;
  v_yards := case when v_unit = 'm' then round(v_len / 0.9144, 4) else v_len end;
  if v_fabric.deleted_at is not null or v_fabric.status <> 'approved' or coalesce(v_fabric.sold_out, false) then
    raise exception '% isn''t on sale any more. Choose another fabric.', v_fabric.name;
  end if;
  if v_yards < coalesce(v_fabric.min_order_yards, 0) - 0.005 then
    raise exception 'The smallest order for % is %.', v_fabric.name, public.wv_length_text(v_fabric.min_order_yards, v_unit);
  end if;
  if v_yards > coalesce(v_fabric.yards_available, 0) then
    raise exception 'Only % of % is left in stock.', public.wv_length_text(v_fabric.yards_available, v_unit), v_fabric.name;
  end if;

  -- The tailor's currency today (a request sent before they changed currency is quoted in the new one)
  v_cur := coalesce(v_designer.currency_code, o.currency_code, 'GBP');
  v_fcur := coalesce(v_fabric.currency_code, 'GBP');
  v_emb := coalesce(nullif(o.embroidery, ''), 'None');
  v_tailoring := public.wv_list_price(o.designer_id, 'outfit', o.outfit_type, v_cur);
  v_emb_cost := public.wv_list_price(o.designer_id, 'embroidery', v_emb, v_cur);
  v_delivery := public.wv_list_price(o.designer_id, 'delivery', null, v_cur);
  if v_tailoring is null or v_emb_cost is null or v_delivery is null then
    raise exception 'Your price list has no price for % / % embroidery / delivery. Add it in Business → Prices.', o.outfit_type, o.embroidery;
  end if;

  -- The seller's price, in the seller's currency: exactly the length typed × their price per yard or metre
  v_per := case when v_unit = 'm' then v_fabric.price_per_yard / 0.9144 else v_fabric.price_per_yard end;
  v_cost_fc := public.wv_round_money(v_len * v_per, v_fcur);
  if v_fcur = v_cur then
    v_cost := v_cost_fc;
  else
    select * into v_fx from public.wv_fx(v_fcur, v_cur);
    v_rate := v_fx.rate;
    v_rate_date := v_fx.rate_date;
    v_rate_src := v_fx.source;
    v_cost := public.wv_round_money(v_cost_fc * v_rate, v_cur);
  end if;

  v_total := v_cost + v_tailoring + v_emb_cost + v_delivery;
  v_deposit := round(v_total * 0.6);
  v_lines := public.wv_quote_lines_fx(v_fabric.name, v_len, v_unit, v_fabric.price_per_yard, v_fcur, v_cost_fc, v_rate, v_rate_date,
                                      v_cur, v_cost, o.outfit_type, v_tailoring, v_emb, v_emb_cost, v_delivery);

  update public.orders
     set fabric_id = v_fabric.id, fabric_supplier_id = v_fabric.supplier_id, fabric_yards = v_yards,
         fabric_cost = v_cost, tailoring_cost = v_tailoring, embroidery_cost = v_emb_cost, delivery_cost = v_delivery,
         quote_total = v_total, deposit_amount = v_deposit, line_items = v_lines,
         currency_code = v_cur, fabric_currency_code = v_fcur, fabric_price_per_yard = v_fabric.price_per_yard,
         fabric_cost_in_fabric_currency = v_cost_fc, exchange_rate = v_rate, exchange_rate_date = v_rate_date,
         exchange_rate_source = v_rate_src, fabric_unit = v_unit,
         quote_status = 'quoted', quoted_at = now(), quoted_by = auth.uid(), fabric_problem = null
   where id = o.id;

  if v_note is not null then
    insert into public.order_messages (order_id, sender_kind, sender_id, sender_name, body)
    values (o.id, 'team', auth.uid(), public.wv_chat_name_for(true, o.id), left(v_note, 2000));
  end if;
  perform public.wv_post_system_message(o.id,
    'Your quote is ready: ' || v_fabric.name || ', ' || trim_scale(v_len) || ' ' || v_unit || ' × ' || public.wv_money_text(v_per, v_fcur)
    || ' = ' || public.wv_money_text(v_cost_fc, v_fcur)
    || case when v_rate is not null
            then ' (' || public.wv_money_text(v_cost, v_cur) || ' at ' || public.wv_rate_text(v_rate, v_fcur, v_cur)
                 || ', the exchange rate on ' || to_char(v_rate_date, 'FMDD Mon YYYY') || ')'
            else '' end
    || ' · tailoring ' || public.wv_money_text(v_tailoring, v_cur)
    || ' · embroidery ' || public.wv_money_text(v_emb_cost, v_cur) || ' · delivery ' || public.wv_money_text(v_delivery, v_cur)
    || '. Total ' || public.wv_money_text(v_total, v_cur) || ', deposit ' || public.wv_money_text(v_deposit, v_cur) || ' (60%). '
    || 'Tap "Accept quote" to go ahead, or ask us a question here.');

  return jsonb_build_object('order_number', o.order_number, 'fabric', v_fabric.name, 'yards', v_yards, 'length', v_len, 'unit', v_unit,
                            'currency', v_cur, 'total', v_total, 'deposit', v_deposit, 'line_items', v_lines,
                            'fabric_currency', v_fcur, 'fabric_amount', v_cost_fc, 'exchange_rate', v_rate, 'rate_date', v_rate_date);
end $$;

-- ---- The customer accepts: messages in the order's currency and the tailor's unit ----
create or replace function public.wearvia_accept_quote(p_order_id uuid, p_total numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o        public.orders%rowtype;
  v_fabric public.fabrics%rowtype;
  v_text   text;
  v_shop   text;
begin
  select * into o from public.orders
  where id = p_order_id and customer_id in (select public.wv_my_customer_ids())
  for update;
  if not found then
    raise exception 'That order wasn''t found.';
  end if;
  v_shop := public.wv_designer_name(o.designer_id);
  if o.quote_status = 'accepted' then
    return jsonb_build_object('ok', true, 'already', true, 'deposit', o.deposit_amount);
  end if;
  if o.quote_status <> 'quoted' then
    raise exception 'There''s no quote to accept yet. % will send it in the chat.', v_shop;
  end if;
  if p_total is null or abs(o.quote_total - p_total) > 0.005 then
    raise exception 'Your quote has just changed. Please check the new total and try again.';
  end if;

  select * into v_fabric from public.fabrics where id = o.fabric_id for update;
  if not public.wv_fabric_can_sell(v_fabric, o.fabric_yards) then
    v_text := case
      when v_fabric.id is null or v_fabric.deleted_at is not null or v_fabric.status <> 'approved' then coalesce(v_fabric.name, 'That fabric') || ' is no longer on sale'
      when v_fabric.sold_out or coalesce(v_fabric.yards_available, 0) < greatest(coalesce(v_fabric.min_order_yards, 0), 0.01) then v_fabric.name || ' has sold out'
      else 'Only ' || public.wv_length_text(v_fabric.yards_available, o.fabric_unit) || ' of ' || v_fabric.name || ' is left' end;
    update public.orders set quote_status = 'requested', fabric_problem = v_text where id = o.id;
    perform public.wv_post_system_message(o.id,
      'Sorry — ' || v_text || ', so this quote can''t be accepted. Nothing has been charged. '
      || v_shop || ' will suggest another fabric here in the chat and send you a new quote.');
    return jsonb_build_object('ok', false, 'reason', 'fabric_unavailable', 'message',
      'Sorry — ' || v_text || '. ' || v_shop || ' will suggest another fabric in the chat.');
  end if;

  update public.orders
     set quote_status = 'accepted', accepted_at = now(), fabric_problem = null,
         due_date = greatest(coalesce(due_date, current_date), current_date + 14),
         assigned_cutting = coalesce(nullif(assigned_cutting, ''), public.wv_pick_tailor(designer_id, 'cutting')),
         assigned_sewing = coalesce(nullif(assigned_sewing, ''), public.wv_pick_tailor(designer_id, 'sewing')),
         assigned_embroidery = coalesce(nullif(assigned_embroidery, ''), public.wv_pick_tailor(designer_id, 'embroidery')),
         assigned_finishing = coalesce(nullif(assigned_finishing, ''), public.wv_pick_tailor(designer_id, 'finishing')),
         assigned_quality_control = coalesce(nullif(assigned_quality_control, ''), public.wv_pick_tailor(designer_id, 'quality_control'))
   where id = o.id
  returning * into o;

  perform public.wv_order_take_fabric(o);
  perform public.wv_post_system_message(o.id,
    'Quote accepted. ' || public.wv_length_text(o.fabric_yards, o.fabric_unit) || ' of ' || v_fabric.name || ' is bought for your outfit. '
    || 'Next: pay your deposit of ' || public.wv_money_text(o.deposit_amount, o.currency_code) || ' and we''ll start making it.');
  return jsonb_build_object('ok', true, 'deposit', o.deposit_amount, 'currency', o.currency_code);
end $$;

-- A fabric that sells out: the message uses the tailor's unit
create or replace function public.wv_fabrics_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_text text;
begin
  for r in
    select o.id, o.quote_status, o.fabric_yards, o.designer_id, o.fabric_unit from public.orders o
    where o.fabric_id = new.id and o.quote_status in ('requested', 'quoted') and o.fabric_problem is null
  loop
    if public.wv_fabric_can_sell(old, r.fabric_yards) and not public.wv_fabric_can_sell(new, r.fabric_yards) then
      v_text := case
        when new.deleted_at is not null or new.status <> 'approved' then new.name || ' is no longer on sale'
        when new.sold_out or coalesce(new.yards_available, 0) < greatest(coalesce(new.min_order_yards, 0), 0.01) then new.name || ' has sold out'
        else 'Only ' || public.wv_length_text(new.yards_available, r.fabric_unit) || ' of ' || new.name || ' is left' end;
      update public.orders
         set fabric_problem = v_text, quote_status = 'requested', updated_at = now()
       where id = r.id;
      perform public.wv_post_system_message(r.id,
        'Sorry — ' || v_text || ', so ' || case when r.quote_status = 'quoted' then 'this quote can''t be accepted any more. ' else '' end
        || public.wv_designer_name(r.designer_id) || ' will suggest another fabric here in the chat and send you a new quote.');
    end if;
  end loop;
  return null;
end $$;

-- One tailor's public page: as before, plus their currency, how they
-- measure fabric, and their lowest tailoring price ("Tailoring from ₦95,000")
create or replace function public.wearvia_tailor_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', d.id, 'slug', d.slug, 'business_name', d.business_name, 'profile_image_url', d.profile_image_url,
    'description', d.description, 'country_code', d.country_code, 'city', d.city, 'postcode_area', d.postcode_area,
    'public_address', d.public_address, 'location', d.location, 'speciality_tags', d.speciality_tags,
    'delivery_available', d.delivery_available, 'custom_orders', d.custom_orders,
    'rating', case when d.review_count > 0 then d.rating end, 'review_count', d.review_count,
    'starting_price', d.starting_price, 'delivery_estimate', d.delivery_estimate,
    'latitude', d.public_latitude, 'longitude', d.public_longitude, 'admin_status', d.admin_status,
    'currency_code', d.currency_code, 'fabric_unit', public.wv_country_unit(d.country_code),
    'from_price', (select min(p.price) from public.price_list p
                   where p.designer_id = d.id and p.kind = 'outfit' and p.currency_code = d.currency_code),
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'image_url', p.image_url, 'title', p.title,
                                                             'caption', p.caption, 'outfit_category', p.outfit_category)
                                           order by p.sort_order nulls last, p.created_at)
                           from public.designer_portfolio_items p where p.designer_id = d.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'description', s.description, 'price', s.price)
                                          order by s.created_at)
                          from public.designer_services s where s.designer_id = d.id), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(x.r order by x.created_at desc) from (
                           select jsonb_build_object('rating', r.rating, 'text', r.review_text, 'created_at', r.created_at,
                                                     'who', coalesce(nullif(split_part(trim(c.name), ' ', 1), ''), 'A customer'),
                                                     'outfit', o.outfit_type) as r, r.created_at
                           from public.reviews r
                           left join public.customers c on c.id = r.customer_id
                           left join public.orders o on o.id = r.order_id
                           where r.designer_id = d.id
                           order by r.created_at desc limit 20) x), '[]'::jsonb))
  from public.designers d
  where d.slug = lower(p_slug) and (d.admin_status = 'approved' or public.can_manage_designer(d.id))
$$;


-- ---------------------------------------------------------------------
-- 7. Who can call what
-- ---------------------------------------------------------------------
revoke execute on function public.wearvia_send_quote(uuid, numeric, uuid, text, text) from public, anon;
grant execute on function public.wearvia_send_quote(uuid, numeric, uuid, text, text) to authenticated;
revoke execute on function public.wearvia_accept_quote(uuid, numeric) from public, anon;
grant execute on function public.wearvia_accept_quote(uuid, numeric) to authenticated;
revoke execute on function public.wearvia_convert_price_list(uuid) from public, anon;
grant execute on function public.wearvia_convert_price_list(uuid) to authenticated;
revoke execute on function public.wearvia_tailor_page(text) from public;
grant execute on function public.wearvia_tailor_page(text) to anon, authenticated;
-- Formatting helpers are harmless; the rest are internal
grant execute on function public.wv_money_text(numeric, text) to anon, authenticated;
revoke execute on function public.wv_convert_designer_prices(uuid) from public, anon, authenticated;
revoke execute on function public.wv_seed_price_list(uuid) from public, anon, authenticated;
revoke execute on function public.wv_order_take_fabric(public.orders) from public, anon, authenticated;
revoke execute on function public.wv_quote_lines_fx(text, numeric, text, numeric, text, numeric, numeric, date, text, numeric, text, numeric, text, numeric, numeric)
  from public, anon, authenticated;
revoke execute on function public.wv_list_price(uuid, text, text, text) from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['wv_designers_currency()', 'wv_designers_currency_after()', 'wv_designer_services_convert()',
                           'wv_price_list_currency()', 'wv_suppliers_currency()', 'wv_suppliers_currency_after()',
                           'wv_fabrics_currency()', 'wv_payments_currency()', 'wv_invoices_currency()', 'wv_fabric_lines_currency()',
                           'wv_rtw_items_currency()', 'wv_rtw_sales_currency()', 'wv_customers_worldwide()', 'wv_orders_guard_currency()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;

-- Tell the Supabase API about the new tables, columns and functions straight away
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 8. Report — every line should say "OK".
-- ---------------------------------------------------------------------
-- Line 6 tries a real quote and then undoes it, so it changes nothing:
-- a London tailor (GBP) and a Lagos tailor (NGN) both quote 4.5 yd of a
-- Lagos fabric seller's Aso Oke priced in naira.
drop table if exists pg_temp.wv_ww_live;
create temp table wv_ww_live (n integer, check_name text, result text);

do $$
declare
  v_admin    uuid := (select p.id from public.profiles p where p.role::text = 'admin' order by p.created_at limit 1);
  v_london   uuid := gen_random_uuid();
  v_lagos    uuid := gen_random_uuid();
  v_seller   uuid := gen_random_uuid();
  v_fabric   uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_o1       uuid := gen_random_uuid();
  v_o2       uuid := gen_random_uuid();
  v_order    public.orders%rowtype;
  v_line     public.fabric_order_lines%rowtype;
  v_invoice  public.invoices%rowtype;
  v_pay      text;
  v_london_ok boolean := false;
  v_lagos_ok  boolean := false;
  v_after_ok  boolean := false;
  v_seed_ok   boolean := false;
  v_detail    text := '';
begin
  if v_admin is null then
    insert into wv_ww_live values (6, 'A London and a Lagos tailor quote a Lagos seller''s fabric (tried and undone)',
      'OK (skipped: there''s no admin yet — run select public.wearvia_make_owner(''your email''); then run this file again)');
    return;
  end if;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    -- Today's rates for GBP and NGN, just for this test if there are none yet (undone below)
    insert into public.exchange_rates (currency_code, units_per_usd, rate_date, source) values
      ('USD', 1, current_date, 'report test'), ('GBP', 0.75, current_date, 'report test'), ('NGN', 1500, current_date, 'report test')
    on conflict (currency_code) do update set rate_date = greatest(public.exchange_rates.rate_date, current_date);

    -- (no owner: the admin looks after them, so no real account gets a second business, even for a moment)
    insert into public.designers (id, business_name, owner_user_id, country_code, city, admin_status, approved, custom_orders, speciality_tags)
    values (v_london, 'Report Test London Tailor', null, 'GB', 'London', 'approved', true, true, '{}'),
           (v_lagos, 'Report Test Lagos Tailor', null, 'NG', 'Lagos', 'approved', true, true, '{}');
    perform public.wv_seed_price_list(v_london);
    perform public.wv_seed_price_list(v_lagos);
    v_seed_ok := (select currency_code from public.designers where id = v_london) = 'GBP'
             and (select currency_code from public.designers where id = v_lagos) = 'NGN'
             and not exists (select 1 from public.price_list where designer_id = v_lagos and currency_code <> 'NGN')
             and (select price from public.price_list where designer_id = v_london and kind = 'outfit' and name = 'Agbada') = 280;

    insert into public.suppliers (id, name, location, delivery_estimate, country_code, owner_user_id)
    values (v_seller, 'Report Test Lagos Fabrics', 'Balogun Market, Lagos', '2–4 days', 'NG', null);
    insert into public.fabrics (id, supplier_id, name, category, price_per_yard, yards_available, min_order_yards, status)
    values (v_fabric, v_seller, 'Report Test Aso Oke', 'Aso Oke', 15000, 40, 1, 'approved');
    insert into public.customers (id, name) values (v_customer, 'Report Test Customer');

    -- The customer sends a request to each tailor (as a customer, not the team)
    perform set_config('request.jwt.claims', '', true);
    insert into public.orders (id, customer_id, designer_id, outfit_type, colour, embroidery, fabric_id)
    values (v_o1, v_customer, v_london, 'Agbada', '#1e2a44', 'Gold', v_fabric),
           (v_o2, v_customer, v_lagos, 'Agbada', '#1e2a44', 'Gold', v_fabric);

    -- Each tailor sends a quote for 4.5 yd
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform public.wearvia_send_quote(v_o1, 4.5, null, null, 'yd');
    perform public.wearvia_send_quote(v_o2, 4.5, null, null, 'yd');

    select * into v_order from public.orders where id = v_o1;
    v_london_ok := v_order.currency_code = 'GBP' and v_order.fabric_currency_code = 'NGN'
               and v_order.fabric_cost_in_fabric_currency = 67500 and v_order.exchange_rate > 0 and v_order.exchange_rate_date is not null
               and v_order.fabric_cost = round(67500 * v_order.exchange_rate, 2)
               and v_order.quote_total = v_order.fabric_cost + 280 + 60 + 15
               and v_order.line_items -> 0 ->> 'label' like '%₦15,000%' and v_order.line_items -> 0 ->> 'label' like '%£1 = ₦%';
    v_detail := 'London: ' || public.wv_money_text(v_order.quote_total, v_order.currency_code) || ' incl. fabric '
                || public.wv_money_text(v_order.fabric_cost, 'GBP') || ' at ' || public.wv_rate_text(v_order.exchange_rate, 'NGN', 'GBP');

    -- The London customer accepts: the seller is paid in naira, the invoice is in pounds
    update public.orders set quote_status = 'accepted', accepted_at = now() where id = v_o1 returning * into v_order;
    perform public.wv_order_take_fabric(v_order);
    insert into public.payments (order_id, amount, method, kind, status) values (v_o1, v_order.deposit_amount, 'Card', 'Deposit', 'awaiting_confirmation');
    select * into v_line from public.fabric_order_lines where order_id = v_o1;
    select * into v_invoice from public.invoices where order_id = v_o1;
    select currency_code into v_pay from public.payments where order_id = v_o1;
    v_after_ok := v_line.currency_code = 'NGN' and v_line.total = 67500 and v_invoice.currency_code = 'GBP'
              and v_invoice.total = v_order.quote_total and v_pay = 'GBP';

    select * into v_order from public.orders where id = v_o2;
    v_lagos_ok := v_order.currency_code = 'NGN' and v_order.fabric_currency_code = 'NGN' and v_order.exchange_rate is null
              and v_order.fabric_cost = 67500
              and v_order.tailoring_cost = (select price from public.price_list where designer_id = v_lagos and kind = 'outfit' and name = 'Agbada');
    v_detail := v_detail || '; Lagos: ' || public.wv_money_text(v_order.quote_total, v_order.currency_code) || ', no conversion';

    raise exception using errcode = 'P0001', message = 'wv_undo';
  exception when sqlstate 'P0001' then
    null;   -- everything above is undone
  when others then
    v_detail := 'failed: ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into wv_ww_live values (6, 'A London and a Lagos tailor quote a Lagos seller''s fabric (tried and undone)',
    case when v_london_ok and v_lagos_ok and v_after_ok and v_seed_ok then 'OK (' || v_detail || ')'
         else 'NOT WORKING — tell your developer (' || v_detail || '; London ' || v_london_ok || ', Lagos ' || v_lagos_ok
              || ', seller line and invoice ' || v_after_ok || ', price lists ' || v_seed_ok || ')' end);
end $$;

with checks as (
  select 1 as n, 'Existing orders, invoices, payments, prices, fabrics and measurements unchanged' as check_name,
         case when not exists (
                select kind, id, fingerprint from wv_ww_before
                except
                (select 'order', id::text, md5(row(designer_id, customer_id, order_number, fabric_id, fabric_yards, fabric_cost,
                          tailoring_cost, embroidery_cost, delivery_cost, quote_total, deposit_amount, line_items, deposit_paid_at,
                          balance_paid_at, stage, quote_status)::text) from public.orders
                 union all select 'invoice', id::text, md5(row(order_id, total, line_items)::text) from public.invoices
                 union all select 'payment', id::text, md5(row(order_id, amount, status)::text) from public.payments
                 union all select 'price', id::text, md5(row(designer_id, kind, name, price, yards)::text) from public.price_list
                 union all select 'fabric', id::text, md5(row(price_per_yard, yards_available, min_order_yards)::text) from public.fabrics
                 union all select 'seller line', id::text, md5(row(yards, price_per_yard, total, status)::text) from public.fabric_order_lines
                 union all select 'ready to wear', id::text, md5(row(price, cost, stock)::text) from public.ready_to_wear_items
                 union all select 'ready to wear sale', id::text, md5(row(price, cost, status)::text) from public.ready_to_wear_sales
                 union all select 'measurements', id::text, md5(row(chest, waist, shoulder, sleeve, trouser_length, neck, hip, garment_length)::text)
                           from public.measurement_profiles))
              then 'OK (' || (select count(*) from wv_ww_before where kind = 'order') || ' orders, '
                   || (select count(*) from wv_ww_before where kind = 'payment') || ' payments, '
                   || (select count(*) from wv_ww_before where kind = 'price') || ' prices, '
                   || (select count(*) from wv_ww_before where kind = 'fabric') || ' fabrics checked)'
              else 'CHANGED — tell your developer' end as result
  union all
  select 2, 'Orders, invoices and payments from before are in GBP',
         case when exists (select 1 from public.orders where created_at < (select min(ran_at) from public.wv_worldwide_runs) and currency_code <> 'GBP')
                or exists (select 1 from public.invoices where created_at < (select min(ran_at) from public.wv_worldwide_runs) and currency_code <> 'GBP')
                or exists (select 1 from public.payments where created_at < (select min(ran_at) from public.wv_worldwide_runs) and currency_code <> 'GBP')
              then 'NOT GBP — tell your developer'
              else 'OK (' || (select count(*) from public.orders where created_at < (select min(ran_at) from public.wv_worldwide_runs)) || ' orders in GBP)' end
  union all
  select 3, 'Every tailor, seller, price, fabric, order, invoice and payment has a currency',
         case when not exists (select 1 from public.designers where currency_code is null)
               and not exists (select 1 from public.suppliers where currency_code is null)
               and not exists (select 1 from public.price_list where currency_code is null)
               and not exists (select 1 from public.fabrics where currency_code is null)
               and not exists (select 1 from public.orders where currency_code is null)
               and not exists (select 1 from public.fabrics f join public.suppliers s on s.id = f.supplier_id where f.currency_code <> s.currency_code)
               and (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname in
                    ('wv_designers_currency', 'wv_suppliers_currency', 'wv_price_list_currency', 'wv_fabrics_currency', 'wv_payments_currency',
                     'wv_invoices_currency', 'wv_fabric_lines_currency', 'wv_customers_worldwide', 'wv_orders_guard_currency')) = 9
              then 'OK (' || (select string_agg(currency_code || ' ' || n, ', ' order by n desc) from
                              (select currency_code, count(*) n from public.designers group by currency_code) x) || ' tailors)'
              else 'MISSING — tell your developer' end
  union all
  select 4, 'Countries: currency, phone code, yards or metres',
         case when not exists (select 1 from public.countries where currency_code is null or fabric_unit is null)
               and (select currency_code || fabric_unit from public.countries where code = 'GB') = 'GBPyd'
               and (select currency_code || fabric_unit from public.countries where code = 'NG') = 'NGNyd'
               and (select currency_code || fabric_unit from public.countries where code = 'GH') = 'GHSyd'
               and (select currency_code || fabric_unit from public.countries where code = 'US') = 'USDyd'
               and (select currency_code || fabric_unit from public.countries where code = 'KE') = 'KESm'
               and (select phone_code from public.countries where code = 'NG') = '+234'
              then 'OK (' || (select count(*) from public.countries) || ' countries, ' || (select count(*) from public.currencies) || ' currencies; '
                   || (select count(*) from public.countries where fabric_unit = 'yd') || ' sell fabric in yards)'
              else 'MISSING — tell your developer' end
  union all
  select 5, 'Money is written the right way',
         case when public.wv_money_text(1250, 'GBP') = '£1,250' and public.wv_money_text(1250.5, 'GBP') = '£1,250.50'
               and public.wv_money_text(250000, 'NGN') = '₦250,000' and public.wv_money_text(1250, 'USD') = '$1,250.00'
               and public.wv_money_text(1250, 'GHS') = 'GH₵1,250.00' and public.wv_money_text(1250, 'KES') = 'KSh 1,250.00'
               and public.wv_money_text(12.5, 'GBP') = public.wv_money_text(12.5)
              then 'OK (£1,250 · ₦250,000 · $1,250.00 · ' || public.wv_money_text(1250, 'EUR') || ' · ' || public.wv_money_text(1250, 'CAD')
                   || ' · ' || public.wv_money_text(1250, 'ZAR') || ' · ' || public.wv_money_text(1250, 'KES') || ')'
              else 'WRONG — tell your developer' end
  union all
  select n, check_name, result from wv_ww_live
  union all
  select 7, 'Exchange rates: everyone reads them, only the daily update changes them',
         case when (select relrowsecurity from pg_class where oid = 'public.exchange_rates'::regclass)
               and has_table_privilege('anon', 'public.exchange_rates', 'select')
               and not has_table_privilege('anon', 'public.exchange_rates', 'insert, update, delete')
               and not has_table_privilege('authenticated', 'public.exchange_rates', 'insert, update, delete')
               and not has_function_privilege('anon', 'public.wearvia_save_exchange_rates(jsonb, date, text)', 'execute')
               and not has_function_privilege('authenticated', 'public.wearvia_save_exchange_rates(jsonb, date, text)', 'execute')
               and not has_table_privilege('authenticated', 'public.currencies', 'insert, update, delete')
              then case when exists (select 1 from public.exchange_rates where currency_code in ('NGN', 'GHS'))
                        then 'OK (' || (select count(*) from public.exchange_rates) || ' rates, updated '
                             || to_char((select max(rate_date) from public.exchange_rates), 'DD Mon YYYY') || ': '
                             || coalesce((select public.wv_rate_text(x.rate, 'GBP', 'NGN') from public.wv_fx('GBP', 'NGN', false) x), '?') || ')'
                        else 'OK (no rates yet — run GitHub → Actions → Exchange rates → Run workflow once)' end
              else 'NOT LOCKED — tell your developer' end
  union all
  select 8, 'The app can''t change an order''s currency or exchange rate',
         case when exists (select 1 from pg_trigger where tgname = 'wv_orders_guard_currency' and tgrelid = 'public.orders'::regclass and tgenabled <> 'D')
               and has_function_privilege('authenticated', 'public.wearvia_send_quote(uuid, numeric, uuid, text, text)', 'execute')
               and not has_function_privilege('anon', 'public.wearvia_send_quote(uuid, numeric, uuid, text, text)', 'execute')
               and to_regprocedure('public.wearvia_send_quote(uuid, numeric, uuid, text)') is null
               and (select prosrc from pg_proc where oid = 'public.wearvia_send_quote(uuid, numeric, uuid, text, text)'::regprocedure) ilike '%wv_fx(v_fcur, v_cur)%'
              then 'OK' else 'NOT LOCKED — tell your developer' end
)
select check_name, result from (
  select n, check_name, result from checks
  union all
  select 99, 'ALL DONE', case when bool_and(result like 'OK%') then 'OK — you can merge the app update'
                              else 'NOT OK — see the lines above and tell your developer' end
  from checks
) report
order by n;
