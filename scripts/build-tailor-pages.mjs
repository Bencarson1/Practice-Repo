#!/usr/bin/env node
// ============================================================
// build-tailor-pages.mjs — real, crawlable pages for search engines
//
// The NebedaHub app uses # addresses (index.html#/tailors), which Google
// mostly ignores. This script writes ordinary HTML pages that work on
// GitHub Pages, each with its own title, description, heading, Open Graph
// tags and JSON-LD (LocalBusiness / ItemList):
//
//   wearvia/tailors/index.html                    all countries
//   wearvia/tailors/<country>/index.html          e.g. /tailors/uk/
//   wearvia/tailors/<country>/<city>/index.html   e.g. /tailors/uk/london/
//   wearvia/tailor/<slug>/index.html              one tailor
//   wearvia/sitemap.xml and robots.txt
//
// (The app's files live in the wearvia/ folder, but the site publishes them
// at the top of the domain: https://nebedahub.com/tailors/uk/london/.)
//
// It reads APPROVED tailors from Supabase with the publishable key only
// (the same public data anyone can see — never exact hidden addresses).
// Each page also loads live results in the browser and links into the app.
//
// Run:   node scripts/build-tailor-pages.mjs
// Settings (environment variables, all optional):
//   SITE_URL   the published address of the site, e.g.
//              https://nebedahub.com   (default)
//   OFFLINE=1  build without Supabase (just the standard city pages)
//   SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY  (default: wearvia/js/config.js)
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT, "wearvia");
const SITE_URL = (process.env.SITE_URL || "https://nebedahub.com").replace(/\/+$/, "");
const APP_URL = SITE_URL;                       // the app is at the top of the site
const OFFLINE = process.env.OFFLINE === "1";
const config = fs.readFileSync(path.join(APP_DIR, "js", "config.js"), "utf8");
const SUPABASE_URL = process.env.SUPABASE_URL || (config.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || (config.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (/sb_secret_|service_role/.test(KEY || "")) {
  console.error("Refusing to run with a secret key. Use the publishable key only.");
  process.exit(1);
}

// Pages that always exist, even before any tailor has joined there
const FEATURED = [["GB", "London"], ["GB", "Manchester"], ["GB", "Birmingham"], ["NG", "Lagos"], ["NG", "Abuja"], ["GH", "Accra"], ["US", "Houston"]];
// Only what the public may see: business name, area, specialities, photos,
// rating and reviews. No address, phone, email, website or social links.
const PUBLIC_COLUMNS = "id,slug,business_name,profile_image_url,description,country_code,city,postcode_area,location,"
  + "speciality_tags,delivery_available,custom_orders,rating,review_count,delivery_estimate,public_latitude,public_longitude,updated_at,currency_code";
// The same contact-details filter as the app and the database, as a second check on what's published
const { hideContactDetails } = createRequire(import.meta.url)(path.join(APP_DIR, "js", "no-leakage.js"));
const clean = t => Object.assign({}, t, Object.fromEntries(["business_name", "description", "city", "location", "delivery_estimate"]
  .map(k => [k, t[k] == null ? t[k] : hideContactDetails(t[k]).text])),
  { speciality_tags: (t.speciality_tags || []).filter(s => !hideContactDetails(s).hidden) });

// ---- Reading from Supabase (publishable key only) ----

async function get(pathAndQuery, range) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: Object.assign({ apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" }, range ? { Range: range, "Range-Unit": "items" } : {})
  });
  if (!response.ok) throw new Error(`${pathAndQuery.split("?")[0]}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function getAll(table, query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await get(`${table}?${query}`, `${from}-${from + 999}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function loadData() {
  if (OFFLINE) {
    const js = fs.readFileSync(path.join(APP_DIR, "js", "countries.js"), "utf8");
    const list = JSON.parse(js.match(/const DEMO_COUNTRIES = (\[.*?\])\.map/s)[1]);
    return { countries: list.map(([code, name, slug]) => ({ code, name, slug, flag: flagOf(code) })), tailors: [] };
  }
  const [countries, tailors, prices, currencies] = await Promise.all([
    getAll("countries", "select=code,name,slug,flag&order=sort_order,name"),
    getAll("designers", `select=${PUBLIC_COLUMNS}&admin_status=eq.approved&order=business_name`),
    // Each tailor's lowest tailoring price, in their own currency ("Tailoring from ₦95,000")
    getAll("price_list", "select=designer_id,price,currency_code&kind=eq.outfit"),
    getAll("currencies", "select=code,symbol,decimals,trim_zeros")
  ]);
  currencies.forEach(c => CURRENCIES.set(c.code, c));
  const lowest = new Map();
  const byId = new Map(tailors.map(t => [t.id, t]));
  prices.forEach(p => {
    const t = byId.get(p.designer_id);
    if (!t || p.currency_code !== (t.currency_code || "GBP")) return;
    if (!lowest.has(t.id) || Number(p.price) < lowest.get(t.id)) lowest.set(t.id, Number(p.price));
  });
  return { countries, tailors: tailors.map(t => Object.assign(clean(t), { from_price: lowest.get(t.id) ?? null, currency_code: t.currency_code || "GBP" })) };
}

// Money written the way the app and the database write it: £1,250 · ₦250,000 · $1,250.00
const CURRENCIES = new Map();
function money(amount, code) {
  const c = CURRENCIES.get(code) || { symbol: code + " ", decimals: 2, trim_zeros: false };
  const places = Number(c.decimals);
  const value = Math.round(Number(amount) * 10 ** places) / 10 ** places;
  const whole = places === 0 || (c.trim_zeros && value % 1 === 0);
  const digits = value.toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : places, maximumFractionDigits: whole ? 0 : places });
  return c.symbol + (c.symbol.length > 1 && /[A-Za-z.]$/.test(c.symbol) ? " " : "") + digits;
}
const fromText = t => t.from_price != null ? `Tailoring from ${money(t.from_price, t.currency_code)}` : "";

// ---- Small helpers ----

const flagOf = code => String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1));
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const slugify = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, "") + "…" : s; };
const json = obj => JSON.stringify(obj).replace(/</g, "\\u003c");
const ratingText = t => t.review_count > 0 && t.rating ? `${Number(t.rating).toFixed(1)}★ (${t.review_count} review${t.review_count === 1 ? "" : "s"})` : "New on NebedaHub";
const areaText = t => [t.city || t.location, t.postcode_area].filter(Boolean).join(" · ");

function write(rel, html) {
  const file = path.join(APP_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

// ---- The page shell (the NebedaHub look) ----

function page({ rel, title, description, heading, intro, body, jsonLd, image, live }) {
  const depth = rel.split("/").length - 1;                 // tailors/uk/london/index.html → 3
  const up = "../".repeat(depth);
  const url = `${APP_URL}/${rel.replace(/index\.html$/, "")}`;
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta name="theme-color" content="#0c1220">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="NebedaHub">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image || APP_URL + "/icons/icon-512.png")}">
  <meta name="twitter:card" content="summary">
  <link rel="manifest" href="${up}manifest.webmanifest">
  <link rel="icon" href="${up}icons/icon-192.png" type="image/png">
  <link rel="apple-touch-icon" href="${up}icons/apple-touch-icon.png">
  <link rel="stylesheet" href="${up}tailors/seo.css">
  <script type="application/ld+json">${json(jsonLd)}</script>
</head>
<body>
  <header class="bar"><a class="brand" href="${up}index.html#/home">NebedaHub</a>
    <a class="bar-link" href="${up}index.html#/tailors">📍 Find tailors near me</a></header>
  <main>
    <nav class="crumbs" aria-label="Breadcrumb">${breadcrumbs(rel, up)}</nav>
    <h1>${esc(heading)}</h1>
    ${intro ? `<p class="intro">${intro}</p>` : ""}
    ${body}
  </main>
  <footer>NebedaHub — Everything Fashion, All in One Place. <a href="${up}index.html#/joinTailor">Are you a tailor? Join NebedaHub</a> ·
    <a href="${up}tailors/">All countries</a></footer>
  ${live ? `<script src="${up}js/config.js"></script>
  <script>window.WEARVIA_PAGE = ${json(Object.assign({ app: up + "index.html", root: up }, live))};</script>
  <script src="${up}tailors/seo.js" defer></script>` : ""}
</body>
</html>
`;
}

function breadcrumbs(rel, up) {
  const parts = rel.split("/").slice(0, -1);
  const links = [`<a href="${up}tailors/">Tailors</a>`];
  if (parts[0] === "tailors" && parts[1]) links.push(`<a href="${up}tailors/${parts[1]}/">${esc(breadcrumbName[parts[1]] || parts[1])}</a>`);
  if (parts[0] === "tailors" && parts[2]) links.push(`<span>${esc(breadcrumbName[parts[1] + "/" + parts[2]] || parts[2])}</span>`);
  if (parts[0] === "tailor") links.push(`<span>${esc(breadcrumbName["tailor/" + parts[1]] || parts[1])}</span>`);
  return links.join(" › ");
}
const breadcrumbName = {};

function tailorCard(t, up) {
  return `<li class="card"><a href="${up}tailor/${esc(t.slug)}/">
    ${t.profile_image_url ? `<img src="${esc(t.profile_image_url)}" alt="" loading="lazy" width="56" height="56">` : `<span class="initials" aria-hidden="true">${esc(initials(t.business_name))}</span>`}
    <span class="card-text"><b>${esc(t.business_name)}</b>
      <span>${esc(areaText(t))}</span>
      <span>${esc((t.speciality_tags || []).join(", ") || "Tailoring")}</span>
      <span class="gold">${esc(ratingText(t))}${t.delivery_available ? " · Delivers" : ""}${t.custom_orders ? " · Custom orders" : ""}</span></span></a></li>`;
}
const initials = name => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");

function localBusiness(t, country) {
  const url = `${APP_URL}/tailor/${t.slug}/`;
  const data = {
    "@type": ["LocalBusiness", "ClothingStore"], "@id": url, name: t.business_name, url,
    description: cut(t.description || `${t.business_name}, a tailor on NebedaHub.`, 300),
    address: Object.assign({ "@type": "PostalAddress", addressCountry: t.country_code || undefined, addressLocality: t.city || undefined },
      t.postcode_area ? { postalCode: t.postcode_area } : {}),
    areaServed: t.city ? { "@type": "City", name: t.city } : undefined,
    knowsAbout: (t.speciality_tags || []).length ? t.speciality_tags : undefined
  };
  if (t.profile_image_url) data.image = t.profile_image_url;
  // Prices in the tailor's own currency
  data.currenciesAccepted = t.currency_code || "GBP";
  if (t.from_price != null) data.priceRange = `From ${money(t.from_price, t.currency_code)}`;
  // No street address or exact position: customers get those in the app once their deposit is confirmed
  if (t.review_count > 0 && t.rating) data.aggregateRating = { "@type": "AggregateRating", ratingValue: Number(t.rating).toFixed(1), reviewCount: t.review_count, bestRating: 5, worstRating: 1 };
  return JSON.parse(JSON.stringify(data));
}

function itemList(name, url, items) {
  return { "@context": "https://schema.org", "@type": "ItemList", name, url, numberOfItems: items.length,
    itemListElement: items.map((item, i) => Object.assign({ "@type": "ListItem", position: i + 1 }, item)) };
}

// ---- Build ----

const { countries, tailors } = await loadData().catch(error => {
  console.error("Couldn't read tailors from Supabase:", error.message);
  console.error("Nothing was changed. (Set OFFLINE=1 to build only the standard pages.)");
  process.exit(1);
});
const byCode = new Map(countries.map(c => [c.code, Object.assign({}, c, { flag: c.flag || flagOf(c.code) })]));
const urls = [];

// Group approved tailors by country and city
const places = new Map();   // "GB" → Map("london" → { name, tailors })
const place = (code, city) => {
  if (!byCode.has(code)) return null;
  if (!places.has(code)) places.set(code, new Map());
  const key = slugify(city);
  if (!key) return null;
  if (!places.get(code).has(key)) places.get(code).set(key, { name: city.trim(), tailors: [] });
  return places.get(code).get(key);
};
FEATURED.forEach(([code, city]) => place(code, city));
tailors.forEach(t => { const p = t.country_code && t.city ? place(t.country_code, t.city) : null; if (p) p.tailors.push(t); });

// Remove old generated pages (only inside the two generated folders)
for (const dir of ["tailors", "tailor"]) {
  const full = path.join(APP_DIR, dir);
  if (!fs.existsSync(full)) continue;
  for (const entry of fs.readdirSync(full)) {
    if (["seo.js", "seo.css"].includes(entry)) continue;
    fs.rmSync(path.join(full, entry), { recursive: true, force: true });
  }
}

// One page per tailor
for (const t of tailors) {
  if (!t.slug) continue;
  const country = byCode.get(t.country_code);
  const rel = `tailor/${t.slug}/index.html`;
  breadcrumbName["tailor/" + t.slug] = t.business_name;
  const where = [t.city, country && country.name].filter(Boolean).join(", ");
  const specs = (t.speciality_tags || []).join(", ");
  const citySlug = t.city ? `${country ? country.slug : ""}/${slugify(t.city)}` : "";
  const body = `
    <section class="tailor">
      ${t.profile_image_url ? `<img class="logo" src="${esc(t.profile_image_url)}" alt="${esc(t.business_name)} logo" width="96" height="96">` : `<span class="initials big" aria-hidden="true">${esc(initials(t.business_name))}</span>`}
      <div>
        <p class="gold rating" data-live="rating">${esc(ratingText(t))}</p>
        <p>${country ? country.flag + " " : ""}${esc(areaText(t))}</p>
        ${fromText(t) ? `<p class="price" data-live="price">${esc(fromText(t))} <small>(${esc(t.currency_code)})</small></p>` : ""}
        <p class="badges">${t.delivery_available ? `<span>🚚 Delivery available</span>` : ""}${t.custom_orders ? `<span>✂️ Custom orders</span>` : ""}</p>
      </div>
    </section>
    <p class="actions"><a class="cta" href="../../index.html#/tailor/${esc(t.slug)}">Request a quote</a>
      <a class="ghost" href="../../index.html#/tailors">Find other tailors near me</a></p>
    ${t.description ? `<h2>About ${esc(t.business_name)}</h2><p class="about">${esc(t.description)}</p>` : ""}
    ${specs ? `<h2>Specialities</h2><p class="tags">${(t.speciality_tags || []).map(s => `<span>${esc(s)}</span>`).join("")}</p>` : ""}
    <div id="live-portfolio"></div>
    <div id="live-reviews"></div>
    ${citySlug ? `<p><a href="../../tailors/${esc(citySlug)}/">More tailors in ${esc(t.city)}</a></p>` : ""}`;
  write(rel, page({
    rel, image: t.profile_image_url,
    title: `${t.business_name} — tailor in ${where || "your area"} | NebedaHub`,
    description: cut(`${t.business_name}: ${specs ? specs + ". " : ""}${fromText(t) ? fromText(t) + ". " : ""}${t.description || "Bespoke tailoring"}${where ? " in " + where : ""}. ${ratingText(t)}. Request a quote on NebedaHub.`, 158),
    heading: t.business_name, intro: specs ? `Tailor in ${esc(where)} · ${esc(specs)}` : `Tailor in ${esc(where)}`,
    body, jsonLd: Object.assign({ "@context": "https://schema.org" }, localBusiness(t, country)),
    live: { kind: "tailor", slug: t.slug, currency: Object.assign({ code: t.currency_code }, CURRENCIES.get(t.currency_code) || {}) }
  }));
  urls.push({ loc: `${APP_URL}/tailor/${t.slug}/`, lastmod: (t.updated_at || "").slice(0, 10) });
}

// One page per city, and per country
const countryCodes = Array.from(places.keys()).sort((a, b) => byCode.get(a).name.localeCompare(byCode.get(b).name));
for (const code of countryCodes) {
  const country = byCode.get(code);
  breadcrumbName[country.slug] = country.name;
  const cities = Array.from(places.get(code).entries()).sort((a, b) => b[1].tailors.length - a[1].tailors.length || a[1].name.localeCompare(b[1].name));
  const all = cities.flatMap(([, p]) => p.tailors);
  for (const [citySlug, p] of cities) {
    const rel = `tailors/${country.slug}/${citySlug}/index.html`;
    breadcrumbName[country.slug + "/" + citySlug] = p.name;
    const list = p.tailors.slice().sort((a, b) => (b.review_count > 0 ? b.rating : 0) - (a.review_count > 0 ? a.rating : 0) || a.business_name.localeCompare(b.business_name));
    const specs = Array.from(new Set(list.flatMap(t => t.speciality_tags || []))).slice(0, 6);
    const body = `
      <p class="actions"><a class="cta" href="../../../index.html#/tailors">📍 Tailors near my location</a></p>
      <h2 data-live="count">${list.length ? `${list.length} tailor${list.length === 1 ? "" : "s"} in ${esc(p.name)}` : `Tailors in ${esc(p.name)}`}</h2>
      <ul class="cards" id="live-list">${list.map(t => tailorCard(t, "../../../")).join("") || `<li class="empty">No tailors in ${esc(p.name)} have joined NebedaHub yet. <a href="../../../index.html#/joinTailor">Are you a tailor here? Join free.</a></li>`}</ul>
      <p><a href="../">All cities in ${esc(country.name)}</a></p>`;
    write(rel, page({
      rel,
      title: `Tailors in ${p.name}, ${country.name} — bespoke agbada, suits & dresses | NebedaHub`,
      description: cut(`Find tailors in ${p.name}${list.length ? ` — ${list.length} on NebedaHub` : ""}${specs.length ? ": " + specs.join(", ") : ""}. Compare ratings, see portfolios and request a quote online.`, 158),
      heading: `Tailors in ${p.name}`, intro: `${country.flag} ${esc(p.name)}, ${esc(country.name)} · tailors and designers on NebedaHub, with ratings and portfolios.`,
      body,
      jsonLd: itemList(`Tailors in ${p.name}`, `${APP_URL}/tailors/${country.slug}/${citySlug}/`,
        list.map(t => ({ url: `${APP_URL}/tailor/${t.slug}/`, item: localBusiness(t, country) }))),
      live: { kind: "city", country: code, city: p.name }
    }));
    urls.push({ loc: `${APP_URL}/tailors/${country.slug}/${citySlug}/` });
  }
  const rel = `tailors/${country.slug}/index.html`;
  const body = `
    <p class="actions"><a class="cta" href="../../index.html#/tailors">📍 Tailors near my location</a></p>
    <h2>Cities</h2>
    <ul class="places">${cities.map(([citySlug, p]) => `<li><a href="${citySlug}/">Tailors in ${esc(p.name)}</a> <span>${p.tailors.length}</span></li>`).join("")}</ul>
    ${all.length ? `<h2>Tailors in ${esc(country.name)}</h2><ul class="cards">${all.slice(0, 60).map(t => tailorCard(t, "../../")).join("")}</ul>` : ""}`;
  write(rel, page({
    rel,
    title: `Tailors in ${country.name} — find a tailor near you | NebedaHub`,
    description: cut(`Tailors and fashion designers in ${country.name} on NebedaHub${all.length ? ` (${all.length})` : ""}: ${cities.slice(0, 5).map(([, p]) => p.name).join(", ")}. Request a quote online.`, 158),
    heading: `Tailors in ${country.name}`, intro: `${country.flag} Choose a city, or find tailors near your location.`,
    body, jsonLd: itemList(`Tailors in ${country.name}`, `${APP_URL}/tailors/${country.slug}/`,
      cities.map(([citySlug, p]) => ({ url: `${APP_URL}/tailors/${country.slug}/${citySlug}/`, name: `Tailors in ${p.name}` })))
  }));
  urls.push({ loc: `${APP_URL}/tailors/${country.slug}/` });
}

// All countries
write("tailors/index.html", page({
  rel: "tailors/index.html",
  title: "Find tailors near you — bespoke tailoring in the UK, Nigeria and worldwide | NebedaHub",
  description: `Find tailors and fashion designers near you on NebedaHub${tailors.length ? ` — ${tailors.length} tailors` : ""} in ${countryCodes.length} countries. Agbada, kaftan, suits, wedding outfits and more.`,
  heading: "Find tailors near you",
  intro: "Tailors and designers on NebedaHub, by country and city. Use your location in the app to see who's nearest.",
  body: `<p class="actions"><a class="cta" href="../index.html#/tailors">📍 Use my location</a></p>
    ${countryCodes.map(code => { const c = byCode.get(code); const cities = Array.from(places.get(code).entries());
      return `<h2><a href="${c.slug}/">${c.flag} Tailors in ${esc(c.name)}</a></h2>
        <ul class="places">${cities.map(([s, p]) => `<li><a href="${c.slug}/${s}/">${esc(p.name)}</a> <span>${p.tailors.length}</span></li>`).join("")}</ul>`; }).join("")}`,
  jsonLd: itemList("Tailors by country", `${APP_URL}/tailors/`, countryCodes.map(code => ({ url: `${APP_URL}/tailors/${byCode.get(code).slug}/`, name: `Tailors in ${byCode.get(code).name}` })))
}));
urls.unshift({ loc: `${APP_URL}/tailors/` });
urls.unshift({ loc: `${APP_URL}/` });

// Sitemap and robots.txt
const today = new Date().toISOString().slice(0, 10);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod || today}</lastmod></url>`).join("\n")}
</urlset>
`);
write("robots.txt", `# NebedaHub
User-agent: *
Allow: /
Sitemap: ${APP_URL}/sitemap.xml
`);
console.log(`Built ${tailors.length} tailor pages, ${countryCodes.length} country pages and ${Array.from(places.values()).reduce((n, m) => n + m.size, 0)} city pages for ${APP_URL}${OFFLINE ? " (offline: standard pages only)" : ""}.`);
