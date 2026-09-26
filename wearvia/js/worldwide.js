// ============================================================
// worldwide.js — NebedaHub everywhere: currencies, exchange rates, yards
// or metres, inches or centimetres, phone numbers with a country code,
// and dates in the viewer's own format and time zone
//
//   • Money: every tailor, fabric seller, price, fabric and order has a
//     currency (supabase/worldwide.sql). money(amount, "NGN") writes it the
//     right way: £1,250 · ₦250,000 · $1,250.00. Orders are charged in the
//     TAILOR's currency; the database converts a seller's fabric price when
//     the quote is sent and saves the rate on the order. The browser only
//     converts to SHOW an approximate price ("≈ £125"), never to charge.
//   • Exchange rates: in live mode from the exchange_rates table (updated
//     every day by the GitHub Action "Exchange rates"); the demo uses the
//     sample rates below.
//   • Fabric is stored in yards. Tailors in the UK, Nigeria, Ghana and the
//     USA see yards; everyone else sees metres (1 yd = 0.9144 m exactly).
//   • Body measurements are stored in inches; customers choose inches or
//     centimetres.
// ============================================================

// [code, name, symbol, decimals, trim zeros (1/0), sort order] — the same list as supabase/worldwide.sql
const WORLD_CURRENCIES = [["AED","United Arab Emirates Dirham","AED",2,0,100],["AFN","Afghan Afghani","؋",0,0,100],["ALL","Albanian Lek","ALL",0,0,100],["AMD","Armenian Dram","֏",2,0,100],["AOA","Angolan Kwanza","Kz",2,0,100],["ARS","Argentine Peso","ARS",2,0,100],["AUD","Australian Dollar","A$",2,0,100],["AWG","Aruban Florin","AWG",2,0,100],["AZN","Azerbaijani Manat","₼",2,0,100],["BAM","Bosnia-Herzegovina Convertible Mark","KM",2,0,100],["BBD","Barbadian Dollar","BBD",2,0,100],["BDT","Bangladeshi Taka","৳",2,0,100],["BHD","Bahraini Dinar","BHD",2,0,100],["BIF","Burundian Franc","BIF",0,0,100],["BMD","Bermudan Dollar","BMD",2,0,100],["BND","Brunei Dollar","BND",2,0,100],["BOB","Bolivian Boliviano","Bs",2,0,100],["BRL","Brazilian Real","R$",2,0,100],["BSD","Bahamian Dollar","BSD",2,0,100],["BTN","Bhutanese Ngultrum","BTN",2,0,100],["BWP","Botswanan Pula","P",2,0,100],["BYN","Belarusian Ruble","BYN",2,0,100],["BZD","Belize Dollar","BZD",2,0,100],["CAD","Canadian Dollar","CA$",2,0,6],["CDF","Congolese Franc","CDF",2,0,100],["CHF","Swiss Franc","CHF",2,0,100],["CLP","Chilean Peso","CLP",0,0,100],["CNY","Chinese Yuan","CN¥",2,0,100],["COP","Colombian Peso","COP",0,0,100],["CRC","Costa Rican Colón","₡",2,0,100],["CUP","Cuban Peso","CUP",2,0,100],["CVE","Cape Verdean Escudo","CVE",2,0,100],["CZK","Czech Koruna","Kč",2,0,100],["DJF","Djiboutian Franc","DJF",0,0,100],["DKK","Danish Krone","DKK",2,0,100],["DOP","Dominican Peso","DOP",2,0,100],["DZD","Algerian Dinar","DZD",2,0,100],["EGP","Egyptian Pound","E£",2,0,100],["ERN","Eritrean Nakfa","ERN",2,0,100],["ETB","Ethiopian Birr","ETB",2,0,100],["EUR","Euro","€",2,0,5],["FJD","Fijian Dollar","FJD",2,0,100],["FKP","Falkland Islands Pound","FKP",2,0,100],["GBP","British Pound","£",2,1,1],["GEL","Georgian Lari","₾",2,0,100],["GHS","Ghanaian Cedi","GH₵",2,0,3],["GIP","Gibraltar Pound","GIP",2,0,100],["GMD","Gambian Dalasi","GMD",2,0,100],["GNF","Guinean Franc","FG",0,0,100],["GTQ","Guatemalan Quetzal","Q",2,0,100],["GYD","Guyanaese Dollar","GYD",2,0,100],["HKD","Hong Kong Dollar","HK$",2,0,100],["HNL","Honduran Lempira","L",2,0,100],["HTG","Haitian Gourde","HTG",2,0,100],["HUF","Hungarian Forint","Ft",0,0,100],["IDR","Indonesian Rupiah","Rp",0,0,100],["ILS","Israeli New Shekel","₪",2,0,100],["INR","Indian Rupee","₹",2,0,100],["IQD","Iraqi Dinar","IQD",0,0,100],["IRR","Iranian Rial","IRR",0,0,100],["ISK","Icelandic Króna","ISK",0,0,100],["JMD","Jamaican Dollar","JMD",2,0,100],["JOD","Jordanian Dinar","JOD",2,0,100],["JPY","Japanese Yen","¥",0,0,100],["KES","Kenyan Shilling","KSh",2,0,8],["KGS","Kyrgyz Som","KGS",2,0,100],["KHR","Cambodian Riel","៛",2,0,100],["KMF","Comorian Franc","CF",0,0,100],["KPW","North Korean Won","₩",0,0,100],["KRW","South Korean Won","₩",0,0,100],["KWD","Kuwaiti Dinar","KWD",2,0,100],["KYD","Cayman Islands Dollar","KYD",2,0,100],["KZT","Kazakhstani Tenge","₸",2,0,100],["LAK","Laotian Kip","₭",0,0,100],["LBP","Lebanese Pound","L£",0,0,100],["LKR","Sri Lankan Rupee","LKR",2,0,100],["LRD","Liberian Dollar","LRD",2,0,100],["LSL","Lesotho Loti","LSL",2,0,100],["LYD","Libyan Dinar","LYD",2,0,100],["MAD","Moroccan Dirham","MAD",2,0,100],["MDL","Moldovan Leu","MDL",2,0,100],["MGA","Malagasy Ariary","Ar",0,0,100],["MKD","Macedonian Denar","MKD",2,0,100],["MMK","Myanmar Kyat","K",0,0,100],["MNT","Mongolian Tugrik","₮",2,0,100],["MOP","Macanese Pataca","MOP",2,0,100],["MRU","Mauritanian Ouguiya","MRU",2,0,100],["MUR","Mauritian Rupee","MUR",2,0,100],["MVR","Maldivian Rufiyaa","MVR",2,0,100],["MWK","Malawian Kwacha","MWK",2,0,100],["MXN","Mexican Peso","MX$",2,0,100],["MYR","Malaysian Ringgit","RM",2,0,100],["MZN","Mozambican Metical","MZN",2,0,100],["NAD","Namibian Dollar","NAD",2,0,100],["NGN","Nigerian Naira","₦",0,0,2],["NIO","Nicaraguan Córdoba","C$",2,0,100],["NOK","Norwegian Krone","NOK",2,0,100],["NPR","Nepalese Rupee","NPR",2,0,100],["NZD","New Zealand Dollar","NZ$",2,0,100],["OMR","Omani Rial","OMR",2,0,100],["PAB","Panamanian Balboa","PAB",2,0,100],["PEN","Peruvian Sol","PEN",2,0,100],["PGK","Papua New Guinean Kina","PGK",2,0,100],["PHP","Philippine Peso","₱",2,0,100],["PKR","Pakistani Rupee","PKR",0,0,100],["PLN","Polish Zloty","zł",2,0,100],["PYG","Paraguayan Guarani","₲",0,0,100],["QAR","Qatari Riyal","QAR",2,0,100],["RON","Romanian Leu","lei",2,0,100],["RSD","Serbian Dinar","RSD",2,0,100],["RUB","Russian Ruble","₽",2,0,100],["RWF","Rwandan Franc","RF",0,0,100],["SAR","Saudi Riyal","SAR",2,0,100],["SBD","Solomon Islands Dollar","SBD",2,0,100],["SCR","Seychellois Rupee","SCR",2,0,100],["SDG","Sudanese Pound","SDG",2,0,100],["SEK","Swedish Krona","SEK",2,0,100],["SGD","Singapore Dollar","SGD",2,0,100],["SHP","St. Helena Pound","SHP",2,0,100],["SLE","Sierra Leonean Leone","SLE",2,0,100],["SOS","Somali Shilling","SOS",0,0,100],["SRD","Surinamese Dollar","SRD",2,0,100],["SSP","South Sudanese Pound","SSP",2,0,100],["STN","São Tomé & Príncipe Dobra","Db",2,0,100],["SYP","Syrian Pound","SYP",0,0,100],["SZL","Swazi Lilangeni","SZL",2,0,100],["THB","Thai Baht","฿",2,0,100],["TJS","Tajikistani Somoni","TJS",2,0,100],["TMT","Turkmenistani Manat","TMT",2,0,100],["TND","Tunisian Dinar","TND",2,0,100],["TOP","Tongan Paʻanga","T$",2,0,100],["TRY","Turkish Lira","₺",2,0,100],["TTD","Trinidad & Tobago Dollar","TTD",2,0,100],["TWD","New Taiwan Dollar","NT$",2,0,100],["TZS","Tanzanian Shilling","TSh",2,0,100],["UAH","Ukrainian Hryvnia","₴",2,0,100],["UGX","Ugandan Shilling","USh",0,0,100],["USD","US Dollar","$",2,0,4],["UYU","Uruguayan Peso","UYU",2,0,100],["UZS","Uzbekistani Som","UZS",2,0,100],["VES","Venezuelan Bolívar","VES",2,0,100],["VND","Vietnamese Dong","₫",0,0,100],["VUV","Vanuatu Vatu","VUV",0,0,100],["WST","Samoan Tala","WST",2,0,100],["XAF","Central African CFA Franc","FCFA",0,0,100],["XCD","East Caribbean Dollar","EC$",2,0,100],["XCG","Caribbean guilder","Cg.",2,0,100],["XOF","West African CFA Franc","F CFA",0,0,100],["XPF","CFP Franc","CFPF",0,0,100],["YER","Yemeni Rial","YER",0,0,100],["ZAR","South African Rand","R",2,0,7],["ZMW","Zambian Kwacha","ZK",2,0,100],["ZWG","Zimbabwean Gold","ZWG",2,0,100]];

// Country → [currency, phone code]
const COUNTRY_MONEY = {"AF":["AFN","+93"],"AX":["EUR","+358"],"AL":["ALL","+355"],"DZ":["DZD","+213"],"AS":["USD","+1684"],"AD":["EUR","+376"],"AO":["AOA","+244"],"AI":["XCD","+1264"],"AQ":["USD","+672"],"AG":["XCD","+1268"],"AR":["ARS","+54"],"AM":["AMD","+374"],"AW":["AWG","+297"],"AU":["AUD","+61"],"AT":["EUR","+43"],"AZ":["AZN","+994"],"BS":["BSD","+1242"],"BH":["BHD","+973"],"BD":["BDT","+880"],"BB":["BBD","+1246"],"BY":["BYN","+375"],"BE":["EUR","+32"],"BZ":["BZD","+501"],"BJ":["XOF","+229"],"BM":["BMD","+1441"],"BT":["BTN","+975"],"BO":["BOB","+591"],"BQ":["USD","+5997"],"BA":["BAM","+387"],"BW":["BWP","+267"],"BV":["NOK","+47"],"BR":["BRL","+55"],"IO":["USD","+246"],"BN":["BND","+673"],"BG":["EUR","+359"],"BF":["XOF","+226"],"BI":["BIF","+257"],"CV":["CVE","+238"],"KH":["KHR","+855"],"CM":["XAF","+237"],"CA":["CAD","+1"],"KY":["KYD","+1345"],"CF":["XAF","+236"],"TD":["XAF","+235"],"CL":["CLP","+56"],"CN":["CNY","+86"],"CX":["AUD","+61"],"CC":["AUD","+61"],"CO":["COP","+57"],"KM":["KMF","+269"],"CG":["XAF","+242"],"CD":["CDF","+243"],"CK":["NZD","+682"],"CR":["CRC","+506"],"CI":["XOF","+225"],"HR":["EUR","+385"],"CU":["CUP","+53"],"CW":["XCG","+5999"],"CY":["EUR","+357"],"CZ":["CZK","+420"],"DK":["DKK","+45"],"DJ":["DJF","+253"],"DM":["XCD","+1767"],"DO":["DOP","+1809"],"EC":["USD","+593"],"EG":["EGP","+20"],"SV":["USD","+503"],"GQ":["XAF","+240"],"ER":["ERN","+291"],"EE":["EUR","+372"],"SZ":["SZL","+268"],"ET":["ETB","+251"],"FK":["FKP","+500"],"FO":["DKK","+298"],"FJ":["FJD","+679"],"FI":["EUR","+358"],"FR":["EUR","+33"],"GF":["EUR","+594"],"PF":["XPF","+689"],"TF":["EUR","+262"],"GA":["XAF","+241"],"GM":["GMD","+220"],"GE":["GEL","+995"],"DE":["EUR","+49"],"GH":["GHS","+233"],"GI":["GIP","+350"],"GR":["EUR","+30"],"GL":["DKK","+299"],"GD":["XCD","+1473"],"GP":["EUR","+590"],"GU":["USD","+1671"],"GT":["GTQ","+502"],"GG":["GBP","+44"],"GN":["GNF","+224"],"GW":["XOF","+245"],"GY":["GYD","+592"],"HT":["HTG","+509"],"HM":["AUD","+61"],"VA":["EUR","+379"],"HN":["HNL","+504"],"HK":["HKD","+852"],"HU":["HUF","+36"],"IS":["ISK","+354"],"IN":["INR","+91"],"ID":["IDR","+62"],"IR":["IRR","+98"],"IQ":["IQD","+964"],"IE":["EUR","+353"],"IM":["GBP","+44"],"IL":["ILS","+972"],"IT":["EUR","+39"],"JM":["JMD","+1876"],"JP":["JPY","+81"],"JE":["GBP","+44"],"JO":["JOD","+962"],"KZ":["KZT","+7"],"KE":["KES","+254"],"KI":["AUD","+686"],"KP":["KPW","+850"],"KR":["KRW","+82"],"KW":["KWD","+965"],"KG":["KGS","+996"],"LA":["LAK","+856"],"LV":["EUR","+371"],"LB":["LBP","+961"],"LS":["LSL","+266"],"LR":["LRD","+231"],"LY":["LYD","+218"],"LI":["CHF","+423"],"LT":["EUR","+370"],"LU":["EUR","+352"],"MO":["MOP","+853"],"MG":["MGA","+261"],"MW":["MWK","+265"],"MY":["MYR","+60"],"MV":["MVR","+960"],"ML":["XOF","+223"],"MT":["EUR","+356"],"MH":["USD","+692"],"MQ":["EUR","+596"],"MR":["MRU","+222"],"MU":["MUR","+230"],"YT":["EUR","+262"],"MX":["MXN","+52"],"FM":["USD","+691"],"MD":["MDL","+373"],"MC":["EUR","+377"],"MN":["MNT","+976"],"ME":["EUR","+382"],"MS":["XCD","+1664"],"MA":["MAD","+212"],"MZ":["MZN","+258"],"MM":["MMK","+95"],"NA":["NAD","+264"],"NR":["AUD","+674"],"NP":["NPR","+977"],"NL":["EUR","+31"],"NC":["XPF","+687"],"NZ":["NZD","+64"],"NI":["NIO","+505"],"NE":["XOF","+227"],"NG":["NGN","+234"],"NU":["NZD","+683"],"NF":["AUD","+672"],"MK":["MKD","+389"],"MP":["USD","+1670"],"NO":["NOK","+47"],"OM":["OMR","+968"],"PK":["PKR","+92"],"PW":["USD","+680"],"PS":["ILS","+970"],"PA":["PAB","+507"],"PG":["PGK","+675"],"PY":["PYG","+595"],"PE":["PEN","+51"],"PH":["PHP","+63"],"PN":["NZD","+64"],"PL":["PLN","+48"],"PT":["EUR","+351"],"PR":["USD","+1787"],"QA":["QAR","+974"],"RE":["EUR","+262"],"RO":["RON","+40"],"RU":["RUB","+7"],"RW":["RWF","+250"],"BL":["EUR","+590"],"SH":["SHP","+290"],"KN":["XCD","+1869"],"LC":["XCD","+1758"],"MF":["EUR","+590"],"PM":["EUR","+508"],"VC":["XCD","+1784"],"WS":["WST","+685"],"SM":["EUR","+378"],"ST":["STN","+239"],"SA":["SAR","+966"],"SN":["XOF","+221"],"RS":["RSD","+381"],"SC":["SCR","+248"],"SL":["SLE","+232"],"SG":["SGD","+65"],"SX":["XCG","+1721"],"SK":["EUR","+421"],"SI":["EUR","+386"],"SB":["SBD","+677"],"SO":["SOS","+252"],"ZA":["ZAR","+27"],"GS":["GBP","+500"],"SS":["SSP","+211"],"ES":["EUR","+34"],"LK":["LKR","+94"],"SD":["SDG","+249"],"SR":["SRD","+597"],"SJ":["NOK","+4779"],"SE":["SEK","+46"],"CH":["CHF","+41"],"SY":["SYP","+963"],"TW":["TWD","+886"],"TJ":["TJS","+992"],"TZ":["TZS","+255"],"TH":["THB","+66"],"TL":["USD","+670"],"TG":["XOF","+228"],"TK":["NZD","+690"],"TO":["TOP","+676"],"TT":["TTD","+1868"],"TN":["TND","+216"],"TR":["TRY","+90"],"TM":["TMT","+993"],"TC":["USD","+1649"],"TV":["AUD","+688"],"UG":["UGX","+256"],"UA":["UAH","+380"],"AE":["AED","+971"],"GB":["GBP","+44"],"US":["USD","+1"],"UM":["USD","+1"],"UY":["UYU","+598"],"UZ":["UZS","+998"],"VU":["VUV","+678"],"VE":["VES","+58"],"VN":["VND","+84"],"VG":["USD","+1284"],"VI":["USD","+1340"],"WF":["XPF","+681"],"EH":["MAD","+212"],"YE":["YER","+967"],"ZM":["ZMW","+260"],"ZW":["ZWG","+263"]};

// Sample exchange rates for the demo only (units per US dollar)
const DEMO_RATES_DATE = "2026-09-25";
const DEMO_RATES = {"AED":3.6725,"AFN":64.0071,"ALL":80.5056,"AMD":363.141,"AOA":916.676,"ARS":1519.85,"AUD":1.42592,"AWG":1.79,"AZN":1.7,"BAM":1.72022,"BBD":2,"BDT":123.161,"BHD":0.376,"BIF":3007.23,"BMD":1,"BND":1.27938,"BOB":12.2449,"BRL":5.19181,"BSD":1,"BTN":95.9325,"BWP":13.6312,"BYN":3.04404,"BZD":2.01351,"CAD":1.41486,"CDF":2310.23,"CHF":0.829254,"CLP":963.243,"CNY":6.71297,"COP":3355.08,"CRC":453.426,"CUP":24.0008,"CVE":96.9862,"CZK":21.4633,"DJF":178.047,"DKK":6.57495,"DOP":59.4079,"DZD":133.679,"EGP":51.7805,"ERN":15,"ETB":163.052,"EUR":0.879534,"FJD":2.24724,"FKP":0.756917,"GBP":0.756917,"GEL":2.60086,"GHS":11.5953,"GIP":0.756917,"GMD":74.0238,"GNF":8803.22,"GTQ":7.63644,"GYD":209.189,"HKD":7.84355,"HNL":26.8345,"HTG":130.826,"HUF":321.842,"IDR":17939.3,"ILS":3.04617,"INR":95.9325,"IQD":1310.09,"IRR":1374790,"ISK":120.68,"JMD":157.721,"JOD":0.709,"JPY":158.372,"KES":129.537,"KGS":87.4588,"KHR":4065.74,"KMF":432.703,"KPW":900.143,"KRW":1361.27,"KWD":0.308829,"KYD":0.831586,"KZT":441.969,"LAK":22410.9,"LBP":89859.4,"LKR":330.033,"LRD":171.99,"LSL":16.4273,"LYD":6.39479,"MAD":9.6171,"MDL":17.5877,"MGA":4383.61,"MKD":54.0035,"MMK":2099.48,"MNT":3597.94,"MOP":8.07886,"MRU":40.0285,"MUR":47.459,"MVR":15.4594,"MWK":1733.72,"MXN":17.7396,"MYR":4.07794,"MZN":63.8654,"NAD":16.4273,"NGN":1326.86,"NIO":36.7953,"NOK":9.52867,"NPR":153.564,"NZD":1.76938,"OMR":0.384758,"PAB":1,"PEN":3.39074,"PGK":4.45084,"PHP":62.582,"PKR":277.052,"PLN":3.85343,"PYG":5928.58,"QAR":3.64,"RON":4.64094,"RSD":103.307,"RUB":85.0131,"RWF":1475.87,"SAR":3.75,"SBD":8.03781,"SCR":14.3332,"SDG":600.19,"SEK":9.93112,"SGD":1.27938,"SHP":0.756917,"SLE":22.93,"SOS":570.643,"SRD":37.7652,"SSP":5712.59,"STN":21.6712,"SYP":13004.1,"SZL":16.4273,"THB":33.4511,"TJS":9.21847,"TMT":3.50994,"TND":2.95768,"TOP":2.40826,"TRY":48.9376,"TTD":6.79966,"TWD":31.7823,"TZS":2646.45,"UAH":44.9678,"UGX":3928.37,"USD":1,"UYU":40.0605,"UZS":11815.7,"VES":853.311,"VND":25980.5,"VUV":118.506,"WST":2.76549,"XAF":576.937,"XCD":2.70733,"XCG":1.80219,"XOF":576.937,"XPF":104.956,"YER":236.588,"ZAR":16.4273,"ZMW":19.5501,"ZWG":26.637};
const YARD_COUNTRIES = ["GB", "NG", "GH", "US"];
const METRES_PER_YARD_EXACT = 0.9144;
const CM_PER_INCH = 2.54;

// ---- Currencies ----

function currencyList() {
  const live = db && db.currencies && db.currencies.length ? db.currencies : null;
  return (live || WORLD_CURRENCIES.map(([code, name, symbol, decimals, trim, sort]) => ({ code, name, symbol, decimals, trim_zeros: !!trim, sort_order: sort })))
    .slice().sort((a, b) => (a.sort_order || 100) - (b.sort_order || 100) || a.code.localeCompare(b.code));
}

const currencyCache = new Map();
function currencyInfo(code) {
  const key = String(code || "GBP").toUpperCase();
  const list = db && db.currencies && db.currencies.length ? db.currencies : null;
  if (!list && currencyCache.has(key)) return currencyCache.get(key);
  const found = (list || []).find(c => c.code === key)
    || (() => { const row = WORLD_CURRENCIES.find(c => c[0] === key); return row ? { code: row[0], name: row[1], symbol: row[2], decimals: row[3], trim_zeros: !!row[4] } : null; })()
    || { code: key, name: key, symbol: key, decimals: 2, trim_zeros: false };
  if (!list) currencyCache.set(key, found);
  return found;
}

function currencySymbol(code) {
  const c = currencyInfo(code);
  return c.symbol + (c.symbol.length > 1 && /[A-Za-z.]$/.test(c.symbol) ? " " : "");
}

function roundMoney(amount, code) {
  const places = currencyInfo(code).decimals;
  const factor = 10 ** places;
  return Math.round(Number(amount || 0) * factor + (amount >= 0 ? 1e-9 : -1e-9)) / factor;
}

// £1,250 · £1,250.50 · ₦250,000 · $1,250.00 — the same rules as wv_money_text in the database
function formatMoney(amount, code, options) {
  const c = currencyInfo(code);
  const places = options && options.whole ? 0 : c.decimals;
  const value = Math.abs(roundMoney(amount, c.code));
  const shown = places === 0 ? Math.round(value) : value;
  const hasMinor = Math.abs(shown % 1) > 0.000001;
  const digits = places === 0 || (c.trim_zeros && !hasMinor)
    ? Math.round(shown).toLocaleString("en-GB")
    : shown.toLocaleString("en-GB", { minimumFractionDigits: places, maximumFractionDigits: places });
  return (amount < 0 && value > 0 ? "-" : "") + currencySymbol(c.code) + digits;
}

// The currency of what's on screen: the dashboard's tailor, or the tailor the customer is ordering from
function screenCurrency() {
  return designerCurrency(designer());
}

function designerCurrency(d) { return (d && d.currency_code) || "GBP"; }
function bizCurrency() { return designerCurrency(bizDesigner()); }
function orderCurrency(order) { return (order && order.currency_code) || "GBP"; }
function sellerCurrency(seller) { return (seller && seller.currency_code) || "GBP"; }
function fabricCurrency(fabric) {
  return (fabric && fabric.currency_code) || sellerCurrency(fabric && db ? findSupplier(fabric.supplier_id) : null);
}

// ---- Countries: currency, phone code, yards or metres ----

function countryCurrency(code) {
  if (!code) return null;
  const country = countryByCode(code);
  return (country && country.currency_code) || (COUNTRY_MONEY[code] || [])[0] || null;
}

function countryPhoneCode(code) {
  if (!code) return "";
  const country = countryByCode(code);
  return (country && country.phone_code) || (COUNTRY_MONEY[code] || [])[1] || "";
}

// Fabric is sold by the yard in the UK, Nigeria, Ghana and the USA; by the metre everywhere else
function countryFabricUnit(code) {
  if (!code) return "yd";
  const country = countryByCode(code);
  return (country && country.fabric_unit) || (YARD_COUNTRIES.includes(code) ? "yd" : "m");
}

// Where this browser is, as a country code ("GB"), or ""
function browserCountry() {
  return typeof Geo !== "undefined" && Geo.browserRegion ? Geo.browserRegion() : "";
}

// ---- Exchange rates (units per US dollar) ----

function rateRows() {
  if (Cloud.live) return (db && db.exchange_rates) || [];
  return Object.keys(DEMO_RATES).map(code => ({ currency_code: code, units_per_usd: DEMO_RATES[code], rate_date: DEMO_RATES_DATE, source: "sample rates (demo)" }));
}

function rateOf(code) {
  return rateRows().find(r => r.currency_code === String(code || "").toUpperCase()) || null;
}

// amount in `to` = amount in `from` × fxRate(from, to); null when there's no rate
function fxRate(from, to) {
  if (!from || !to || from === to) return 1;
  const a = rateOf(from), b = rateOf(to);
  if (!a || !b) return null;
  return b.units_per_usd / a.units_per_usd;
}

function convertMoney(amount, from, to) {
  const rate = fxRate(from, to);
  return rate == null || amount == null ? null : roundMoney(amount * rate, to);
}

function ratesDate() {
  const dates = rateRows().map(r => r.rate_date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// "£1 = ₦1,752.98" — the way round that gives a number of 1 or more (as the database writes it)
function rateText(rate, from, to) {
  if (!(rate > 0)) return "";
  const big = rate >= 1;
  const n = big ? rate : 1 / rate;
  const one = big ? from : to, many = big ? to : from;
  const number = n >= 100 ? n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `${currencySymbol(one)}1 = ${currencySymbol(many)}${number}`;
}

// A tidy price after converting (three significant figures), like wv_nice_price
function nicePrice(amount, code) {
  if (!(amount > 0)) return amount;
  const step = 10 ** Math.max(Math.floor(Math.log10(amount)) - 2, 0);
  return roundMoney(Math.round(amount / step) * step, code);
}

// ---- Totals across currencies: "£1,250 · ₦250,000" ----

function moneyTotals() { return new Map(); }

function addMoney(totals, code, amount) {
  const key = code || "GBP";
  totals.set(key, (totals.get(key) || 0) + (Number(amount) || 0));
  return totals;
}

function sumByCurrency(list, amountOf, currencyOf) {
  return list.reduce((totals, item) => addMoney(totals, currencyOf(item), amountOf(item)), moneyTotals());
}

// Each currency on its own — never added together
function totalsText(totals, fallback) {
  const first = fallback || screenCurrency();
  const shown = Array.from(totals.entries()).filter(([, amount]) => Math.abs(amount) > 0.004)
    .sort((a, b) => (b[0] === first) - (a[0] === first) || a[0].localeCompare(b[0]));
  if (!shown.length) return money(0, first);
  return shown.map(([code, amount]) => money(amount, code)).join(" · ");
}

function totalsHtml(totals, fallback) {
  const text = totalsText(totals, fallback);
  return totals.size > 1 ? `<span class="multi-currency">${text.split(" · ").map(t => `<span>${escapeHtml(t)}</span>`).join("")}</span>` : escapeHtml(text);
}

// ---- The customer's own currency, for approximate prices ----

function viewerCurrency() {
  if (typeof inBusiness === "function" && inBusiness()) return bizCurrency();   // a tailor sees their own currency
  const customer = db && db.session && db.session.customerId ? db.customers.find(c => c.id === db.session.customerId) : null;
  if (customer && customer.currency_code) return customer.currency_code;
  if (customer && customer.country_code) return countryCurrency(customer.country_code);
  return countryCurrency(browserCountry());
}

// "≈ £125" after a price in another currency — only ever for display, clearly approximate
function approxMoney(amount, from) {
  const to = viewerCurrency();
  if (!to || !from || to === from || amount == null) return "";
  const value = convertMoney(amount, from, to);
  if (value == null) return "";
  const text = formatMoney(value, to, { whole: Math.abs(value) >= 20 });
  return ` <span class="approx" title="Approximate: ${escapeHtml(currencyInfo(to).name)} at today's exchange rate. You pay in ${escapeHtml(currencyInfo(from).name)}.">≈ ${escapeHtml(text)}</span>`;
}

// The line under a screen that shows approximate prices
function approxNote(from) {
  const to = viewerCurrency();
  if (!to || !from || to === from || fxRate(from, to) == null) return "";
  return `<p class="approx-note">≈ = approximate price in ${escapeHtml(currencyInfo(to).name)} at today's exchange rate${ratesDate() ? ` (${formatDate(ratesDate())})` : ""}. You pay in ${escapeHtml(currencyInfo(from).name)} (${escapeHtml(from)}).</p>`;
}

// A currency picker: the popular ones first
function currencyOptions(selected) {
  const list = currencyList();
  const top = list.filter(c => (c.sort_order || 100) < 100);
  const rest = list.filter(c => (c.sort_order || 100) >= 100);
  const option = c => `<option value="${c.code}" ${c.code === selected ? "selected" : ""}>${escapeHtml(c.code)} — ${escapeHtml(c.name)} (${escapeHtml(c.symbol)})</option>`;
  return top.map(option).join("") + `<option disabled>──────────</option>` + rest.map(option).join("");
}

// ---- Fabric: yards or metres ----

function designerFabricUnit(d) { return countryFabricUnit(d && d.country_code); }
function sellerFabricUnit(s) { return countryFabricUnit(s && s.country_code); }
function screenFabricUnit() { return designerFabricUnit(designer()); }
function orderFabricUnit(order) { return (order && order.fabric_unit) || designerFabricUnit(designerById(order && order.designer_id)); }

function unitWord(unit, many) { return unit === "m" ? (many ? "metres" : "metre") : (many ? "yards" : "yard"); }

// A length stored in yards, in yards or metres
function lengthIn(yards, unit) {
  const y = Number(yards) || 0;
  return unit === "m" ? Math.round(y * METRES_PER_YARD_EXACT * 100) / 100 : Math.round(y * 100) / 100;
}

function lengthText(yards, unit) {
  return `${lengthIn(yards, unit)} ${unit === "m" ? "m" : "yd"}`;
}

function yardsFrom(value, unit) {
  const n = Number(value);
  return unit === "m" ? Math.round(n / METRES_PER_YARD_EXACT * 10000) / 10000 : n;
}

// A price per yard, per yard or per metre
function pricePerUnit(pricePerYard, unit) {
  return unit === "m" ? pricePerYard / METRES_PER_YARD_EXACT : pricePerYard;
}

function pricePerYardFrom(price, unit) {
  return unit === "m" ? Math.round(price * METRES_PER_YARD_EXACT * 1e6) / 1e6 : price;
}

// "₦15,000 / yd" or "KSh 900.00 / m"
function fabricPriceText(fabric, unit) {
  return `${money(pricePerUnit(fabric.price_per_yard, unit), fabricCurrency(fabric))} / ${unit === "m" ? "m" : "yd"}`;
}

// ---- Body measurements: stored in inches ----

function customerBodyUnit(customer) {
  if (customer && (customer.measurement_unit === "in" || customer.measurement_unit === "cm")) return customer.measurement_unit;
  const country = (customer && customer.country_code) || browserCountry();
  return country && countryFabricUnit(country) === "m" ? "cm" : "in";
}

function bodyValue(inches, unit) {
  if (inches == null || inches === "") return null;
  return unit === "cm" ? Math.round(Number(inches) * CM_PER_INCH * 2) / 2 : Math.round(Number(inches) * 100) / 100;
}

function bodyText(inches, unit) {
  const v = bodyValue(inches, unit);
  return v == null ? "—" : unit === "cm" ? `${v} cm` : `${v}"`;
}

// For tailors: both, the customer's choice first
function bodyBoth(inches, unit) {
  if (inches == null || inches === "") return "—";
  return unit === "cm" ? `${bodyValue(inches, "cm")} cm · ${bodyValue(inches, "in")}"` : `${bodyValue(inches, "in")}" · ${bodyValue(inches, "cm")} cm`;
}

function inchesFrom(value, unit) {
  if (value === "" || value == null) return null;
  return unit === "cm" ? Math.round(Number(value) / CM_PER_INCH * 1000) / 1000 : Number(value);
}

// ---- Phone numbers: a country code picker and the number ----

function phoneCountryFor(value, fallbackCountry) {
  const text = String(value || "").trim();
  if (text.startsWith("+")) {
    const digits = text.replace(/[^\d]/g, "");
    const matches = countryList().filter(c => countryPhoneCode(c.code) && digits.startsWith(countryPhoneCode(c.code).slice(1)))
      .sort((a, b) => countryPhoneCode(b.code).length - countryPhoneCode(a.code).length);
    const best = matches.filter(c => countryPhoneCode(c.code) === countryPhoneCode(matches[0] && matches[0].code));
    const preferred = best.find(c => c.code === fallbackCountry) || best.find(c => ["GB", "US", "NG", "GH"].includes(c.code)) || best[0];
    if (preferred) return preferred.code;
  }
  return fallbackCountry || browserCountry() || "GB";
}

function phoneFieldHtml(name, value, country, attrs) {
  const code = phoneCountryFor(value, country);
  const dial = countryPhoneCode(code);
  const text = String(value || "").trim();
  // The number without its country code, spaced as it was saved ("+44 7700 900123" → "7700 900123")
  const national = !text.startsWith("+") || !dial ? text
    : text.startsWith(dial + " ") ? text.slice(dial.length).trim()
    : text.replace(/\s/g, "").startsWith(dial) ? text.replace(/\s/g, "").slice(dial.length) : text;
  const options = countryList().filter(c => countryPhoneCode(c.code))
    .map(c => `<option value="${c.code}" ${c.code === code ? "selected" : ""}>${c.flag} ${escapeHtml(countryPhoneCode(c.code))} · ${escapeHtml(c.name)}</option>`).join("");
  return `<span class="phone-field"><select name="${name}_cc" aria-label="Country code">${options}</select>`
    + `<input name="${name}" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="20" value="${escapeHtml(national)}" ${attrs || ""}></span>`;
}

// "+44 7700 900123" from the picker and the number typed (a leading 0 is dropped)
function readPhone(form, name) {
  const input = form.elements ? form.elements.namedItem(name) : form[name];
  const typed = String(input && input.value || "").trim();
  if (!typed) return "";
  if (typed.startsWith("+")) return typed.replace(/[^\d+ ]/g, "").replace(/\s+/g, " ");
  const picker = form.elements ? form.elements.namedItem(name + "_cc") : form[name + "_cc"];
  const dial = countryPhoneCode(picker ? picker.value : "");
  const national = typed.replace(/[^\d ]/g, "").trim().replace(/^0+/, "").replace(/\s+/g, " ");
  return dial ? `${dial} ${national}` : typed;
}

function phoneLooksRight(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

// ---- Dates in the viewer's own format and time zone ----

// "2026-09-26" (a date) stays that day; a timestamp is shown in this device's time zone
function toLocalDate(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }
  const date = new Date(text);
  return isNaN(date) ? null : date;
}

// The date part of a timestamp, in this device's time zone
function localDay(value) {
  const date = value ? new Date(value) : new Date();
  if (isNaN(date)) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(value) {
  const date = toLocalDate(value);
  if (!date) return "—";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeZoneName() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
}
