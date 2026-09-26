// ============================================================
// tailors-data.js — many tailors (designers) on NebedaHub
//
//   • Lookups: which tailor an order, a draft or the Business dashboard is for
//   • Scoping: the Business dashboard only ever shows the tailor it's open
//     for — their orders, customers, payments, team, prices. (In live mode
//     the database already only sends a tailor their own data; the admin
//     gets everything, so the same filter keeps each dashboard separate.)
//   • Each tailor's own price list
//   • DEMO MODE ONLY: sample tailors in London, Manchester, Lagos and Abuja,
//     clearly labelled "(demo)", and the same distance search the database
//     does (wearvia_search_tailors in supabase/tailors-near-me.sql)
//
// A tailor record: { id, business_name, slug, location, country_code, city,
//   postcode, address_line, show_exact_address, latitude, longitude,
//   public_latitude, public_longitude, postcode_area, public_address,
//   speciality_tags, delivery_available, custom_orders, rating, review_count,
//   profile_image, description, delivery_time, admin_status, admin_note,
//   portfolio: [{ id, image, title }], demo }
// ============================================================

const TAILOR_STATUS_LABELS = { pending: "Waiting for approval", approved: "Approved", hidden: "Hidden" };

// ---- Lookups ----

function designerById(id) {
  if (!id || !db) return null;
  return db.designers.find(d => d.id === id) || (typeof tailorCache !== "undefined" && tailorCache.get(id)) || null;
}

// Nebeda Threads: designer number one, and where orders go when no tailor was chosen
function mainDesigner() {
  if (!db) return null;
  const id = db.main_designer_id;
  return (id && db.designers.find(d => d.id === id))
    || db.designers.find(d => /^nebeda/i.test(d.business_name || "")) || db.designers[0] || null;
}

function designerName(id) {
  const d = designerById(id) || (id ? null : mainDesigner());
  return d ? d.business_name : "your tailor";
}

// The tailors the signed-in person can open a Business dashboard for
function managedDesigners() {
  if (!db) return [];
  if (!Cloud.live) return db.designers.slice();            // the demo shows every tailor's dashboard
  const me = Cloud.me || {};
  const mine = (me.designers || []).map(x => designerById(x.id)).filter(Boolean);
  if (!mine.length && me.is_admin && mainDesigner()) mine.push(mainDesigner());
  return mine;
}

function bizDesignerId() {
  const ids = managedDesigners().map(d => d.id);
  const chosen = db && db.session ? db.session.designerId : null;
  if (chosen && ids.includes(chosen)) return chosen;
  const main = mainDesigner();
  return ids.includes(main && main.id) ? main.id : ids[0] || (main && main.id) || null;
}

function bizDesigner() {
  return designerById(bizDesignerId()) || mainDesigner();
}

function switchBizDesigner(id) {
  db.session.designerId = id;
  if (!Cloud.live) saveData();
  go("biz/dashboard");
}

function inBusiness() {
  return typeof currentRoute === "function" && currentRoute().area === "business";
}

// The admin approves tailors and runs the fabric marketplace. In the demo, you're the admin.
function isAdminUser() {
  return !Cloud.live || !!(Cloud.me && Cloud.me.is_admin);
}

// The owner (or the admin) edits a tailor's profile; their staff can only look
function ownsBizDesigner() {
  if (!Cloud.live) return true;
  const me = Cloud.me || {};
  if (me.is_admin) return true;
  const row = (me.designers || []).find(x => x.id === bizDesignerId());
  return !!(row && row.is_owner);
}

// The tailor a customer is ordering from right now (the draft), or Nebeda Threads
function draftDesignerId() {
  const d = db && db.draft && db.draft.designerId && designerById(db.draft.designerId);
  const main = mainDesigner();
  return d ? d.id : main ? main.id : null;
}

function draftDesigner() {
  return designerById(draftDesignerId()) || mainDesigner();
}

// Whose price list the screen uses: the dashboard's tailor, or the one the customer is ordering from
function contextDesignerId() {
  return inBusiness() ? bizDesignerId() : draftDesignerId();
}

// The designer the screen is about: the dashboard's, or the one the customer is ordering from
function designer() {
  return (inBusiness() ? bizDesigner() : draftDesigner()) || { id: null, business_name: SHOP_NAME, location: "", speciality_tags: [], delivery_time: "7–14 days", rating: 5, review_count: 0 };
}

// ---- Scoping the Business dashboard to one tailor ----

function orderInScope(order) {
  return !inBusiness() || order.designer_id === bizDesignerId();
}

function scopedOrders() {
  return db.orders.filter(orderInScope);
}

function bizOrderIdSet() {
  return new Set(scopedOrders().map(o => o.id));
}

function bizPayments() {
  const ids = bizOrderIdSet();
  return db.payments.filter(p => ids.has(p.order_id));
}

function bizInvoices() {
  const ids = bizOrderIdSet();
  return db.invoices.filter(i => ids.has(i.order_id));
}

function bizDeliveries() {
  const ids = bizOrderIdSet();
  return db.deliveries.filter(d => ids.has(d.order_id));
}

// The tailor's customers: anyone who ordered from them, or a walk-in customer they added
function bizCustomers() {
  if (!inBusiness()) return db.customers;
  const id = bizDesignerId();
  const ordered = new Set(scopedOrders().map(o => o.customer_id));
  return db.customers.filter(c => ordered.has(c.id) || c.added_by_designer_id === id);
}

const inBizDesigner = row => (row.designer_id || (mainDesigner() || {}).id) === bizDesignerId();
function bizStaff() { return db.staff.filter(inBizDesigner); }
function bizWeddings() { return db.wedding_orders.filter(inBizDesigner); }
function bizRtw() { return db.ready_to_wear.filter(inBizDesigner); }
function bizRtwSales() {
  const items = new Set(bizRtw().map(i => i.id));
  return db.rtw_sales.filter(s => items.has(s.item_id));
}

// Ready-to-wear on a tailor's page (the customer app)
function rtwOf(designerId) {
  const main = (mainDesigner() || {}).id;
  return db.ready_to_wear.filter(i => (i.designer_id || main) === designerId);
}

// ---- Each tailor's own price list ----

function pricesOf(designerId) {
  return (db.prices || []).filter(p => p.designer_id === designerId);
}

function bizPrices() {
  return pricesOf(bizDesignerId());
}

// Makes the quote maths (OUTFITS, EMBROIDERY, DELIVERY_FEE) use this tailor's prices
function usePricesOf(designerId) {
  DEFAULT_PRICES.forEach(p => {
    if (p.kind === "outfit") { const o = OUTFITS.find(x => x.name === p.name); if (o) { o.tailoring = p.price; o.yards = p.yards; } }
    else if (p.kind === "embroidery") { const e = EMBROIDERY.find(x => x.name === p.name); if (e) e.price = p.price; }
    else DELIVERY_FEE = p.price;
  });
  applyPriceList(pricesOf(designerId));
}

// A starting price list for a new tailor
function newPriceListFor(designerId, prefix) {
  return defaultPriceList().map((p, i) => Object.assign(p, { id: `${prefix || "PL"}-${designerId}-${i + 1}`, designer_id: designerId }));
}

// ---- Each tailor's own notes about a customer ----

function customerNotes(customerId, designerId) {
  const row = (db.customer_notes || []).find(n => n.customer_id === customerId && n.designer_id === (designerId || bizDesignerId()));
  return row ? row.notes : "";
}

function setCustomerNotes(customerId, notes, designerId) {
  if (!db.customer_notes) db.customer_notes = [];
  const key = designerId || bizDesignerId();
  let row = db.customer_notes.find(n => n.customer_id === customerId && n.designer_id === key);
  if (!row) { row = { designer_id: key, customer_id: customerId, notes: "" }; db.customer_notes.push(row); }
  row.notes = notes;
  if (Cloud.live) Cloud.saveCustomerNotes(key, customerId, notes).catch(error => toast(error.message));
}

// ---- Public position: the same rules the database uses ----
// Every tailor is shown about 1 km away from their address (rounded to 2
// decimal places), with only the postcode district (e.g. "SE15"). The full
// address is only shared with a customer once their deposit is confirmed.
// Public texts go through the contact-details filter (no-leakage.js).

function refreshDesignerPublic(d) {
  const hasSpot = d.latitude != null && d.longitude != null && d.latitude !== "" && d.longitude !== "";
  const round2 = x => Math.round(Number(x) * 100) / 100;
  d.show_exact_address = false;
  d.public_latitude = !hasSpot ? null : round2(d.latitude);
  d.public_longitude = !hasSpot ? null : round2(d.longitude);
  const pc = (d.postcode || "").trim().toUpperCase().replace(/\s+/g, " ");
  d.postcode_area = !pc ? null : d.country_code === "GB" ? pc.replace(/\s*[0-9][A-Z]{2}$/, "").trim() || null : null;
  d.public_address = null;
  ["business_name", "description", "city", "location"].forEach(k => { if (d[k]) d[k] = hideContactDetails(d[k]).text; });
  d.speciality_tags = (d.speciality_tags || []).filter(t => !hideContactDetails(t).hidden);
  (d.portfolio || []).forEach(p => { if (p.title) p.title = hideContactDetails(p.title).text; });
  if (!d.location && d.city) {
    const country = countryByCode(d.country_code);
    d.location = d.city + (country ? ", " + country.name : "");
  }
  if (!d.slug) d.slug = uniqueSlug(d.business_name, d.id);
  return d;
}

function slugify(text) {
  return String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "tailor";
}

function uniqueSlug(name, id) {
  const base = slugify(name);
  let slug = base;
  let n = 1;
  while (db.designers.some(d => d.slug === slug && d.id !== id)) slug = `${base}-${++n}`;
  return slug;
}

// What a tailor's area looks like to customers: "Peckham, London · SE15"
function tailorAreaText(d) {
  return [d.city || d.location, d.postcode_area].filter(Boolean).join(" · ") || d.location || "";
}

function tailorRatingText(d) {
  return d.review_count > 0 && d.rating ? `⭐ ${Number(d.rating).toFixed(1)} (${d.review_count} review${d.review_count === 1 ? "" : "s"})` : "New on NebedaHub";
}

// ---- Countries and specialities (from the database in live mode) ----

function countryList() {
  return (db && db.countries && db.countries.length ? db.countries : DEMO_COUNTRIES)
    .slice().sort((a, b) => (a.sort_order || 100) - (b.sort_order || 100) || a.name.localeCompare(b.name));
}

function countryByCode(code) {
  return code ? countryList().find(c => c.code === code) || null : null;
}

function countryBySlug(slug) {
  return countryList().find(c => c.slug === slug) || null;
}

function specialityList() {
  return (db && db.specialities && db.specialities.length ? db.specialities : DEMO_SPECIALITIES)
    .filter(s => s.active !== false).slice().sort((a, b) => (a.sort_order || 100) - (b.sort_order || 100) || a.name.localeCompare(b.name));
}

function countryOptions(selected, blankLabel) {
  return (blankLabel ? `<option value="">${escapeHtml(blankLabel)}</option>` : "")
    + countryList().map(c => `<option value="${c.code}" ${c.code === selected ? "selected" : ""}>${c.flag} ${escapeHtml(c.name)}</option>`).join("");
}

// ---- Demo mode: the same search the database does ----

function demoSearchTailors(p) {
  const r = p.lat != null && p.lng != null ? Math.min(Math.max(p.radiusKm || 40.2336, 0.5), 500) : null;
  const area = (p.area || "").replace(/\s/g, "").toUpperCase();
  let rows = db.designers.filter(d => d.admin_status === "approved").map(d => {
    const dist = r != null && d.public_latitude != null ? Geo.distanceKm(p.lat, p.lng, d.public_latitude, d.public_longitude) : null;
    return Object.assign({}, d, { distance_km: dist == null ? null : Math.round(dist * 100) / 100 });
  }).filter(d =>
    (r == null || (d.distance_km != null && d.distance_km <= r))
    && (!p.country || d.country_code === p.country)
    && (!p.city || (d.city || "").toLowerCase() === p.city.trim().toLowerCase())
    && (!area || (d.postcode_area || "").replace(/\s/g, "").toUpperCase().startsWith(area)
        || (d.city || "").toUpperCase() === area || (d.location || "").replace(/\s/g, "").toUpperCase().includes(area))
    && (!p.specialities || !p.specialities.length || p.specialities.some(s => (d.speciality_tags || []).includes(s)))
    && (!p.delivery || d.delivery_available)
    && (!p.custom || d.custom_orders)
    && (!p.minRating || (d.review_count > 0 && d.rating >= p.minRating)));
  const rating = d => d.review_count > 0 ? d.rating : -1;
  rows.sort((a, b) => p.sort === "rating"
    ? rating(b) - rating(a) || b.review_count - a.review_count || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9)
    : (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || rating(b) - rating(a) || a.business_name.localeCompare(b.business_name));
  const total = rows.length;
  rows = rows.slice(p.offset || 0, (p.offset || 0) + (p.limit || 20));
  return { rows, total };
}

// ---- Demo mode: sample tailors ----
// These exist ONLY in the demo (this browser). They are never sent to Supabase.

const DEMO_TAILORS = [
  { id: "D2", business_name: "Peckham Suit Studio (demo)", country_code: "GB", city: "London", postcode: "SE15 4QN", address_line: "Unit 4, 20 Rye Lane",
    latitude: 51.4700, longitude: -0.0693, show_exact_address: false, speciality_tags: ["Suits", "Wedding outfits", "Alterations"],
    delivery_available: true, custom_orders: true, rating: 4.8, review_count: 23, pattern: ["plain", ["#1e2a44", "#c9a24a", "#efe6d2"]],
    description: "Sharp suits and wedding outfits, cut and sewn in our Peckham studio. Fittings by appointment." },
  { id: "D3", business_name: "Brixton Agbada House (demo)", country_code: "GB", city: "London", postcode: "SW9 8LF", address_line: "31 Atlantic Road",
    latitude: 51.4613, longitude: -0.1156, show_exact_address: true, speciality_tags: ["Agbada", "Kaftan", "Senator"],
    delivery_available: true, custom_orders: true, rating: 4.6, review_count: 41, pattern: ["aso_oke", ["#7c1f2e", "#c9a227", "#1b1b1b"]],
    description: "Agbada, kaftan and senator for weddings, naming ceremonies and Sunday best. Walk in or order online." },
  { id: "D4", business_name: "Northern Threads Manchester (demo)", country_code: "GB", city: "Manchester", postcode: "M4 1HQ", address_line: "8 Oldham Street",
    latitude: 53.4839, longitude: -2.2343, show_exact_address: false, speciality_tags: ["Suits", "Women's dresses", "Custom design"],
    delivery_available: true, custom_orders: true, rating: 4.9, review_count: 12, pattern: ["linen", ["#2d4f3a", "#efe6d2", "#1e2a44"]],
    description: "Tailored suits and dresses made in Manchester's Northern Quarter." },
  { id: "D5", business_name: "Lekki Couture (demo)", country_code: "NG", city: "Lagos", postcode: "105102", address_line: "Admiralty Way",
    latitude: 6.4474, longitude: 3.4722, show_exact_address: false, speciality_tags: ["Aso Ebi", "Wedding outfits", "Women's dresses"],
    delivery_available: true, custom_orders: true, rating: 4.7, review_count: 58, pattern: ["lace", ["#c9a24a", "#efe6d2", "#7c1f2e"]],
    description: "Aso ebi and bridal couture in Lekki. Group orders for weddings are our speciality." },
  { id: "D6", business_name: "Ikeja Tailoring Hub (demo)", country_code: "NG", city: "Lagos", postcode: "100271", address_line: "Allen Avenue",
    latitude: 6.6018, longitude: 3.3515, show_exact_address: false, speciality_tags: ["Agbada", "Senator", "Kaftan"],
    delivery_available: false, custom_orders: true, rating: 4.3, review_count: 19, pattern: ["ankara", ["#e8871e", "#1e3a5f", "#c9a24a"]],
    description: "Everyday senator and kaftan, and agbada for big days. Quick turnaround in Ikeja." },
  { id: "D7", business_name: "Wuse Fashion House (demo)", country_code: "NG", city: "Abuja", postcode: "904101", address_line: "Aminu Kano Crescent",
    latitude: 9.0765, longitude: 7.4760, show_exact_address: false, speciality_tags: ["Kaftan", "Agbada", "Custom design"],
    delivery_available: true, custom_orders: true, rating: 4.5, review_count: 9, pattern: ["brocade", ["#1e2a44", "#c9a24a", "#f4f1ea"]],
    description: "Custom kaftans and agbada in Wuse 2, Abuja." },
  { id: "D8", business_name: "Garki Alterations (demo)", country_code: "NG", city: "Abuja", postcode: "900103", address_line: "Area 11",
    latitude: 9.0400, longitude: 7.4890, show_exact_address: false, speciality_tags: ["Alterations", "Ready to wear"],
    delivery_available: false, custom_orders: false, rating: null, review_count: 0, pattern: ["plain", ["#20304a", "#efe6d2", "#8a6d1f"]],
    description: "Alterations and repairs while you wait. Ready-to-wear pieces in store." },
  { id: "D9", business_name: "Camden Bespoke (demo, waiting for approval)", country_code: "GB", city: "London", postcode: "NW1 8AH", address_line: "Camden Lock",
    latitude: 51.5410, longitude: -0.1460, show_exact_address: false, speciality_tags: ["Custom design", "Women's dresses"], admin_status: "pending",
    delivery_available: true, custom_orders: true, rating: null, review_count: 0, pattern: ["adire", ["#1e3a5f", "#efe6d2", "#1b1b1b"]],
    description: "A new tailor waiting for the admin to approve them — try approving it in Business → Tailors." }
];

const DEMO_REVIEW_TEXTS = [
  ["Beautiful work and a perfect fit.", "Adaeze"], ["Ready a week early and the embroidery is stunning.", "Tunde"],
  ["They listened to exactly what I wanted.", "Grace"], ["Great fabric advice and fair prices.", "Ifeanyi"], ["Would order again.", "Tosin"]
];

function demoTailor(t) {
  const d = Object.assign({
    location: "", profile_image: `logo:${initialsOf(t.business_name.replace(/\(.*\)/, ""))}:${hexNoHash(t.pattern[1][0])}`,
    delivery_time: "7–14 days", starting_price: null, commission_rate: 0, admin_status: "approved", admin_note: "", demo: true,
    tailor_terms_accepted_at: "2026-09-01T09:00:00Z",
    portfolio: samplePhotos(t.pattern[0], t.pattern[1], 3).map((image, i) => ({ id: `${t.id}-P${i + 1}`, image, title: ["Made to measure", "Detail", "Finished look"][i] })),
    sample_reviews: t.review_count ? DEMO_REVIEW_TEXTS.slice(0, Math.min(3, t.review_count)).map(([text, who], i) => ({ rating: Math.max(3, Math.round(t.rating) - (i === 2 ? 1 : 0)), text, who })) : []
  }, t);
  delete d.pattern;
  return d;
}

// Nebeda Threads gets a profile; the demo tailors, their price lists and a request each are added
function addDemoTailors(data) {
  const main = data.designers[0];
  Object.assign(main, {
    slug: main.slug || "nebeda-threads", country_code: "GB", city: "Gillingham", postcode: main.postcode || "ME7 1AA",
    address_line: main.address_line || "", latitude: 51.3887, longitude: 0.5485, show_exact_address: false,
    speciality_tags: ["Agbada", "Wedding outfits", "Custom design"], delivery_available: true, custom_orders: true,
    admin_status: "approved", admin_note: "", profile_image: main.profile_image || "logo:NT:1e2a44",
    description: main.description || "Bespoke agbada, wedding outfits and custom designs from Gillingham, Kent. The first shop on NebedaHub.",
    portfolio: main.portfolio || samplePhotos("aso_oke", ["#c9a227", "#7c1f2e", "#efe6d2"], 3).map((image, i) => ({ id: `D1-P${i + 1}`, image, title: ["Wedding agbada", "Gold embroidery", "Aso oke"][i] }))
  });
  data.main_designer_id = main.id;
  const previous = db;
  db = data;                               // uniqueSlug and countryByCode read db
  refreshDesignerPublic(main);
  DEMO_TAILORS.forEach(t => {
    if (data.designers.some(d => d.id === t.id)) return;
    const d = refreshDesignerPublic(demoTailor(t));
    data.designers.push(d);
    data.prices = data.prices.concat(newPriceListFor(d.id));
  });
  db = previous;
  data.demo_tailors_added = true;
}
