-- =====================================================================
-- Wearvia — Tailors Near Me: many tailors, each with their own dashboard
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it after setup.sql, yards.sql, prices.sql and tailor-quote.sql,
-- before the app update with "Find tailors near me" goes live.
--
-- What it does:
--   1. Countries (the full international list, with flags and miles/km)
--      and specialities (Agbada, Kaftan, … — the admin can add more).
--   2. Tailor profile fields on the existing designers table: web address
--      (slug), country, city, postcode, full address and "show exact
--      address", latitude/longitude, delivery, custom orders, review count,
--      and an approval status. New tailors wait for the admin to approve them.
--   3. Each tailor has their own price list (the existing prices become
--      Nebeda Threads' list, unchanged; new tailors start with the default
--      prices) and their own private notes about customers.
--   4. Everything that assumed one designer (Nebeda Threads) now works per
--      tailor: new orders, quotes, the chat, payments, team logins.
--   5. Security: anyone can read an APPROVED tailor's public profile. Exact
--      addresses, postcodes and map positions of tailors who hide them are
--      never readable — the public only sees a position rounded to about
--      1 km and the postcode district (e.g. "SE15"). Only the owner edits
--      their profile; only the admin approves or hides tailors. Each tailor's
--      team sees only their own customers, orders, chats and payments.
--   6. A search function that finds approved tailors near a point, fast even
--      with thousands of tailors (a latitude/longitude box on an index, then
--      the exact distance), with filters and paging.
--   7. A public "designer-photos" bucket for tailors' logos and portfolios.
--   8. A report at the end. Every line should say OK.
--
-- Safe to run more than once. Nothing is deleted, and existing orders,
-- invoices, payments and prices are never changed (the report checks this).
-- Nebeda Threads stays designer number one. Everything runs in one
-- transaction: if any step fails, nothing is changed.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. A copy of what must not change, for the report at the end
--    (temporary tables: they disappear when you close the SQL Editor tab)
-- ---------------------------------------------------------------------
drop table if exists pg_temp.wv_tnm_before;
create temp table wv_tnm_before as
  select 'order' as kind, id::text as id, md5(row(designer_id, customer_id, order_number, fabric_id, fabric_yards, fabric_cost,
           tailoring_cost, embroidery_cost, delivery_cost, quote_total, deposit_amount, line_items, deposit_paid_at,
           balance_paid_at, stage, quote_status)::text) as fingerprint
  from public.orders
  union all
  select 'invoice', id::text, md5(row(order_id, total, line_items)::text) from public.invoices
  union all
  select 'payment', id::text, md5(row(order_id, amount, status)::text) from public.payments
  union all
  select 'price', id::text, md5(row(kind, name, price, yards)::text) from public.price_list;


-- ---------------------------------------------------------------------
-- 1. Countries and specialities
-- ---------------------------------------------------------------------

create table if not exists public.countries (
  code        text primary key check (code ~ '^[A-Z]{2}$'),   -- ISO 3166-1 alpha-2, e.g. GB
  name        text not null,
  slug        text not null unique,                          -- used in web addresses: /tailors/uk/london/
  flag        text not null default '',
  uses_miles  boolean not null default false,               -- distances shown in miles by default
  sort_order  integer not null default 100
);

insert into public.countries (code, name, slug) values
  ('AF', 'Afghanistan', 'afghanistan'),
  ('AX', 'Åland Islands', 'aland-islands'),
  ('AL', 'Albania', 'albania'),
  ('DZ', 'Algeria', 'algeria'),
  ('AS', 'American Samoa', 'american-samoa'),
  ('AD', 'Andorra', 'andorra'),
  ('AO', 'Angola', 'angola'),
  ('AI', 'Anguilla', 'anguilla'),
  ('AQ', 'Antarctica', 'antarctica'),
  ('AG', 'Antigua and Barbuda', 'antigua-and-barbuda'),
  ('AR', 'Argentina', 'argentina'),
  ('AM', 'Armenia', 'armenia'),
  ('AW', 'Aruba', 'aruba'),
  ('AU', 'Australia', 'australia'),
  ('AT', 'Austria', 'austria'),
  ('AZ', 'Azerbaijan', 'azerbaijan'),
  ('BS', 'Bahamas', 'bahamas'),
  ('BH', 'Bahrain', 'bahrain'),
  ('BD', 'Bangladesh', 'bangladesh'),
  ('BB', 'Barbados', 'barbados'),
  ('BY', 'Belarus', 'belarus'),
  ('BE', 'Belgium', 'belgium'),
  ('BZ', 'Belize', 'belize'),
  ('BJ', 'Benin', 'benin'),
  ('BM', 'Bermuda', 'bermuda'),
  ('BT', 'Bhutan', 'bhutan'),
  ('BO', 'Bolivia', 'bolivia'),
  ('BQ', 'Caribbean Netherlands', 'caribbean-netherlands'),
  ('BA', 'Bosnia and Herzegovina', 'bosnia-and-herzegovina'),
  ('BW', 'Botswana', 'botswana'),
  ('BV', 'Bouvet Island', 'bouvet-island'),
  ('BR', 'Brazil', 'brazil'),
  ('IO', 'British Indian Ocean Territory', 'british-indian-ocean-territory'),
  ('BN', 'Brunei', 'brunei'),
  ('BG', 'Bulgaria', 'bulgaria'),
  ('BF', 'Burkina Faso', 'burkina-faso'),
  ('BI', 'Burundi', 'burundi'),
  ('CV', 'Cape Verde', 'cape-verde'),
  ('KH', 'Cambodia', 'cambodia'),
  ('CM', 'Cameroon', 'cameroon'),
  ('CA', 'Canada', 'canada'),
  ('KY', 'Cayman Islands', 'cayman-islands'),
  ('CF', 'Central African Republic', 'central-african-republic'),
  ('TD', 'Chad', 'chad'),
  ('CL', 'Chile', 'chile'),
  ('CN', 'China', 'china'),
  ('CX', 'Christmas Island', 'christmas-island'),
  ('CC', 'Cocos (Keeling) Islands', 'cocos-keeling-islands'),
  ('CO', 'Colombia', 'colombia'),
  ('KM', 'Comoros', 'comoros'),
  ('CG', 'Congo', 'congo'),
  ('CD', 'DR Congo', 'dr-congo'),
  ('CK', 'Cook Islands', 'cook-islands'),
  ('CR', 'Costa Rica', 'costa-rica'),
  ('CI', 'Côte d''Ivoire', 'cote-d-ivoire'),
  ('HR', 'Croatia', 'croatia'),
  ('CU', 'Cuba', 'cuba'),
  ('CW', 'Curaçao', 'curacao'),
  ('CY', 'Cyprus', 'cyprus'),
  ('CZ', 'Czechia', 'czechia'),
  ('DK', 'Denmark', 'denmark'),
  ('DJ', 'Djibouti', 'djibouti'),
  ('DM', 'Dominica', 'dominica'),
  ('DO', 'Dominican Republic', 'dominican-republic'),
  ('EC', 'Ecuador', 'ecuador'),
  ('EG', 'Egypt', 'egypt'),
  ('SV', 'El Salvador', 'el-salvador'),
  ('GQ', 'Equatorial Guinea', 'equatorial-guinea'),
  ('ER', 'Eritrea', 'eritrea'),
  ('EE', 'Estonia', 'estonia'),
  ('SZ', 'Eswatini', 'eswatini'),
  ('ET', 'Ethiopia', 'ethiopia'),
  ('FK', 'Falkland Islands', 'falkland-islands'),
  ('FO', 'Faroe Islands', 'faroe-islands'),
  ('FJ', 'Fiji', 'fiji'),
  ('FI', 'Finland', 'finland'),
  ('FR', 'France', 'france'),
  ('GF', 'French Guiana', 'french-guiana'),
  ('PF', 'French Polynesia', 'french-polynesia'),
  ('TF', 'French Southern Territories', 'french-southern-territories'),
  ('GA', 'Gabon', 'gabon'),
  ('GM', 'Gambia', 'gambia'),
  ('GE', 'Georgia', 'georgia'),
  ('DE', 'Germany', 'germany'),
  ('GH', 'Ghana', 'ghana'),
  ('GI', 'Gibraltar', 'gibraltar'),
  ('GR', 'Greece', 'greece'),
  ('GL', 'Greenland', 'greenland'),
  ('GD', 'Grenada', 'grenada'),
  ('GP', 'Guadeloupe', 'guadeloupe'),
  ('GU', 'Guam', 'guam'),
  ('GT', 'Guatemala', 'guatemala'),
  ('GG', 'Guernsey', 'guernsey'),
  ('GN', 'Guinea', 'guinea'),
  ('GW', 'Guinea-Bissau', 'guinea-bissau'),
  ('GY', 'Guyana', 'guyana'),
  ('HT', 'Haiti', 'haiti'),
  ('HM', 'Heard Island and McDonald Islands', 'heard-island-and-mcdonald-islands'),
  ('VA', 'Vatican City', 'vatican-city'),
  ('HN', 'Honduras', 'honduras'),
  ('HK', 'Hong Kong', 'hong-kong'),
  ('HU', 'Hungary', 'hungary'),
  ('IS', 'Iceland', 'iceland'),
  ('IN', 'India', 'india'),
  ('ID', 'Indonesia', 'indonesia'),
  ('IR', 'Iran', 'iran'),
  ('IQ', 'Iraq', 'iraq'),
  ('IE', 'Ireland', 'ireland'),
  ('IM', 'Isle of Man', 'isle-of-man'),
  ('IL', 'Israel', 'israel'),
  ('IT', 'Italy', 'italy'),
  ('JM', 'Jamaica', 'jamaica'),
  ('JP', 'Japan', 'japan'),
  ('JE', 'Jersey', 'jersey'),
  ('JO', 'Jordan', 'jordan'),
  ('KZ', 'Kazakhstan', 'kazakhstan'),
  ('KE', 'Kenya', 'kenya'),
  ('KI', 'Kiribati', 'kiribati'),
  ('KP', 'North Korea', 'north-korea'),
  ('KR', 'South Korea', 'south-korea'),
  ('KW', 'Kuwait', 'kuwait'),
  ('KG', 'Kyrgyzstan', 'kyrgyzstan'),
  ('LA', 'Laos', 'laos'),
  ('LV', 'Latvia', 'latvia'),
  ('LB', 'Lebanon', 'lebanon'),
  ('LS', 'Lesotho', 'lesotho'),
  ('LR', 'Liberia', 'liberia'),
  ('LY', 'Libya', 'libya'),
  ('LI', 'Liechtenstein', 'liechtenstein'),
  ('LT', 'Lithuania', 'lithuania'),
  ('LU', 'Luxembourg', 'luxembourg'),
  ('MO', 'Macao', 'macao'),
  ('MG', 'Madagascar', 'madagascar'),
  ('MW', 'Malawi', 'malawi'),
  ('MY', 'Malaysia', 'malaysia'),
  ('MV', 'Maldives', 'maldives'),
  ('ML', 'Mali', 'mali'),
  ('MT', 'Malta', 'malta'),
  ('MH', 'Marshall Islands', 'marshall-islands'),
  ('MQ', 'Martinique', 'martinique'),
  ('MR', 'Mauritania', 'mauritania'),
  ('MU', 'Mauritius', 'mauritius'),
  ('YT', 'Mayotte', 'mayotte'),
  ('MX', 'Mexico', 'mexico'),
  ('FM', 'Micronesia', 'micronesia'),
  ('MD', 'Moldova', 'moldova'),
  ('MC', 'Monaco', 'monaco'),
  ('MN', 'Mongolia', 'mongolia'),
  ('ME', 'Montenegro', 'montenegro'),
  ('MS', 'Montserrat', 'montserrat'),
  ('MA', 'Morocco', 'morocco'),
  ('MZ', 'Mozambique', 'mozambique'),
  ('MM', 'Myanmar', 'myanmar'),
  ('NA', 'Namibia', 'namibia'),
  ('NR', 'Nauru', 'nauru'),
  ('NP', 'Nepal', 'nepal'),
  ('NL', 'Netherlands', 'netherlands'),
  ('NC', 'New Caledonia', 'new-caledonia'),
  ('NZ', 'New Zealand', 'new-zealand'),
  ('NI', 'Nicaragua', 'nicaragua'),
  ('NE', 'Niger', 'niger'),
  ('NG', 'Nigeria', 'nigeria'),
  ('NU', 'Niue', 'niue'),
  ('NF', 'Norfolk Island', 'norfolk-island'),
  ('MK', 'North Macedonia', 'north-macedonia'),
  ('MP', 'Northern Mariana Islands', 'northern-mariana-islands'),
  ('NO', 'Norway', 'norway'),
  ('OM', 'Oman', 'oman'),
  ('PK', 'Pakistan', 'pakistan'),
  ('PW', 'Palau', 'palau'),
  ('PS', 'Palestine', 'palestine'),
  ('PA', 'Panama', 'panama'),
  ('PG', 'Papua New Guinea', 'papua-new-guinea'),
  ('PY', 'Paraguay', 'paraguay'),
  ('PE', 'Peru', 'peru'),
  ('PH', 'Philippines', 'philippines'),
  ('PN', 'Pitcairn Islands', 'pitcairn-islands'),
  ('PL', 'Poland', 'poland'),
  ('PT', 'Portugal', 'portugal'),
  ('PR', 'Puerto Rico', 'puerto-rico'),
  ('QA', 'Qatar', 'qatar'),
  ('RE', 'Réunion', 'reunion'),
  ('RO', 'Romania', 'romania'),
  ('RU', 'Russia', 'russia'),
  ('RW', 'Rwanda', 'rwanda'),
  ('BL', 'Saint Barthélemy', 'saint-barthelemy'),
  ('SH', 'Saint Helena', 'saint-helena'),
  ('KN', 'Saint Kitts and Nevis', 'saint-kitts-and-nevis'),
  ('LC', 'Saint Lucia', 'saint-lucia'),
  ('MF', 'Saint Martin', 'saint-martin'),
  ('PM', 'Saint Pierre and Miquelon', 'saint-pierre-and-miquelon'),
  ('VC', 'Saint Vincent and the Grenadines', 'saint-vincent-and-the-grenadines'),
  ('WS', 'Samoa', 'samoa'),
  ('SM', 'San Marino', 'san-marino'),
  ('ST', 'São Tomé and Príncipe', 'sao-tome-and-principe'),
  ('SA', 'Saudi Arabia', 'saudi-arabia'),
  ('SN', 'Senegal', 'senegal'),
  ('RS', 'Serbia', 'serbia'),
  ('SC', 'Seychelles', 'seychelles'),
  ('SL', 'Sierra Leone', 'sierra-leone'),
  ('SG', 'Singapore', 'singapore'),
  ('SX', 'Sint Maarten', 'sint-maarten'),
  ('SK', 'Slovakia', 'slovakia'),
  ('SI', 'Slovenia', 'slovenia'),
  ('SB', 'Solomon Islands', 'solomon-islands'),
  ('SO', 'Somalia', 'somalia'),
  ('ZA', 'South Africa', 'south-africa'),
  ('GS', 'South Georgia and the South Sandwich Islands', 'south-georgia-and-the-south-sandwich-islands'),
  ('SS', 'South Sudan', 'south-sudan'),
  ('ES', 'Spain', 'spain'),
  ('LK', 'Sri Lanka', 'sri-lanka'),
  ('SD', 'Sudan', 'sudan'),
  ('SR', 'Suriname', 'suriname'),
  ('SJ', 'Svalbard and Jan Mayen', 'svalbard-and-jan-mayen'),
  ('SE', 'Sweden', 'sweden'),
  ('CH', 'Switzerland', 'switzerland'),
  ('SY', 'Syria', 'syria'),
  ('TW', 'Taiwan', 'taiwan'),
  ('TJ', 'Tajikistan', 'tajikistan'),
  ('TZ', 'Tanzania', 'tanzania'),
  ('TH', 'Thailand', 'thailand'),
  ('TL', 'Timor-Leste', 'timor-leste'),
  ('TG', 'Togo', 'togo'),
  ('TK', 'Tokelau', 'tokelau'),
  ('TO', 'Tonga', 'tonga'),
  ('TT', 'Trinidad and Tobago', 'trinidad-and-tobago'),
  ('TN', 'Tunisia', 'tunisia'),
  ('TR', 'Türkiye', 'turkiye'),
  ('TM', 'Turkmenistan', 'turkmenistan'),
  ('TC', 'Turks and Caicos Islands', 'turks-and-caicos-islands'),
  ('TV', 'Tuvalu', 'tuvalu'),
  ('UG', 'Uganda', 'uganda'),
  ('UA', 'Ukraine', 'ukraine'),
  ('AE', 'United Arab Emirates', 'uae'),
  ('GB', 'United Kingdom', 'uk'),
  ('US', 'United States', 'usa'),
  ('UM', 'US Minor Outlying Islands', 'us-minor-outlying-islands'),
  ('UY', 'Uruguay', 'uruguay'),
  ('UZ', 'Uzbekistan', 'uzbekistan'),
  ('VU', 'Vanuatu', 'vanuatu'),
  ('VE', 'Venezuela', 'venezuela'),
  ('VN', 'Vietnam', 'vietnam'),
  ('VG', 'British Virgin Islands', 'british-virgin-islands'),
  ('VI', 'US Virgin Islands', 'us-virgin-islands'),
  ('WF', 'Wallis and Futuna', 'wallis-and-futuna'),
  ('EH', 'Western Sahara', 'western-sahara'),
  ('YE', 'Yemen', 'yemen'),
  ('ZM', 'Zambia', 'zambia'),
  ('ZW', 'Zimbabwe', 'zimbabwe')
on conflict (code) do nothing;

-- Flags are made from the two letters (🇬🇧 = regional indicators G + B)
update public.countries
   set flag = chr(127397 + ascii(substr(code, 1, 1))) || chr(127397 + ascii(substr(code, 2, 1)))
 where flag = '';
-- Miles in the UK and the US, km everywhere else; the UK, Nigeria and the US first in lists
update public.countries set uses_miles = true where code in ('GB', 'US') and not uses_miles;
update public.countries set sort_order = case code when 'GB' then 1 when 'NG' then 2 when 'US' then 3 when 'GH' then 4 else sort_order end
 where code in ('GB', 'NG', 'US', 'GH') and sort_order = 100;

create table if not exists public.specialities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 40),
  sort_order  integer not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists specialities_name_key on public.specialities (lower(name));

insert into public.specialities (name, sort_order) values
  ('Agbada', 1), ('Kaftan', 2), ('Senator', 3), ('Suits', 4), ('Wedding outfits', 5),
  ('Women''s dresses', 6), ('Aso Ebi', 7), ('Alterations', 8), ('Ready to wear', 9), ('Custom design', 10)
on conflict (lower(name)) do nothing;


-- ---------------------------------------------------------------------
-- 2. Tailor profile fields on the existing designers table
-- ---------------------------------------------------------------------

alter table public.designers add column if not exists slug               text;
alter table public.designers add column if not exists admin_status       text not null default 'pending';
alter table public.designers add column if not exists admin_note         text not null default '';   -- why the admin hid it
alter table public.designers add column if not exists approved_at        timestamptz;
alter table public.designers add column if not exists country_code       text;
alter table public.designers add column if not exists city               text;
alter table public.designers add column if not exists postcode           text;       -- private
alter table public.designers add column if not exists address_line       text;       -- private
alter table public.designers add column if not exists show_exact_address boolean not null default false;
alter table public.designers add column if not exists latitude           double precision;   -- private: the exact spot
alter table public.designers add column if not exists longitude          double precision;   -- private
alter table public.designers add column if not exists public_latitude    double precision;   -- what the public sees (rounded unless shown)
alter table public.designers add column if not exists public_longitude   double precision;
alter table public.designers add column if not exists postcode_area      text;       -- public: "SE15", or the full postcode if shown
alter table public.designers add column if not exists public_address     text;       -- public: only when "show exact address" is on
alter table public.designers add column if not exists delivery_available boolean not null default false;
alter table public.designers add column if not exists custom_orders      boolean not null default true;
alter table public.designers add column if not exists review_count       integer not null default 0;
alter table public.designers add column if not exists phone              text;       -- private: for the admin
alter table public.designers add column if not exists updated_at         timestamptz not null default now();

-- Designers that were already approved stay approved; the rest wait for the admin
update public.designers set admin_status = 'approved', approved_at = coalesce(approved_at, created_at, now())
 where approved and admin_status = 'pending' and approved_at is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'designers_admin_status_check_wv') then
    alter table public.designers add constraint designers_admin_status_check_wv check (admin_status in ('pending', 'approved', 'hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'designers_position_check_wv') then
    alter table public.designers add constraint designers_position_check_wv
      check (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'designers_country_fkey_wv') then
    alter table public.designers add constraint designers_country_fkey_wv foreign key (country_code) references public.countries (code) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'designers_slug_check_wv') then
    alter table public.designers add constraint designers_slug_check_wv check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;
  end if;
end $$;

create unique index if not exists designers_slug_key_wv on public.designers (slug);
-- The search looks up approved tailors by position first, so it stays fast with thousands of them
create index if not exists designers_position_idx_wv on public.designers (public_latitude, public_longitude) where admin_status = 'approved';
create index if not exists designers_place_idx_wv on public.designers (country_code, lower(city)) where admin_status = 'approved';
create index if not exists designers_specialities_idx_wv on public.designers using gin (speciality_tags);

-- Walk-in customers a tailor's team adds belong to that tailor
alter table public.customers add column if not exists added_by_designer_id uuid references public.designers (id) on delete set null;
create index if not exists customers_added_by_idx_wv on public.customers (added_by_designer_id);

-- Each tailor's own notes about a customer (other tailors never see them)
create table if not exists public.designer_customer_notes (
  designer_id uuid not null references public.designers (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  notes       text not null default '' check (char_length(notes) <= 2000),
  updated_at  timestamptz not null default now(),
  primary key (designer_id, customer_id)
);


-- ---------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------

-- "Nebeda Threads!" → "nebeda-threads"
create or replace function public.wv_slugify(p_text text) returns text
language sql immutable set search_path = public as $$
  select nullif(trim(both '-' from regexp_replace(lower(translate(coalesce(p_text, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYyy')), '[^a-z0-9]+', '-', 'g')), '')
$$;

-- True for the admin and the owner of this tailor (not their staff)
create or replace function public.wv_owns_designer(p_designer_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.designers d where d.id = p_designer_id and d.owner_user_id = auth.uid())
$$;

-- Orders the signed-in person's tailor team(s) look after
create or replace function public.wv_team_order_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select o.id from public.orders o where public.can_manage_designer(o.designer_id)
$$;

-- Customers the signed-in person's tailor team(s) look after: anyone who
-- ordered from them, or a walk-in customer they added
create or replace function public.wv_team_customer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select o.customer_id from public.orders o where o.customer_id is not null and public.can_manage_designer(o.designer_id)
  union
  select c.id from public.customers c where c.added_by_designer_id is not null and public.can_manage_designer(c.added_by_designer_id)
$$;

-- Tailors of the signed-in customer's own orders (so old orders still show their tailor)
create or replace function public.wv_my_order_designer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select o.designer_id from public.orders o
  join public.customers c on c.id = o.customer_id
  where c.auth_user_id = auth.uid() and o.designer_id is not null
$$;

-- The tailor's business name, for messages
create or replace function public.wv_designer_name(p_designer_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select d.business_name from public.designers d where d.id = p_designer_id), 'your tailor')
$$;

-- The price list new tailors start with (the same starting prices Wearvia began with)
create or replace function public.wv_seed_price_list(p_designer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.price_list (designer_id, kind, name, price, yards, sort_order)
  select p_designer_id, v.kind, v.name, v.price, v.yards, v.sort_order
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

-- can_manage_designer is what every security rule for a tailor's data
-- uses. Make sure it is the owner-or-staff-or-admin version (it is rebuilt
-- with the parameter name the database already has, so the rules keep working).
do $$
declare
  v_arg text := coalesce((select proargnames[1] from pg_proc where oid = to_regprocedure('public.can_manage_designer(uuid)')), 'p_designer_id');
begin
  execute format($f$
    create or replace function public.can_manage_designer(%I uuid) returns boolean
    language sql stable security definer set search_path = public as $b$
      select public.is_admin()
        or exists (select 1 from public.designers d where d.id = $1 and d.owner_user_id = auth.uid())
        or exists (select 1 from public.designer_staff s where s.designer_id = $1 and s.user_id = auth.uid())
    $b$ $f$, v_arg);
end $$;


-- ---------------------------------------------------------------------
-- 4. Each tailor has their own price list
-- ---------------------------------------------------------------------

alter table public.price_list add column if not exists designer_id uuid references public.designers (id) on delete cascade;
-- The prices already there are Nebeda Threads' (designer number one) — unchanged
update public.price_list set designer_id = public.wv_main_designer_id() where designer_id is null;
alter table public.price_list drop constraint if exists price_list_kind_name_key;
create unique index if not exists price_list_designer_kind_name_key_wv on public.price_list (designer_id, kind, name);
create index if not exists price_list_designer_idx_wv on public.price_list (designer_id);
do $$
begin
  if not exists (select 1 from public.price_list where designer_id is null) then
    alter table public.price_list alter column designer_id set not null;
  end if;
end $$;

-- Every tailor has a price list
select public.wv_seed_price_list(d.id) from public.designers d
where not exists (select 1 from public.price_list p where p.designer_id = d.id);

-- Records who changed a price and when; the tailor, outfit and kind never change
create or replace function public.wv_price_list_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.designer_id := old.designer_id;
  new.kind := old.kind;
  new.name := old.name;
  if new.kind <> 'outfit' then new.yards := null; end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 5. Keeping tailor profiles honest
-- ---------------------------------------------------------------------

-- A web address no other tailor uses: nebeda-threads, nebeda-threads-2, …
-- (looks at every tailor, including ones the person saving can't see)
create or replace function public.wv_unique_designer_slug(p_wanted text, p_designer_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_base text := left(coalesce(public.wv_slugify(p_wanted), 'tailor'), 60);
  v_slug text := v_base;
  v_n    integer := 1;
begin
  while exists (select 1 from public.designers d where d.slug = v_slug and d.id is distinct from p_designer_id) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end $$;

-- Before a tailor is saved: only the admin can approve, hide or rate a
-- tailor or change who owns it; the web address is made unique; and the
-- public position, postcode district and address are worked out from the
-- private ones and the "show exact address" switch.
-- (It runs as the person saving — not as the database owner — so it can
-- tell a change made from the app apart from one made by Wearvia itself.)
create or replace function public.wv_designers_before_write() returns trigger
language plpgsql set search_path = public as $$
declare
  v_admin  boolean := public.is_admin();
  v_app    boolean := current_user in ('authenticated', 'anon');
  v_pc     text;
begin
  if v_app and not v_admin then
    if tg_op = 'INSERT' then
      new.admin_status := 'pending';
      new.approved := false;
      new.rating := null;
      new.review_count := 0;
      new.commission_rate := 0;
      new.admin_note := '';
      new.approved_at := null;
    else
      new.admin_status := old.admin_status;
      new.approved := old.approved;
      new.approved_at := old.approved_at;
      new.admin_note := old.admin_note;
      new.owner_user_id := old.owner_user_id;
      new.commission_rate := old.commission_rate;
      new.rating := old.rating;
      new.review_count := old.review_count;
    end if;
  end if;

  -- approved (the old yes/no) and admin_status always agree
  if tg_op = 'INSERT' then
    if new.approved and new.admin_status = 'pending' then new.admin_status := 'approved'; end if;
  elsif new.admin_status is distinct from old.admin_status then
    null;
  elsif new.approved is distinct from old.approved then
    new.admin_status := case when new.approved then 'approved' else 'hidden' end;
  end if;
  new.approved := new.admin_status = 'approved';
  if new.admin_status = 'approved' and (tg_op = 'INSERT' or old.admin_status <> 'approved') then
    new.approved_at := now();
    new.admin_note := '';
  end if;

  -- Tidy the text
  new.business_name := nullif(trim(coalesce(new.business_name, '')), '');
  if new.business_name is null then
    raise exception 'Enter your business name.';
  end if;
  new.country_code := nullif(upper(trim(coalesce(new.country_code, ''))), '');
  new.city := nullif(trim(coalesce(new.city, '')), '');
  new.postcode := nullif(upper(regexp_replace(trim(coalesce(new.postcode, '')), '\s+', ' ', 'g')), '');
  new.address_line := nullif(trim(coalesce(new.address_line, '')), '');
  new.speciality_tags := coalesce(new.speciality_tags, '{}');
  if new.latitude is null or new.longitude is null then
    new.latitude := null;
    new.longitude := null;
  end if;

  -- A unique web address: nebeda-threads, nebeda-threads-2, …
  new.slug := public.wv_unique_designer_slug(coalesce(nullif(new.slug, ''), new.business_name), new.id);

  -- What the public sees
  if new.latitude is null then
    new.public_latitude := null;
    new.public_longitude := null;
  elsif new.show_exact_address then
    new.public_latitude := new.latitude;
    new.public_longitude := new.longitude;
  else
    new.public_latitude := round(new.latitude::numeric, 2)::double precision;    -- about 1 km
    new.public_longitude := round(new.longitude::numeric, 2)::double precision;
  end if;
  v_pc := new.postcode;
  new.postcode_area := case
    when v_pc is null then null
    when new.show_exact_address then v_pc
    when new.country_code = 'GB' then nullif(trim(regexp_replace(v_pc, '\s*[0-9][A-Z]{2}$', '')), '')
    else null end;
  new.public_address := case
    when new.show_exact_address and new.address_line is not null then new.address_line || coalesce(', ' || v_pc, '')
    else null end;
  if coalesce(trim(new.location), '') = '' and new.city is not null then
    new.location := new.city || coalesce(', ' || (select c.name from public.countries c where c.code = new.country_code), '');
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists wv_designers_before_write on public.designers;
create trigger wv_designers_before_write before insert or update on public.designers
  for each row execute function public.wv_designers_before_write();

-- A tailor's rating and review count come from customers' reviews
create or replace function public.wv_refresh_designer_rating(p_designer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_avg   numeric;
begin
  select count(*), round(avg(r.rating)::numeric, 1) into v_count, v_avg
  from public.reviews r where r.designer_id = p_designer_id and r.rating between 1 and 5;
  update public.designers
     set review_count = v_count,
         rating = case when v_count > 0 then v_avg else rating end
   where id = p_designer_id
     and (review_count is distinct from v_count or (v_count > 0 and rating is distinct from v_avg));
end $$;

create or replace function public.wv_reviews_refresh_rating() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.wv_refresh_designer_rating(new.designer_id); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.designer_id is distinct from new.designer_id) then
    perform public.wv_refresh_designer_rating(old.designer_id);
  end if;
  return null;
end $$;

drop trigger if exists wv_reviews_refresh_rating on public.reviews;
create trigger wv_reviews_refresh_rating after insert or update or delete on public.reviews
  for each row execute function public.wv_reviews_refresh_rating();

select public.wv_refresh_designer_rating(d.id) from public.designers d;


-- ---------------------------------------------------------------------
-- 6. Nebeda Threads: designer number one, now with a profile
--    (only filled in the first time, so your later edits are kept)
-- ---------------------------------------------------------------------

update public.designers d
   set slug = 'nebeda-threads',
       country_code = coalesce(d.country_code, 'GB'),
       city = coalesce(d.city, 'Gillingham'),
       latitude = coalesce(d.latitude, 51.3887),          -- Gillingham town centre, not an address
       longitude = coalesce(d.longitude, 0.5485),
       delivery_available = true,
       custom_orders = true,
       speciality_tags = (select array_agg(distinct t order by t) from unnest(
         array_replace(array_replace(coalesce(d.speciality_tags, '{}'), 'Wedding', 'Wedding outfits'), 'Bespoke', 'Custom design')) t)
 where d.id = public.wv_main_designer_id() and d.slug is null;

-- Any other designer without a web address gets one
update public.designers set slug = null where slug is null;   -- the trigger fills it in

-- The notes Nebeda Threads wrote about customers become its own notes
insert into public.designer_customer_notes (designer_id, customer_id, notes)
select public.wv_main_designer_id(), c.id, c.notes from public.customers c
where coalesce(trim(c.notes), '') <> '' and public.wv_main_designer_id() is not null
on conflict (designer_id, customer_id) do nothing;


-- ---------------------------------------------------------------------
-- 7. Orders, quotes and chats work for every tailor
--    (these replace the versions in tailor-quote.sql; they behave the same
--    for Nebeda Threads)
-- ---------------------------------------------------------------------

-- ---- New orders ----
-- As before, but for the tailor the customer chose: their price list, and
-- only an approved tailor who takes custom orders can receive a request.
-- Orders sent without a tailor go to Nebeda Threads, as before.
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

  if new.fabric_id is not null then
    select * into v_fabric from public.fabrics where id = new.fabric_id;
    if not found then
      raise exception 'That fabric is no longer available.';
    end if;
    new.fabric_supplier_id := v_fabric.supplier_id;
  end if;

  select p.price into v_tailoring from public.price_list p where p.designer_id = new.designer_id and p.kind = 'outfit' and p.name = new.outfit_type;
  select p.price into v_emb_cost from public.price_list p where p.designer_id = new.designer_id and p.kind = 'embroidery' and p.name = v_embroidery;
  select p.price into v_delivery from public.price_list p where p.designer_id = new.designer_id and p.kind = 'delivery' order by p.sort_order, p.name limit 1;

  new.deposit_paid_at := null;
  new.balance_paid_at := null;
  new.quoted_at := null;
  new.quoted_by := null;
  new.fabric_problem := null;

  if not v_team then
    -- ---- A customer sends their order to the tailor ----
    if v_designer.admin_status <> 'approved' then
      raise exception '% isn''t taking orders on Wearvia right now. Please choose another tailor.', v_designer.business_name;
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
    if v_tailoring is null then
      raise exception 'Sorry, % doesn''t make "%" at the moment. Please choose another outfit.', v_designer.business_name, coalesce(new.outfit_type, '');
    end if;
    if v_emb_cost is null then
      raise exception 'Sorry, "%" embroidery isn''t available. Please choose another.', v_embroidery;
    end if;
    if v_delivery is null then
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
    new.fabric_cost := round(coalesce(new.fabric_yards, 0) * v_fabric.price_per_yard, 2);
  end if;
  new.tailoring_cost := coalesce(new.tailoring_cost, v_tailoring, 0);
  new.embroidery_cost := coalesce(new.embroidery_cost, v_emb_cost, 0);
  new.delivery_cost := coalesce(new.delivery_cost, v_delivery, 0);
  new.quote_total := coalesce(new.fabric_cost, 0) + new.tailoring_cost + new.embroidery_cost + new.delivery_cost;
  new.deposit_amount := least(coalesce(new.deposit_amount, round(new.quote_total * 0.6)), new.quote_total);
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

-- The name on a chat message: "Ben at Nebeda Threads" (the order's tailor), or the customer's name
create or replace function public.wv_chat_name_for(p_team boolean, p_order_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p_team then
      coalesce(nullif(split_part(trim((select p.full_name from public.profiles p where p.id = auth.uid())), ' ', 1), '') || ' at ', '')
      || public.wv_designer_name((select o.designer_id from public.orders o where o.id = p_order_id))
    else
      coalesce((select c.name from public.customers c where c.auth_user_id = auth.uid() order by c.created_at limit 1), 'Customer')
    end
$$;

-- Kept for anything still calling it: the tailor the signed-in person works for
create or replace function public.wv_chat_name(p_team boolean) returns text
language sql stable security definer set search_path = public as $$
  select case when p_team then
      coalesce(nullif(split_part(trim((select p.full_name from public.profiles p where p.id = auth.uid())), ' ', 1), '') || ' at ', '')
      || coalesce((select d.business_name from public.designers d
                   where d.owner_user_id = auth.uid()
                      or d.id in (select s.designer_id from public.designer_staff s where s.user_id = auth.uid())
                   order by d.id = public.wv_main_designer_id() desc, d.created_at limit 1), 'Wearvia')
    else
      coalesce((select c.name from public.customers c where c.auth_user_id = auth.uid() order by c.created_at limit 1), 'Customer')
    end
$$;

-- Chat messages: the database fills in who sent them. Someone is "team" only
-- on the orders of a tailor they work for.
create or replace function public.wv_order_messages_before_insert() returns trigger
language plpgsql set search_path = public as $$
declare
  v_team boolean;
  v_uid  uuid := auth.uid();
  v_path text;
begin
  new.created_at := now();
  new.body := trim(coalesce(new.body, ''));
  new.photos := coalesce(new.photos, '{}');
  if current_user in ('authenticated', 'anon') then
    v_team := new.order_id in (select public.wv_team_order_ids());
    new.sender_id := v_uid;
    new.sender_kind := case when v_team then 'team' else 'customer' end;
    new.sender_name := public.wv_chat_name_for(v_team, new.order_id);
    foreach v_path in array new.photos loop
      if v_path is null or split_part(v_path, '/', 1) <> v_uid::text or v_path like '%..%' then
        raise exception 'That photo can''t be attached.';
      end if;
    end loop;
  end if;
  if new.body = '' and cardinality(new.photos) = 0 then
    raise exception 'Type a message or add a photo.';
  end if;
  return new;
end $$;

-- Payments: only the order's own tailor team can record or confirm them
create or replace function public.wv_payments_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team boolean := exists (select 1 from public.orders o where o.id = new.order_id and public.can_manage_designer(o.designer_id));
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.orders o where o.id = new.order_id and o.quote_status <> 'accepted') then
      raise exception 'Please accept the quote before paying.';
    end if;
    new.created_by := auth.uid();
    if not v_team then
      new.status := 'awaiting_confirmation';
      new.paid_on := current_date;
    end if;
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
  elsif new.status <> 'confirmed' then
    new.confirmed_by := null;
    new.confirmed_at := null;
  end if;
  return new;
end $$;

-- Ready-to-wear: the tailor's own team can set a sale's price and status
create or replace function public.wv_rtw_sales_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item public.ready_to_wear_items%rowtype;
begin
  update public.ready_to_wear_items set stock = stock - 1, updated_at = now()
  where id = new.item_id and stock > 0 and active
  returning * into v_item;
  if not found then
    raise exception 'Sorry, that item has just sold out.';
  end if;
  if not public.can_manage_designer(v_item.designer_id) then
    new.price := v_item.price;
    new.status := 'awaiting_confirmation';
    new.sold_on := current_date;
  end if;
  new.cost := v_item.cost;
  return new;
end $$;

-- Fabric sellers can only mark their order lines as sent; the admin and the
-- order's tailor team can change them
create or replace function public.wv_fabric_lines_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text := new.status;
begin
  if not (public.is_admin() or old.order_id in (select public.wv_team_order_ids())) then
    new := old;
    if old.status = 'new' and v_status = 'sent' then
      new.status := 'sent';
    end if;
  end if;
  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.sent_at := now();
  end if;
  return new;
end $$;

-- The fabric marketplace is run by the admin: only they approve, hide or restock sellers' fabrics
create or replace function public.wv_fabrics_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team boolean := public.is_admin();
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    if not v_team then
      new.status := 'pending';
      new.review_note := '';
      new.reviewed_at := null;
    end if;
  else
    v_changed := new.name is distinct from old.name or new.category is distinct from old.category
      or new.colour_name is distinct from old.colour_name or new.description is distinct from old.description
      or new.photos is distinct from old.photos;
    if not v_team then
      new.status := old.status;
      new.review_note := old.review_note;
      new.reviewed_at := old.reviewed_at;
      new.supplier_id := old.supplier_id;
      if v_changed and old.status in ('approved', 'hidden') and new.deleted_at is null then
        new.status := 'pending';
        new.review_note := '';
      end if;
    elsif new.status is distinct from old.status then
      new.reviewed_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.wv_suppliers_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.owner_user_id := auth.uid();
      new.rating := null;
    else
      new.owner_user_id := old.owner_user_id;
      new.rating := old.rating;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Customers can't attach their record to someone else's login; a tailor
-- team can only file a walk-in customer under a tailor they work for
create or replace function public.wv_customers_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.added_by_designer_id is not null and not public.can_manage_designer(new.added_by_designer_id) then
      new.added_by_designer_id := null;
    end if;
    if new.added_by_designer_id is null and not public.is_admin() then
      new.auth_user_id := auth.uid();
      new.notes := '';
    end if;
  else
    new.added_by_designer_id := old.added_by_designer_id;
    if not public.is_admin() then
      new.auth_user_id := coalesce(old.auth_user_id, new.auth_user_id);
      new.notes := old.notes;
    end if;
  end if;
  return new;
end $$;

-- A fabric that sells out: the message names the order's tailor
create or replace function public.wv_fabrics_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_text text;
begin
  for r in
    select o.id, o.quote_status, o.fabric_yards, o.designer_id from public.orders o
    where o.fabric_id = new.id and o.quote_status in ('requested', 'quoted') and o.fabric_problem is null
  loop
    if public.wv_fabric_can_sell(old, r.fabric_yards) and not public.wv_fabric_can_sell(new, r.fabric_yards) then
      v_text := case
        when new.deleted_at is not null or new.status <> 'approved' then new.name || ' is no longer on sale'
        when new.sold_out or coalesce(new.yards_available, 0) < greatest(coalesce(new.min_order_yards, 0), 0.01) then new.name || ' has sold out'
        else 'Only ' || trim_scale(new.yards_available) || ' yd of ' || new.name || ' is left' end;
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

-- ---- The team sends a quote: priced from THEIR price list ----
create or replace function public.wearvia_send_quote(
  p_order_id uuid, p_yards numeric, p_fabric_id uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o            public.orders%rowtype;
  v_fabric     public.fabrics%rowtype;
  v_yards      numeric := round(coalesce(p_yards, 0), 2);
  v_tailoring  numeric;
  v_emb_cost   numeric;
  v_delivery   numeric;
  v_cost       numeric;
  v_total      numeric;
  v_deposit    numeric;
  v_lines      jsonb;
  v_note       text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not public.can_manage_designer(o.designer_id) then
    raise exception 'Only the tailor''s team can send a quote for that order.';
  end if;
  if o.quote_status = 'accepted' then
    raise exception 'The customer has already accepted the quote for %. It can''t be changed now.', o.order_number;
  end if;

  select * into v_fabric from public.fabrics where id = coalesce(p_fabric_id, o.fabric_id);
  if not found then
    raise exception 'Choose a fabric for the quote.';
  end if;
  if v_yards <= 0 or v_yards > 100 or v_yards * 4 <> round(v_yards * 4) then
    raise exception 'Enter the yards needed, in quarter yards (for example 4.5 or 5.25).';
  end if;
  if v_fabric.deleted_at is not null or v_fabric.status <> 'approved' or coalesce(v_fabric.sold_out, false) then
    raise exception '% isn''t on sale any more. Choose another fabric.', v_fabric.name;
  end if;
  if v_yards < coalesce(v_fabric.min_order_yards, 0) then
    raise exception 'The smallest order for % is % yd.', v_fabric.name, trim_scale(v_fabric.min_order_yards);
  end if;
  if v_yards > coalesce(v_fabric.yards_available, 0) then
    raise exception 'Only % yd of % is left in stock.', trim_scale(v_fabric.yards_available), v_fabric.name;
  end if;

  select p.price into v_tailoring from public.price_list p where p.designer_id = o.designer_id and p.kind = 'outfit' and p.name = o.outfit_type;
  select p.price into v_emb_cost from public.price_list p where p.designer_id = o.designer_id and p.kind = 'embroidery' and p.name = coalesce(nullif(o.embroidery, ''), 'None');
  select p.price into v_delivery from public.price_list p where p.designer_id = o.designer_id and p.kind = 'delivery' order by p.sort_order, p.name limit 1;
  if v_tailoring is null or v_emb_cost is null or v_delivery is null then
    raise exception 'Your price list has no price for % / % embroidery / delivery. Add it in Business → Prices.', o.outfit_type, o.embroidery;
  end if;

  v_cost := round(v_yards * v_fabric.price_per_yard, 2);
  v_total := v_cost + v_tailoring + v_emb_cost + v_delivery;
  v_deposit := round(v_total * 0.6);
  v_lines := public.wv_quote_lines(v_fabric.name, v_yards, v_fabric.price_per_yard, v_cost,
                                   o.outfit_type, v_tailoring, coalesce(nullif(o.embroidery, ''), 'None'), v_emb_cost, v_delivery);

  update public.orders
     set fabric_id = v_fabric.id, fabric_supplier_id = v_fabric.supplier_id, fabric_yards = v_yards,
         fabric_cost = v_cost, tailoring_cost = v_tailoring, embroidery_cost = v_emb_cost, delivery_cost = v_delivery,
         quote_total = v_total, deposit_amount = v_deposit, line_items = v_lines,
         quote_status = 'quoted', quoted_at = now(), quoted_by = auth.uid(), fabric_problem = null
   where id = o.id;

  if v_note is not null then
    insert into public.order_messages (order_id, sender_kind, sender_id, sender_name, body)
    values (o.id, 'team', auth.uid(), public.wv_chat_name_for(true, o.id), left(v_note, 2000));
  end if;
  perform public.wv_post_system_message(o.id,
    'Your quote is ready: ' || v_fabric.name || ', ' || trim_scale(v_yards) || ' yd × ' || public.wv_money_text(v_fabric.price_per_yard)
    || ' = ' || public.wv_money_text(v_cost) || ' · tailoring ' || public.wv_money_text(v_tailoring)
    || ' · embroidery ' || public.wv_money_text(v_emb_cost) || ' · delivery ' || public.wv_money_text(v_delivery)
    || '. Total ' || public.wv_money_text(v_total) || ', deposit ' || public.wv_money_text(v_deposit) || ' (60%). '
    || 'Tap "Accept quote" to go ahead, or ask us a question here.');

  return jsonb_build_object('order_number', o.order_number, 'fabric', v_fabric.name, 'yards', v_yards,
                            'total', v_total, 'deposit', v_deposit, 'line_items', v_lines);
end $$;

-- ---- The customer accepts: messages name the order's tailor ----
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
      else 'Only ' || trim_scale(v_fabric.yards_available) || ' yd of ' || v_fabric.name || ' is left' end;
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
    'Quote accepted. ' || trim_scale(o.fabric_yards) || ' yd of ' || v_fabric.name || ' is bought for your outfit. '
    || 'Next: pay your deposit of ' || public.wv_money_text(o.deposit_amount) || ' and we''ll start making it.');
  return jsonb_build_object('ok', true, 'deposit', o.deposit_amount);
end $$;


-- ---------------------------------------------------------------------
-- 8. Signing up, joining as a tailor, team logins, approving tailors
-- ---------------------------------------------------------------------

-- Anyone signed in can open ONE tailor business. It waits for the admin.
create or replace function public.wearvia_register_designer(
  p_business_name text, p_country_code text default null, p_city text default null, p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_name text := nullif(trim(coalesce(p_business_name, '')), '');
begin
  if v_uid is null then
    raise exception 'Please sign in first.';
  end if;
  select d.id into v_id from public.designers d where d.owner_user_id = v_uid order by d.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Enter your business name (2 to 80 characters).';
  end if;
  if p_country_code is not null and not exists (select 1 from public.countries c where c.code = upper(p_country_code)) then
    raise exception 'Choose your country from the list.';
  end if;
  insert into public.designers (business_name, owner_user_id, country_code, city, phone, rating, commission_rate,
                                approved, admin_status, custom_orders, speciality_tags, delivery_estimate)
  values (v_name, v_uid, upper(nullif(trim(coalesce(p_country_code, '')), '')), nullif(trim(coalesce(p_city, '')), ''),
          nullif(trim(coalesce(p_phone, '')), ''), null, 0, false, 'pending', true, '{}', '7–14 days')
  returning id into v_id;
  perform public.wv_seed_price_list(v_id);
  -- Their profile says "designer owner" (an existing role is never lowered; if
  -- the role lock refuses, that's fine — ownership is what counts)
  begin
    update public.profiles set role = 'designer_owner'::public.user_role where id = v_uid and role::text = 'customer';
  exception when others then
    null;
  end;
  return v_id;
end $$;

-- Called by the app every time someone signs in. As before, plus: tailors
-- who signed up with "Join as a tailor" get their business made, and it
-- says which tailor(s) the person works for.
create or replace function public.wearvia_bootstrap() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_user      auth.users%rowtype;
  v_meta      jsonb;
  v_type      text;
  v_name      text;
  v_phone     text;
  v_confirmed boolean;
  v_customer  uuid;
  v_supplier  uuid;
  v_designer  uuid;
  v_role      text;
  v_invite    record;
  v_designers jsonb;
begin
  if v_uid is null then
    raise exception 'Please sign in first.';
  end if;
  select * into v_user from auth.users where id = v_uid;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
  v_type := case v_meta->>'account_type' when 'seller' then 'seller' when 'designer' then 'designer' else 'customer' end;
  v_name := nullif(trim(coalesce(v_meta->>'full_name', '')), '');
  v_phone := nullif(trim(coalesce(v_meta->>'phone', '')), '');
  v_confirmed := v_user.email_confirmed_at is not null;

  insert into public.profiles (id, email, full_name, role)
  values (v_uid, v_user.email, coalesce(v_name, split_part(v_user.email, '@', 1)),
          (case v_type when 'seller' then 'supplier' when 'designer' then 'designer_owner' else 'customer' end)::public.user_role)
  on conflict (id) do nothing;
  update public.profiles set full_name = coalesce(full_name, v_name), email = coalesce(email, v_user.email)
  where id = v_uid and (full_name is null or email is null);
  if v_type = 'seller' then
    begin
      update public.profiles set role = 'supplier'::public.user_role where id = v_uid and role::text = 'customer';
    exception when others then
      null;
    end;
  end if;

  -- "Join as a tailor": their business, waiting for the admin
  if v_type = 'designer' and nullif(trim(coalesce(v_meta->>'business_name', '')), '') is not null
     and not exists (select 1 from public.designers d where d.owner_user_id = v_uid) then
    perform public.wearvia_register_designer(v_meta->>'business_name',
      (select c.code from public.countries c where c.code = upper(coalesce(v_meta->>'country_code', ''))),
      v_meta->>'city', v_phone);
  end if;

  if v_confirmed then
    for v_invite in
      select * from public.designer_staff_invites i where lower(i.email) = lower(v_user.email)
    loop
      insert into public.designer_staff (designer_id, user_id, job_role)
      select v_invite.designer_id, v_uid, v_invite.job_role
      where not exists (select 1 from public.designer_staff s
                        where s.designer_id = v_invite.designer_id and s.user_id = v_uid);
      delete from public.designer_staff_invites where id = v_invite.id;
    end loop;
  end if;

  select id into v_customer from public.customers where auth_user_id = v_uid order by created_at limit 1;
  if v_customer is null and v_confirmed then
    update public.customers set auth_user_id = v_uid
    where id = (select c.id from public.customers c
                where c.auth_user_id is null and lower(c.email) = lower(v_user.email)
                order by c.created_at limit 1)
    returning id into v_customer;
  end if;
  if v_customer is null and not public.wv_is_team() then
    insert into public.customers (auth_user_id, name, email, phone, created_at)
    values (v_uid, coalesce(v_name, split_part(v_user.email, '@', 1)), v_user.email, v_phone, now())
    returning id into v_customer;
  end if;

  select id into v_supplier from public.suppliers where owner_user_id = v_uid order by created_at limit 1;
  select role::text into v_role from public.profiles where id = v_uid;

  -- The tailor(s) this person works for: the ones they own first (Nebeda Threads first of all)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'business_name', x.business_name, 'slug', x.slug,
                                               'admin_status', x.admin_status, 'is_owner', x.is_owner)
                            order by x.is_owner desc, x.is_main desc, x.created_at), '[]'::jsonb)
    into v_designers
  from (select d.id, d.business_name, d.slug, d.admin_status, d.created_at,
               d.owner_user_id = v_uid as is_owner, d.id = public.wv_main_designer_id() as is_main
        from public.designers d
        where d.owner_user_id = v_uid
           or d.id in (select s.designer_id from public.designer_staff s where s.user_id = v_uid)) x;
  v_designer := (v_designers->0->>'id')::uuid;

  return jsonb_build_object(
    'user_id', v_uid,
    'email', v_user.email,
    'name', coalesce((select full_name from public.profiles where id = v_uid), v_name, v_user.email),
    'account_type', v_type,
    'role', v_role,
    'is_admin', public.is_admin(),
    'is_owner', coalesce((v_designers->0->>'is_owner')::boolean, false) or public.is_admin(),
    'is_team', v_designer is not null or public.is_admin(),
    'job_role', (select s.job_role from public.designer_staff s where s.user_id = v_uid and s.designer_id = v_designer limit 1),
    'designer_id', coalesce(v_designer, case when public.is_admin() then public.wv_main_designer_id() end),
    'designers', v_designers,
    'main_designer_id', public.wv_main_designer_id(),
    'customer_id', v_customer,
    'supplier_id', v_supplier
  );
end $$;

-- The owner adds a team login by email — for THEIR tailor business
drop function if exists public.wearvia_add_team_member(text, text);
create or replace function public.wearvia_add_team_member(p_email text, p_job_role text default 'staff', p_designer_id uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_designer uuid := coalesce(p_designer_id,
                              (select d.id from public.designers d where d.owner_user_id = auth.uid() order by d.created_at limit 1),
                              case when public.is_admin() then public.wv_main_designer_id() end);
  v_email    text := lower(trim(p_email));
  v_user     uuid;
begin
  if v_designer is null or not public.wv_owns_designer(v_designer) then
    raise exception 'Only the owner can add team members.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right.';
  end if;
  select id into v_user from auth.users where lower(email) = v_email and email_confirmed_at is not null limit 1;
  if v_user is not null then
    insert into public.designer_staff (designer_id, user_id, job_role)
    select v_designer, v_user, coalesce(nullif(trim(p_job_role), ''), 'staff')
    where not exists (select 1 from public.designer_staff s where s.designer_id = v_designer and s.user_id = v_user);
    return 'added';
  end if;
  insert into public.designer_staff_invites (designer_id, email, job_role)
  values (v_designer, v_email, coalesce(nullif(trim(p_job_role), ''), 'staff'))
  on conflict (designer_id, lower(email)) do update set job_role = excluded.job_role;
  return 'invited';
end $$;

-- The team's logins, for the Tailor Team page — for one tailor business
drop function if exists public.wearvia_team_logins();
create or replace function public.wearvia_team_logins(p_designer_id uuid default null)
returns table (kind text, id uuid, email text, name text, job_role text)
language sql stable security definer set search_path = public as $$
  with target as (
    select coalesce(p_designer_id,
                    (select d.id from public.designers d where d.owner_user_id = auth.uid() order by d.created_at limit 1),
                    (select s.designer_id from public.designer_staff s where s.user_id = auth.uid() limit 1),
                    case when public.is_admin() then public.wv_main_designer_id() end) as designer_id
  )
  select 'owner', d.owner_user_id, p.email, p.full_name, 'owner'
  from target t join public.designers d on d.id = t.designer_id
  left join public.profiles p on p.id = d.owner_user_id
  where public.can_manage_designer(t.designer_id) and d.owner_user_id is not null
  union all
  select 'staff', s.id, p.email, p.full_name, s.job_role
  from target t join public.designer_staff s on s.designer_id = t.designer_id
  left join public.profiles p on p.id = s.user_id
  where public.can_manage_designer(t.designer_id)
  union all
  select 'invite', i.id, i.email, null, i.job_role
  from target t join public.designer_staff_invites i on i.designer_id = t.designer_id
  where public.can_manage_designer(t.designer_id)
$$;

-- Full profiles (with the private address and position) of the tailors the
-- signed-in person owns or works for — for the admin, every tailor
create or replace function public.wearvia_my_designers() returns setof public.designers
language sql stable security definer set search_path = public as $$
  select d.* from public.designers d where public.can_manage_designer(d.id)
  order by d.id = public.wv_main_designer_id() desc, d.created_at
$$;

-- The admin approves, hides or puts back a tailor
create or replace function public.wearvia_set_designer_status(p_designer_id uuid, p_status text, p_note text default '')
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the Wearvia admin can approve or hide tailors.';
  end if;
  if p_status not in ('approved', 'hidden', 'pending') then
    raise exception 'Unknown status %.', p_status;
  end if;
  update public.designers
     set admin_status = p_status,
         admin_note = case when p_status = 'hidden' then left(coalesce(trim(p_note), ''), 500) else '' end
   where id = p_designer_id;
  if not found then
    raise exception 'That tailor wasn''t found.';
  end if;
  return p_status;
end $$;


-- ---------------------------------------------------------------------
-- 9. Finding tailors
-- ---------------------------------------------------------------------

-- Approved tailors, nearest first (or best rated), with filters and paging.
-- Distance uses the PUBLIC position, so a tailor who hides their address is
-- never located more closely than about 1 km. Runs as the person asking, so
-- it can only ever see public columns of approved tailors.
create or replace function public.wearvia_search_tailors(
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km double precision default null,
  p_country text default null,
  p_city text default null,
  p_area text default null,
  p_specialities text[] default null,
  p_delivery boolean default null,
  p_custom boolean default null,
  p_min_rating numeric default null,
  p_sort text default 'distance',
  p_limit integer default 20,
  p_offset integer default 0)
returns table (
  id uuid, slug text, business_name text, profile_image_url text, description text,
  country_code text, city text, postcode_area text, public_address text, location text,
  speciality_tags text[], delivery_available boolean, custom_orders boolean,
  rating numeric, review_count integer, starting_price numeric, delivery_estimate text,
  latitude double precision, longitude double precision, distance_km double precision, total_count bigint)
language sql stable set search_path = public as $$
  with params as (
    select p_lat as lat, p_lng as lng,
           case when p_lat is null or p_lng is null then null else least(greatest(coalesce(p_radius_km, 40.2336), 0.5), 500) end as r
  ),
  box as (
    select lat, lng, r,
           r / 111.045 as dlat,
           case when abs(lat) > 89 then 360 else r / (111.045 * cos(radians(lat))) end as dlng
    from params
  ),
  candidates as (
    select d.id, d.slug, d.business_name, d.profile_image_url, d.description, d.country_code, d.city, d.postcode_area,
           d.public_address, d.location, d.speciality_tags, d.delivery_available, d.custom_orders, d.rating, d.review_count,
           d.starting_price, d.delivery_estimate, d.public_latitude, d.public_longitude,
           b.lat as qlat, b.lng as qlng, b.r
    from public.designers d cross join box b
    where d.admin_status = 'approved'
      and (b.r is null or (d.public_latitude between b.lat - b.dlat and b.lat + b.dlat
                           and d.public_longitude between b.lng - b.dlng and b.lng + b.dlng))
      and (p_country is null or d.country_code = upper(p_country))
      and (p_city is null or trim(p_city) = '' or lower(d.city) = lower(trim(p_city)))
      and (p_area is null or trim(p_area) = '' or upper(replace(d.postcode_area, ' ', '')) like upper(replace(trim(p_area), ' ', '')) || '%'
           or lower(d.city) = lower(trim(p_area)) or lower(d.location) like '%' || lower(trim(p_area)) || '%')
      and (p_specialities is null or cardinality(p_specialities) = 0 or d.speciality_tags && p_specialities)
      and (p_delivery is null or not p_delivery or d.delivery_available)
      and (p_custom is null or not p_custom or d.custom_orders)
      and (p_min_rating is null or (d.review_count > 0 and d.rating >= p_min_rating))
  ),
  measured as (
    select c.*,
           case when c.qlat is null or c.public_latitude is null then null
                else 6371.0088 * 2 * asin(least(1, sqrt(
                       power(sin(radians(c.public_latitude - c.qlat) / 2), 2)
                       + cos(radians(c.qlat)) * cos(radians(c.public_latitude))
                         * power(sin(radians(c.public_longitude - c.qlng) / 2), 2)))) end as dist
    from candidates c
  )
  select m.id, m.slug, m.business_name, m.profile_image_url, m.description,
         m.country_code, m.city, m.postcode_area, m.public_address, m.location,
         m.speciality_tags, m.delivery_available, m.custom_orders,
         case when m.review_count > 0 then m.rating end, m.review_count, m.starting_price, m.delivery_estimate,
         m.public_latitude, m.public_longitude, round(m.dist::numeric, 2)::double precision,
         count(*) over ()
  from measured m
  where m.r is null or m.dist <= m.r
  order by
    case when p_sort = 'rating' then (case when m.review_count > 0 then m.rating end) end desc nulls last,
    case when p_sort = 'rating' then m.review_count end desc,
    m.dist asc nulls last,
    (case when m.review_count > 0 then m.rating end) desc nulls last,
    m.business_name
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- One tailor's public page: profile, portfolio, services and latest reviews
-- (reviewers shown by first name only). Approved tailors only — or your own.
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
-- 10. Security rules
-- ---------------------------------------------------------------------

alter table public.countries enable row level security;
alter table public.specialities enable row level security;
alter table public.designer_customer_notes enable row level security;

drop policy if exists "countries: everyone reads" on public.countries;
create policy "countries: everyone reads" on public.countries for select using (true);
drop policy if exists "countries: admin manages" on public.countries;
create policy "countries: admin manages" on public.countries
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "specialities: everyone reads" on public.specialities;
create policy "specialities: everyone reads" on public.specialities for select using (true);
drop policy if exists "specialities: admin manages" on public.specialities;
create policy "specialities: admin manages" on public.specialities
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- Tailors ----
-- Approved tailors are public; pending and hidden ones only to their own
-- team, the admin, and customers who already ordered from them
drop policy if exists "designers public read" on public.designers;
drop policy if exists "designers: read approved, own or admin" on public.designers;
create policy "designers: read approved, own or admin" on public.designers
  for select using (admin_status = 'approved' or public.can_manage_designer(id) or id in (select public.wv_my_order_designer_ids()));
-- Only the owner (or the admin) edits a tailor profile — not their staff
drop policy if exists "designers: owner or admin can update their own designer row" on public.designers;
create policy "designers: owner or admin can update their own designer row" on public.designers
  for update using (owner_user_id = (select auth.uid()) or (select public.is_admin()))
  with check (owner_user_id = (select auth.uid()) or (select public.is_admin()));

-- The public columns. The exact address, postcode, position, phone and the
-- admin's note are left out: the app reads those with wearvia_my_designers().
revoke all on public.designers from anon, authenticated;
grant select (id, business_name, slug, location, rating, review_count, speciality_tags, commission_rate, created_at,
              owner_user_id, approved, admin_status, profile_image_url, description, starting_price, delivery_estimate,
              country_code, city, postcode_area, public_address, public_latitude, public_longitude, show_exact_address,
              delivery_available, custom_orders, updated_at)
  on public.designers to anon, authenticated;
grant update (business_name, slug, location, speciality_tags, profile_image_url, description, starting_price, delivery_estimate,
              country_code, city, postcode, address_line, show_exact_address, latitude, longitude, delivery_available,
              custom_orders, phone, approved, admin_status, admin_note)
  on public.designers to authenticated;

-- Portfolio: public for approved tailors; only the owner (or admin) changes it
drop policy if exists "designer_portfolio_items: public read" on public.designer_portfolio_items;
create policy "designer_portfolio_items: public read" on public.designer_portfolio_items
  for select using (designer_id in (select d.id from public.designers d where d.admin_status = 'approved')
                    or public.can_manage_designer(designer_id));
drop policy if exists "designer_portfolio_items: owner manages own" on public.designer_portfolio_items;
create policy "designer_portfolio_items: owner manages own" on public.designer_portfolio_items
  for insert with check (public.wv_owns_designer(designer_id));
drop policy if exists "designer_portfolio_items: owner updates own" on public.designer_portfolio_items;
create policy "designer_portfolio_items: owner updates own" on public.designer_portfolio_items
  for update using (public.wv_owns_designer(designer_id)) with check (public.wv_owns_designer(designer_id));
drop policy if exists "designer_portfolio_items: owner deletes own" on public.designer_portfolio_items;
create policy "designer_portfolio_items: owner deletes own" on public.designer_portfolio_items
  for delete using (public.wv_owns_designer(designer_id));

-- ---- Customers: each tailor team sees only its own customers ----
drop policy if exists "customers: team reads all" on public.customers;
drop policy if exists "customers: team reads own" on public.customers;
create policy "customers: team reads own" on public.customers
  for select using (id in (select public.wv_team_customer_ids()));
drop policy if exists "customers: team adds walk-in customers" on public.customers;
create policy "customers: team adds walk-in customers" on public.customers
  for insert with check (added_by_designer_id is not null and public.can_manage_designer(added_by_designer_id));
drop policy if exists "customers: team updates" on public.customers;
create policy "customers: team updates" on public.customers
  for update using (id in (select public.wv_team_customer_ids())) with check (id in (select public.wv_team_customer_ids()));

-- The old shared notes column is no longer readable from the app (each tailor has their own notes now)
revoke all on public.customers from anon, authenticated;
grant select (id, auth_user_id, name, email, phone, created_at, added_by_designer_id) on public.customers to authenticated;
grant insert (id, auth_user_id, name, email, phone, created_at, added_by_designer_id) on public.customers to authenticated;
grant update (name, email, phone) on public.customers to authenticated;

drop policy if exists "designer_customer_notes: team manages" on public.designer_customer_notes;
create policy "designer_customer_notes: team manages" on public.designer_customer_notes
  for all to authenticated using (public.can_manage_designer(designer_id))
  with check (public.can_manage_designer(designer_id) and customer_id in (select public.wv_team_customer_ids()));
grant select, insert, update, delete on public.designer_customer_notes to authenticated;
revoke all on public.designer_customer_notes from anon;

-- ---- Measurements: only for the team's own customers ----
drop policy if exists "measurement_profiles: team manages" on public.measurement_profiles;
create policy "measurement_profiles: team manages" on public.measurement_profiles
  for all using (customer_id in (select public.wv_team_customer_ids()))
  with check (customer_id in (select public.wv_team_customer_ids()));

-- ---- Payments: only on the team's own orders ----
drop policy if exists "payments: team manages" on public.payments;
create policy "payments: team manages" on public.payments
  for all using (order_id in (select public.wv_team_order_ids()))
  with check (order_id in (select public.wv_team_order_ids()));

-- ---- Chats: customers their own; each team only its own orders' chats ----
drop policy if exists "order_messages: customer or team reads" on public.order_messages;
create policy "order_messages: customer or team reads" on public.order_messages
  for select to authenticated
  using (order_id in (select public.wv_my_order_ids()) or order_id in (select public.wv_team_order_ids()));
drop policy if exists "order_messages: customer or team writes" on public.order_messages;
create policy "order_messages: customer or team writes" on public.order_messages
  for insert to authenticated
  with check (order_id in (select public.wv_my_order_ids()) or order_id in (select public.wv_team_order_ids()));
drop policy if exists "order_chat_reads: customer or team reads" on public.order_chat_reads;
create policy "order_chat_reads: customer or team reads" on public.order_chat_reads
  for select to authenticated
  using (order_id in (select public.wv_my_order_ids()) or order_id in (select public.wv_team_order_ids()));

-- ---- Fabric marketplace: run by the admin ----
drop policy if exists "fabrics: read approved, own or team" on public.fabrics;
create policy "fabrics: read approved, own or team" on public.fabrics
  for select using (
    (status = 'approved' and deleted_at is null)
    or public.can_manage_supplier(supplier_id)
    or (select public.is_admin())
    or id in (select public.wv_my_order_fabric_ids())
    or id in (select o.fabric_id from public.orders o where o.id in (select public.wv_team_order_ids())));
drop policy if exists "fabrics: team adds" on public.fabrics;
create policy "fabrics: team adds" on public.fabrics
  for insert with check ((select public.is_admin()));
drop policy if exists "fabrics: team updates" on public.fabrics;
create policy "fabrics: team updates" on public.fabrics
  for update using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "suppliers: team adds" on public.suppliers;
create policy "suppliers: team adds" on public.suppliers
  for insert with check ((select public.is_admin()));
drop policy if exists "suppliers: team updates" on public.suppliers;
create policy "suppliers: team updates" on public.suppliers
  for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "fabric_order_lines: seller reads own" on public.fabric_order_lines;
create policy "fabric_order_lines: seller reads own" on public.fabric_order_lines
  for select using (public.can_manage_supplier(supplier_id) or order_id in (select public.wv_team_order_ids()));
drop policy if exists "fabric_order_lines: seller marks sent" on public.fabric_order_lines;
create policy "fabric_order_lines: seller marks sent" on public.fabric_order_lines
  for update using (public.can_manage_supplier(supplier_id) or order_id in (select public.wv_team_order_ids()))
  with check (public.can_manage_supplier(supplier_id) or order_id in (select public.wv_team_order_ids()));

-- ---- Ready-to-wear sales: each team sees sales of its own items ----
drop policy if exists "ready_to_wear_sales: team manages" on public.ready_to_wear_sales;
create policy "ready_to_wear_sales: team manages" on public.ready_to_wear_sales
  for all using (item_id in (select i.id from public.ready_to_wear_items i where public.can_manage_designer(i.designer_id)))
  with check (item_id in (select i.id from public.ready_to_wear_items i where public.can_manage_designer(i.designer_id)));

-- ---- Prices: each team changes only its own price list ----
drop policy if exists "price_list: team changes prices" on public.price_list;
create policy "price_list: team changes prices" on public.price_list
  for update to authenticated using (public.can_manage_designer(designer_id)) with check (public.can_manage_designer(designer_id));

grant select on public.countries, public.specialities to anon, authenticated;
grant insert, update, delete on public.countries, public.specialities to authenticated;

-- ---- Who can call what ----
revoke execute on function public.wearvia_search_tailors(double precision, double precision, double precision, text, text, text, text[], boolean, boolean, numeric, text, integer, integer) from public;
grant execute on function public.wearvia_search_tailors(double precision, double precision, double precision, text, text, text, text[], boolean, boolean, numeric, text, integer, integer) to anon, authenticated;
revoke execute on function public.wearvia_tailor_page(text) from public;
grant execute on function public.wearvia_tailor_page(text) to anon, authenticated;
revoke execute on function public.wearvia_register_designer(text, text, text, text) from public, anon;
grant execute on function public.wearvia_register_designer(text, text, text, text) to authenticated;
revoke execute on function public.wearvia_bootstrap() from public, anon;
grant execute on function public.wearvia_bootstrap() to authenticated;
revoke execute on function public.wearvia_add_team_member(text, text, uuid) from public, anon;
grant execute on function public.wearvia_add_team_member(text, text, uuid) to authenticated;
revoke execute on function public.wearvia_team_logins(uuid) from public, anon;
grant execute on function public.wearvia_team_logins(uuid) to authenticated;
revoke execute on function public.wearvia_my_designers() from public, anon;
grant execute on function public.wearvia_my_designers() to authenticated;
revoke execute on function public.wearvia_set_designer_status(uuid, text, text) from public, anon;
grant execute on function public.wearvia_set_designer_status(uuid, text, text) to authenticated;
-- Internal helpers are not for calling from the app
revoke execute on function public.wv_seed_price_list(uuid) from public, anon, authenticated;
revoke execute on function public.wv_refresh_designer_rating(uuid) from public, anon, authenticated;
revoke execute on function public.wv_designer_name(uuid) from public, anon;
revoke execute on function public.wv_chat_name_for(boolean, uuid) from public, anon;
grant execute on function public.wv_chat_name_for(boolean, uuid) to authenticated;   -- the chat rule uses it


-- ---------------------------------------------------------------------
-- 11. Tailors' photos: a public bucket
-- ---------------------------------------------------------------------
-- Logos and portfolio photos go in designer-photos/<user id>/…, and only
-- someone who owns or works for a tailor can upload there.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('designer-photos', 'designer-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wearvia: view designer photos" on storage.objects;
create policy "wearvia: view designer photos" on storage.objects
  for select using (bucket_id = 'designer-photos');
drop policy if exists "wearvia: tailors upload own photos" on storage.objects;
create policy "wearvia: tailors upload own photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'designer-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.wv_is_team()));
drop policy if exists "wearvia: tailors replace own photos" on storage.objects;
create policy "wearvia: tailors replace own photos" on storage.objects
  for update to authenticated using (bucket_id = 'designer-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "wearvia: tailors delete own photos" on storage.objects;
create policy "wearvia: tailors delete own photos" on storage.objects
  for delete to authenticated using (bucket_id = 'designer-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Style photos and chat photos: the customer, and only the order's own tailor team
create or replace function public.wv_team_can_see_style_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o
                 where p_name = any (o.inspiration_photos) and public.can_manage_designer(o.designer_id))
$$;
create or replace function public.wv_team_can_see_chat_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_messages m join public.orders o on o.id = m.order_id
                 where p_name = any (m.photos) and public.can_manage_designer(o.designer_id))
$$;

drop policy if exists "wearvia: customers and team view style photos" on storage.objects;
create policy "wearvia: customers and team view style photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'style-photos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.wv_team_can_see_style_photo(name)));

drop policy if exists "wearvia: view chat photos" on storage.objects;
create policy "wearvia: view chat photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-photos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or public.wv_can_see_chat_photo(name)
         or public.wv_team_can_see_chat_photo(name)));

commit;

-- Tell the Supabase API about the new columns, tables and functions straight away
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 12. Report — every line should say "OK".
-- ---------------------------------------------------------------------
-- Line 7 signs in as "nobody" (the public) for a moment to check what the
-- public can really see; it changes nothing.
drop table if exists pg_temp.wv_tnm_public;
create temp table wv_tnm_public (check_name text, result text);
grant all on wv_tnm_public to anon;
do $$
declare
  v_seen_hidden integer;
  v_private     boolean := false;
  v_search      integer;
begin
  set local role anon;
  select count(*) into v_seen_hidden from public.designers where admin_status <> 'approved';
  begin
    perform latitude from public.designers limit 1;
  exception when insufficient_privilege then
    v_private := true;
  end;
  select count(*) into v_search from public.wearvia_search_tailors(51.5, -0.12, 100);
  reset role;
  insert into wv_tnm_public values ('The public sees approved tailors only, and no exact addresses',
    case when v_seen_hidden = 0 and v_private then 'OK (search works: ' || v_search || ' within 100 km of London)'
         else 'NOT LOCKED — tell your developer' end);
end $$;

with checks as (
  select 1 as n, 'Existing orders, invoices and payments unchanged' as check_name,
         case when not exists (
                select kind, id, fingerprint from wv_tnm_before where kind in ('order', 'invoice', 'payment')
                except
                (select 'order', id::text, md5(row(designer_id, customer_id, order_number, fabric_id, fabric_yards, fabric_cost,
                          tailoring_cost, embroidery_cost, delivery_cost, quote_total, deposit_amount, line_items, deposit_paid_at,
                          balance_paid_at, stage, quote_status)::text) from public.orders
                 union all
                 select 'invoice', id::text, md5(row(order_id, total, line_items)::text) from public.invoices
                 union all
                 select 'payment', id::text, md5(row(order_id, amount, status)::text) from public.payments))
              then 'OK (' || (select count(*) from wv_tnm_before where kind = 'order') || ' orders checked)'
              else 'CHANGED — tell your developer' end as result
  union all
  select 2, 'Nebeda Threads is designer number one, approved, with its prices unchanged',
         case when (select business_name from public.designers where id = public.wv_main_designer_id()) ilike 'nebeda%'
               and (select admin_status from public.designers where id = public.wv_main_designer_id()) = 'approved'
               and not exists (select kind, id, fingerprint from wv_tnm_before where kind = 'price'
                               except select 'price', id::text, md5(row(kind, name, price, yards)::text) from public.price_list)
               and not exists (select 1 from public.price_list where designer_id is distinct from public.wv_main_designer_id()
                               and id::text in (select id from wv_tnm_before where kind = 'price'))
              then 'OK (' || (select slug from public.designers where id = public.wv_main_designer_id()) || ')'
              else 'CHECK — tell your developer' end
  union all
  select 3, 'Every tailor has a price list',
         case when not exists (select 1 from public.designers d where not exists (select 1 from public.price_list p where p.designer_id = d.id))
              then 'OK (' || (select count(*) from public.designers) || ' tailors, '
                   || (select count(*) from public.designers where admin_status = 'approved') || ' approved, '
                   || (select count(*) from public.designers where admin_status = 'pending') || ' waiting for you)'
              else 'MISSING — tell your developer' end
  union all
  select 4, 'Countries and specialities',
         case when (select count(*) from public.countries) >= 249 and (select count(*) from public.specialities) >= 10
               and (select uses_miles from public.countries where code = 'GB') and not (select uses_miles from public.countries where code = 'NG')
              then 'OK (' || (select count(*) from public.countries) || ' countries, ' || (select count(*) from public.specialities) || ' specialities)'
              else 'MISSING — tell your developer' end
  union all
  select 5, 'Every tailor''s team sees only its own customers, orders, chats and payments',
         case when not exists (select 1 from pg_policies where schemaname = 'public'
                               and tablename in ('customers', 'measurement_profiles', 'payments', 'order_messages', 'order_chat_reads',
                                                 'fabric_order_lines', 'ready_to_wear_sales', 'price_list')
                               and (coalesce(qual, '') ilike '%wv_is_team%' or coalesce(with_check, '') ilike '%wv_is_team%'))
               and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                               and policyname in ('wearvia: customers and team view style photos', 'wearvia: view chat photos')
                               and coalesce(qual, '') ilike '%wv_is_team%')
               and not has_column_privilege('authenticated', 'public.customers', 'notes', 'select')
               and (select prosrc from pg_proc where oid = 'public.wv_orders_before_insert()'::regprocedure) ilike '%p.designer_id = new.designer_id%'
               and (select prosrc from pg_proc where oid = 'public.wearvia_send_quote(uuid, numeric, uuid, text)'::regprocedure) ilike '%p.designer_id = o.designer_id%'
              then 'OK' else 'NOT LOCKED — tell your developer' end
  union all
  select 6, 'Only the owner edits a profile; only the admin approves',
         case when exists (select 1 from pg_trigger where tgname = 'wv_designers_before_write' and tgrelid = 'public.designers'::regclass and tgenabled <> 'D')
               and not has_table_privilege('authenticated', 'public.designers', 'insert')
               and not has_column_privilege('anon', 'public.designers', 'address_line', 'select')
               and not has_column_privilege('authenticated', 'public.designers', 'postcode', 'select')
               and not has_column_privilege('authenticated', 'public.designers', 'rating', 'update')
               and has_function_privilege('anon', 'public.wearvia_search_tailors(double precision, double precision, double precision, text, text, text, text[], boolean, boolean, numeric, text, integer, integer)', 'execute')
               and exists (select 1 from pg_indexes where indexname = 'designers_position_idx_wv')
              then 'OK' else 'NOT LOCKED — tell your developer' end
  union all
  select 7, check_name, result from wv_tnm_public
  union all
  select 8, 'Tailors'' photo bucket is public, style and chat photos stay private',
         case when exists (select 1 from storage.buckets where id = 'designer-photos' and public)
               and exists (select 1 from storage.buckets where id = 'style-photos' and not public)
               and exists (select 1 from storage.buckets where id = 'chat-photos' and not public)
              then 'OK' else 'CHECK — tell your developer' end
)
select check_name, result from (
  select n, check_name, result from checks
  union all
  select 99, 'ALL DONE', case when bool_and(result like 'OK%') then 'OK — you can merge the app update'
                              else 'NOT OK — see the lines above and tell your developer' end
  from checks
) report
order by n;
