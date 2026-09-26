// ============================================================
// data.js — settings, the order lifecycle, sample data,
// saving/loading, and helper functions used everywhere
// ============================================================

// ---- Settings you can change ----
const APP_NAME = "NebedaHub";        // the platform name shown in the app
const APP_TAGLINE = "Everything Fashion, All in One Place.";  // shown under the name (home, sign-in, tailor pages)
const SHOP_NAME = "Nebeda Threads";  // the first shop (designer number one) on NebedaHub; every tailor has their own name
const CURRENCY = "£";
const STORAGE_KEY = "wearvia-app-v2";
const DEPOSIT_RATE = 0.6;            // 60% deposit, balance after quality control
let DELIVERY_FEE = 15;               // starting price; the real one is in the price list (below)
const LOW_STOCK_YARDS = 10;          // "low stock" warning below this many yards
const YARDS_PER_METRE = 1.0936;      // only used to convert data saved before NebedaHub switched to yards
const METRES_PER_YARD = 0.9144;

// ---- The confirmed order lifecycle (WEARVIA-SPEC.md, section 2) ----
// Keep this sequence exactly. The yards of fabric can't be worked out from
// the outfit or measurements alone, so the customer sends their order to the
// tailor (step 4), the tailor agrees the yards with them in the order's chat
// and sends a quote (step 5), and only when the customer accepts it is the
// fabric bought (step 6).
const LIFECYCLE = [
  "Outfit & design chosen",       // 1
  "AI design concept approved",   // 2
  "Measurements saved",           // 3
  "Fabric selected",              // 4  → "Send to tailor"
  "Tailor's quote",               // 5  the tailor decides the yards
  "Quote accepted · fabric bought", // 6
  "Deposit paid",                 // 7
  "Tailor assigned",              // 8
  "Cutting",                      // 9
  "Sewing",                       // 10
  "Embroidery",                   // 11
  "Fitting",                      // 12
  "Quality control",              // 13
  "Balance paid",                 // 14
  "Delivery",                     // 15
  "Review"                        // 16
];

// Production stages (steps 8–15). An order's "stage" is the LAST step it has completed.
// Every order starts at "tailor_assigned" once the deposit is paid.
const STAGES = [
  { key: "tailor_assigned", label: "Tailor assigned", done: "Tailor assigned" },
  { key: "cutting",         label: "Cutting",         done: "Cut",           role: "cutting" },
  { key: "sewing",          label: "Sewing",          done: "Sewn",          role: "sewing" },
  { key: "embroidery",      label: "Embroidery",      done: "Embroidered",   role: "embroidery" },
  { key: "fitting",         label: "Fitting",         done: "Fitted",        role: "finishing" },
  { key: "quality_control", label: "Quality control", done: "QC passed",     role: "quality_control" },
  { key: "balance_paid",    label: "Balance paid",    done: "Balance paid" },
  { key: "delivered",       label: "Delivery",        done: "Delivered" }
];
const FIRST_STEP_OF_STAGES = 7; // LIFECYCLE index of "Tailor assigned"

const STAFF_ROLES = [
  { key: "cutting", label: "Cutting" },
  { key: "sewing", label: "Sewing" },
  { key: "embroidery", label: "Embroidery" },
  { key: "finishing", label: "Finishing" },
  { key: "quality_control", label: "Quality control" }
];

// ---- Outfit options (screens 2 and 3) ----
// tailoring = our making price in £; yards = typical fabric needed for one adult
// (45–60 inch wide fabric, as sold by the yard)
const OUTFITS = [
  { name: "Agbada",    tailoring: 280, yards: 10 },   // robe, buba and sokoto
  { name: "Kaftan",    tailoring: 150, yards: 4.5 },  // kaftan and trousers
  { name: "Senator",   tailoring: 170, yards: 4 },    // top and trousers
  { name: "Bubu",      tailoring: 140, yards: 5 },
  { name: "Two Piece", tailoring: 180, yards: 4 },
  { name: "Dress",     tailoring: 160, yards: 3 },
  { name: "Wedding",   tailoring: 450, yards: 10 },
  { name: "Suit",      tailoring: 350, yards: 3.5 },
  { name: "Aso Ebi",   tailoring: 160, yards: 5 },    // iro and buba, or a gown
  { name: "Custom",    tailoring: 200, yards: 5 }
];
const COLOURS = [
  { hex: "#1e2a44", name: "Navy" },
  { hex: "#c9a24a", name: "Gold" },
  { hex: "#7c1f2e", name: "Burgundy" },
  { hex: "#2d4f3a", name: "Forest green" },
  { hex: "#efe6d2", name: "Ivory" },
  { hex: "#1b1b1b", name: "Black" }
];
const EMBROIDERY = [
  { name: "Gold", price: 60 },
  { name: "Silver", price: 50 },
  { name: "None", price: 0 }
];

// ---- The price list ----
// The prices above are only the starting prices. The real ones are kept in
// db.prices and changed in Business → Prices. In live mode that's the
// database's price_list table — the database charges those prices itself,
// so the quote a customer sees must come from there too.
const DEFAULT_PRICES = OUTFITS.map((o, i) => ({ id: "PL" + (i + 1), kind: "outfit", name: o.name, price: o.tailoring, yards: o.yards }))
  .concat(EMBROIDERY.map((e, i) => ({ id: "PL" + (OUTFITS.length + i + 1), kind: "embroidery", name: e.name, price: e.price, yards: null })))
  .concat([{ id: "PL" + (OUTFITS.length + EMBROIDERY.length + 1), kind: "delivery", name: "Delivery", price: DELIVERY_FEE, yards: null }]);

function defaultPriceList() {
  return DEFAULT_PRICES.map(p => Object.assign({}, p));
}

// Copies the price list into OUTFITS, EMBROIDERY and DELIVERY_FEE, which every screen reads
function applyPriceList(rows) {
  (rows || []).forEach(row => {
    if (row.kind === "outfit") {
      const outfit = OUTFITS.find(o => o.name === row.name);
      if (outfit) { outfit.tailoring = row.price; if (row.yards > 0) outfit.yards = row.yards; }
    } else if (row.kind === "embroidery") {
      const embroidery = EMBROIDERY.find(e => e.name === row.name);
      if (embroidery) embroidery.price = row.price;
    } else if (row.kind === "delivery") {
      DELIVERY_FEE = row.price;
    }
  });
}

const SLEEVES = ["Wide", "Fitted"];
const NECKS = ["Round", "V-neck"];
const PAYMENT_METHODS = ["Card", "Apple Pay", "Bank transfer", "Cash"];
// A customer's order starts as a request for a quote (see sendQuote and acceptQuote below)
const QUOTE_STATUS_LABELS = { requested: "Waiting for tailor's quote", quoted: "Quote sent", accepted: "Accepted" };
// Checkout is a demo: payments made in the customer app wait until the
// Nebeda Threads team confirms them (Business → Payments)
const PAYMENT_STATUS_LABELS = { awaiting_confirmation: "Awaiting confirmation", confirmed: "Confirmed", rejected: "Rejected" };
const DELIVERY_STATUSES = ["Order ready", "Picked up", "In transit", "Out for delivery", "Delivered"];

// Measurements are in inches. The first six are the ones the spec requires.
const MEASUREMENT_FIELDS = [
  { key: "chest", label: "Chest / Bust", required: true },
  { key: "waist", label: "Waist", required: true },
  { key: "shoulder", label: "Shoulder", required: true },
  { key: "sleeve", label: "Sleeve", required: true },
  { key: "trouser_length", label: "Trouser length", required: true },
  { key: "neck", label: "Neck", required: true },
  { key: "hips", label: "Hips" },
  { key: "length", label: "Top / dress length" }
];

// ---- Small helper functions used by every section ----

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days, from) {
  const d = from ? new Date(from + "T12:00:00") : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function thisYear() {
  return String(new Date().getFullYear());
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function money(amount) {
  const value = Math.round(Number(amount || 0) * 100) / 100;
  const hasPence = Math.abs(value % 1) > 0.001;
  return CURRENCY + value.toLocaleString("en-GB", { minimumFractionDigits: hasPence ? 2 : 0, maximumFractionDigits: 2 });
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Makes text safe to put inside HTML (stops names like "<b>" breaking the page)
function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function colourName(hex) {
  const found = COLOURS.find(c => c.hex === hex);
  return found ? found.name : hex;
}

function findOutfit(name) {
  return OUTFITS.find(o => o.name === name) || OUTFITS[OUTFITS.length - 1];
}

function embroideryPrice(name) {
  const found = EMBROIDERY.find(e => e.name === name);
  return found ? found.price : 0;
}

// Yards × price per yard, rounded to the penny the same way the database does
// (worked out in whole pence so 4.5 yd × £41.15 is £185.18, not £185.17)
function fabricCostFor(yards, pricePerYard) {
  return Math.round(Math.round(yards * 100) * Math.round(pricePerYard * 100) / 100) / 100;
}

// Itemised quotation: fabric, tailoring, embroidery, delivery → total (screen 8).
// ownPrices lets the team charge their own price on a walk-in order,
// e.g. { tailoring: 250 }; anything left out comes from the price list.
function computeQuote(outfit, embroidery, fabric, yards, ownPrices) {
  const own = ownPrices || {};
  const pick = (value, fallback) => value == null || value === "" || !(Number(value) >= 0) ? fallback : Number(value);
  const fabricCost = fabricCostFor(yards, fabric.price_per_yard);
  const lines = [
    { label: `Fabric — ${fabric.name} (${yards} yd × ${money(fabric.price_per_yard)})`, amount: fabricCost },
    { label: `Tailoring (${outfit})`, amount: pick(own.tailoring, findOutfit(outfit).tailoring) },
    { label: `Embroidery (${embroidery})`, amount: pick(own.embroidery, embroideryPrice(embroidery)) },
    { label: "Delivery", amount: pick(own.delivery, DELIVERY_FEE) }
  ];
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, total, fabricCost };
}

// What delivery cost on an order (its quote line; older orders use today's price)
function deliveryCostOf(order) {
  const line = (order.line_items || []).find(l => l.label === "Delivery");
  return line ? Number(line.amount) || 0 : DELIVERY_FEE;
}

function depositFor(total) {
  return Math.round(total * DEPOSIT_RATE);
}

function randomDigits(count) {
  let text = "";
  for (let i = 0; i < count; i++) text += Math.floor(Math.random() * 10);
  return text;
}

// A new id for a record. Demo data uses short ids ("C7", "F21");
// live data uses the same kind of id as the database (a uuid).
function newId(prefix, list, skip) {
  if (Cloud.live) return Cloud.newId();
  const highest = (list || []).reduce((max, item) => Math.max(max, Number(String(item.id).slice(skip || prefix.length)) || 0), 0);
  return prefix + (highest + 1);
}

function trackingNumber(courier) {
  return courier === "Royal Mail" ? "RM" + randomDigits(9) + "GB" : "DHL" + randomDigits(9);
}

// ---- Sample data so the app has something to show ----
// Dates are relative to today so "due soon" and "late" always make sense.

function buildSampleData() {
  const data = {
    designers: [
      {
        id: "D1", business_name: SHOP_NAME, location: "Gillingham, Kent",
        rating: 4.9, review_count: 128, speciality_tags: ["Agbada", "Wedding", "Bespoke"],
        commission_rate: 0, delivery_time: "7–14 days"
      }
    ],

    suppliers: [
      { id: "S1", name: "ABC Fabrics", location: "Lagos", delivery_estimate: "1–3 days", rating: 4.8 },
      { id: "S2", name: "Lagos Wax Prints", location: "Lagos", delivery_estimate: "2–4 days", rating: 4.6 },
      { id: "S3", name: "Oyo Heritage Weavers", location: "Iseyin, Oyo", delivery_estimate: "2–3 days", rating: 4.9 },
      { id: "S4", name: "Bella Lace Co", location: "Kano", delivery_estimate: "3–5 days", rating: 4.5 },
      { id: "S5", name: "Manchester Textiles", location: "Manchester", delivery_estimate: "Next day", rating: 4.7 },
      { id: "S6", name: "Highland Mills", location: "Galashiels", delivery_estimate: "2–3 days", rating: 4.8 },
      { id: "S7", name: "Riverside Linens", location: "Belfast", delivery_estimate: "2–3 days", rating: 4.4 },
      { id: "S8", name: "Silk Road Traders", location: "London", delivery_estimate: "Next day", rating: 4.6 }
    ],

    // Price is per yard in pounds (£); stock is in yards
    fabrics: [
      { id: "F1", name: "Italian Cashmere",   category: "Cashmere", color: "#1e3a5f", price_per_yard: 41, supplier_id: "S1", yards_available: 80,  min_order_yards: 2 },
      { id: "F2", name: "Ankara Print",       category: "Ankara",   color: "#c9a24a", price_per_yard: 7.5,  supplier_id: "S2", yards_available: 130, min_order_yards: 2 },
      { id: "F3", name: "Aso Oke",            category: "Aso Oke",  color: "#7c1f2e", price_per_yard: 23, supplier_id: "S3", yards_available: 44,  min_order_yards: 3 },
      { id: "F4", name: "Gold Lace",          category: "Lace",     color: "#8a6d1f", price_per_yard: 20, supplier_id: "S4", yards_available: 7,   min_order_yards: 2 },
      { id: "F5", name: "Navy Senator",       category: "Senator",  color: "#20304a", price_per_yard: 8,  supplier_id: "S5", yards_available: 130, min_order_yards: 2 },
      { id: "F6", name: "Sunburst Ankara",    category: "Ankara",   color: "#e8871e", price_per_yard: 9, supplier_id: "S2", yards_available: 48,  min_order_yards: 2 },
      { id: "F7", name: "Midnight Navy Wool", category: "Wool",     color: "#1f2a44", price_per_yard: 40, supplier_id: "S6", yards_available: 30,  min_order_yards: 2 },
      { id: "F8", name: "Royal Gold Aso Oke", category: "Aso Oke",  color: "#c9a227", price_per_yard: 45, supplier_id: "S3", yards_available: 22,  min_order_yards: 3 },
      { id: "F9", name: "Classic White Linen",category: "Linen",    color: "#f4f1ea", price_per_yard: 16, supplier_id: "S7", yards_available: 60, min_order_yards: 1 },
      { id: "F10", name: "Emerald Silk",      category: "Silk",     color: "#1d7a5a", price_per_yard: 35, supplier_id: "S8", yards_available: 14,  min_order_yards: 1 }
    ],

    staff: [
      { id: "T1", name: "Samuel Ade", role: "cutting", phone: "07700 900201" },
      { id: "T2", name: "Grace Johnson", role: "sewing", phone: "07700 900202" },
      { id: "T3", name: "Chidi Nwosu", role: "sewing", phone: "07700 900203" },
      { id: "T4", name: "Ibrahim Musa", role: "embroidery", phone: "07700 900204" },
      { id: "T5", name: "Mary Adebayo", role: "finishing", phone: "07700 900205" },
      { id: "T6", name: "Ben Oyekan", role: "quality_control", phone: "07700 900206" }
    ],

    customers: [
      { id: "C1", name: "Adaeze Okafor", email: "adaeze@example.com", phone: "07700 900101", created_at: "2025-03-14", notes: "Prefers a relaxed fit at the waist",
        measurement_profiles: [
          { id: "M1", label: "2025", chest: 35, waist: 28, shoulder: 15, sleeve: 23, trouser_length: 39, neck: 13.5, hips: 39, length: 42, updated: "2025-03-14" },
          { id: "M2", label: thisYear(), chest: 36, waist: 29, shoulder: 15, sleeve: 23, trouser_length: 39, neck: 13.5, hips: 40, length: 42, updated: addDays(-20) }
        ] },
      { id: "C2", name: "Tunde Balogun", email: "tunde@example.com", phone: "07700 900102", created_at: "2025-06-02", notes: "Slim-fit trousers",
        measurement_profiles: [
          { id: "M3", label: thisYear(), chest: 42, waist: 36, shoulder: 18.5, sleeve: 25.5, trouser_length: 41, neck: 16, hips: 41, length: 30, updated: addDays(-16) }
        ] },
      { id: "C3", name: "Grace Mensah", email: "grace@example.com", phone: "07700 900103", created_at: "2025-11-20", notes: "",
        measurement_profiles: [
          { id: "M4", label: thisYear(), chest: 44, waist: 38, shoulder: 19, sleeve: 26, trouser_length: 40, neck: 15.5, hips: 43, length: 48, updated: addDays(-26) }
        ] },
      { id: "C4", name: "Ifeanyi Obi", email: "ifeanyi@example.com", phone: "07700 900104", created_at: "2026-01-09", notes: "Short sleeves on shirts",
        measurement_profiles: [
          { id: "M5", label: thisYear(), chest: 40, waist: 34, shoulder: 17.5, sleeve: 25, trouser_length: 40, neck: 15, hips: 39, length: 29, updated: addDays(-10) }
        ] },
      { id: "C5", name: "Tosin Adeyemi", email: "tosin@example.com", phone: "07700 900105", created_at: "2025-02-01", notes: "Prefers elegant, modest styles",
        measurement_profiles: [
          { id: "M6", label: thisYear(), chest: 38, waist: 31, shoulder: 16, sleeve: 23.5, trouser_length: 39, neck: 14, hips: 42, length: 50, updated: addDays(-40) }
        ] },
      { id: "C6", name: "David Johnson", email: "david@example.com", phone: "07700 900106", created_at: "2026-07-30", notes: "Groom — Johnson Wedding",
        measurement_profiles: [
          { id: "M7", label: thisYear(), chest: 41, waist: 33, shoulder: 18, sleeve: 25, trouser_length: 42, neck: 15.5, hips: 40, length: 31, updated: addDays(-18) }
        ] }
    ],

    orders: [],
    payments: [],
    invoices: [],
    deliveries: [],

    wedding_orders: [
      {
        id: "W1", designer_id: "D1", event_name: "Johnson Wedding", event_date: addDays(60),
        members: [
          { id: "WM1", role: "Groom", name: "David Johnson", outfits: 1, order_id: "NT-1008", status: "" },
          { id: "WM2", role: "Bride", name: "Esther Johnson", outfits: 2, order_id: "", status: "Not started" },
          { id: "WM3", role: "Groomsmen (6)", name: "", outfits: 6, order_id: "", status: "In progress" },
          { id: "WM4", role: "Bridesmaids (5)", name: "", outfits: 5, order_id: "", status: "Not started" }
        ]
      }
    ],

    ready_to_wear: [
      { id: "R1", name: "Men's Kaftan", price: 75, cost: 38, stock: 8, color: "#1e2a44" },
      { id: "R2", name: "Women's Two Piece", price: 55, cost: 26, stock: 6, color: "#7c1f2e" },
      { id: "R3", name: "Ankara Dress", price: 40, cost: 18, stock: 10, color: "#e8871e" },
      { id: "R4", name: "Senator Set", price: 65, cost: 32, stock: 4, color: "#20304a" }
    ],
    rtw_sales: [
      { id: "RS1", item_id: "R1", customer_id: "C4", price: 75, cost: 38, date: addDays(-12), status: "confirmed" },
      { id: "RS2", item_id: "R3", customer_id: "C1", price: 40, cost: 18, date: addDays(-5), status: "confirmed" }
    ],

    prices: defaultPriceList().map(p => Object.assign(p, { designer_id: "D1" })),
    customer_notes: [],

    // What the customer app is doing right now
    session: { customerId: null },
    draft: null,
    counters: { order: 1008, payment: 0, invoice: 0 }
  };

  // Independent fabric sellers and their market stalls (sellers-data.js)
  addSampleSellers(data);
  data.sample_sellers_added = true;

  // Build sample orders through the same quote maths as the real flow
  applyPriceList(data.prices);
  const samples = [
    { id: "NT-1001", customer: "C1", outfit: "Dress",     colour: "#c9a24a", embroidery: "None",   sleeve: "Fitted", neck: "V-neck", fabric: "F11",  yards: 3, stage: "sewing",          created: -14, due: 7,   method: "Card" },
    { id: "NT-1002", customer: "C2", outfit: "Suit",      colour: "#1e2a44", embroidery: "None",   sleeve: "Fitted", neck: "V-neck", fabric: "F7",  yards: 3.5, stage: "cutting",         created: -16, due: -2,  method: "Bank transfer" },
    { id: "NT-1003", customer: "C3", outfit: "Agbada",    colour: "#c9a24a", embroidery: "Gold",   sleeve: "Wide",   neck: "Round",  fabric: "F8",  yards: 10, stage: "quality_control", created: -24, due: 3,   method: "Bank transfer" },
    { id: "NT-1004", customer: "C4", outfit: "Senator",   colour: "#1e2a44", embroidery: "Silver", sleeve: "Fitted", neck: "Round",  fabric: "F5",  yards: 4, stage: "balance_paid",    created: -21, due: 1,   method: "Card", paidInFull: true, delivery: "In transit" },
    { id: "NT-1005", customer: "C1", outfit: "Two Piece", colour: "#2d4f3a", embroidery: "Gold",   sleeve: "Fitted", neck: "Round",  fabric: "F10", yards: 4, stage: "tailor_assigned", created: -2,  due: 12,  method: "Apple Pay" },
    { id: "NT-1006", customer: "C5", outfit: "Bubu",      colour: "#7c1f2e", embroidery: "Gold",   sleeve: "Wide",   neck: "Round",  fabric: "F4",  yards: 5, stage: "delivered",       created: -40, due: -20, method: "Card", paidInFull: true, delivery: "Delivered", review: [5, "Beautiful work and a perfect fit."] },
    { id: "NT-1007", customer: "C5", outfit: "Kaftan",    colour: "#1e2a44", embroidery: "Silver", sleeve: "Wide",   neck: "V-neck", fabric: "F1",  yards: 4.5, stage: "embroidery",      created: -10, due: 5,   method: "Bank transfer" },
    { id: "NT-1008", customer: "C6", outfit: "Wedding",   colour: "#efe6d2", embroidery: "Gold",   sleeve: "Wide",   neck: "Round",  fabric: "F3",  yards: 10, stage: "fitting",         created: -18, due: 30,  method: "Card" }
  ];

  const staffFor = role => data.staff.find(s => s.role === role).id;

  samples.forEach(s => {
    const fabric = data.fabrics.find(f => f.id === s.fabric);
    const quote = computeQuote(s.outfit, s.embroidery, fabric, s.yards);
    const created = addDays(s.created);
    const deposit = depositFor(quote.total);
    const stageIndex = STAGES.findIndex(st => st.key === s.stage);
    const measurementProfile = data.customers.find(c => c.id === s.customer).measurement_profiles.slice(-1)[0];

    const order = {
      id: s.id, customer_id: s.customer, designer_id: "D1",
      outfit_type: s.outfit, colour: s.colour, embroidery: s.embroidery, sleeve_style: s.sleeve, neck_style: s.neck,
      concept_variation: 1, concept_image_url: "",
      measurement_profile_id: measurementProfile.id,
      fabric_id: fabric.id, fabric_supplier_id: fabric.supplier_id, fabric_yards: s.yards, fabric_cost: quote.fabricCost,
      line_items: quote.lines, quote_total: quote.total,
      deposit_amount: deposit, deposit_paid_at: created, balance_paid_at: null,
      stage: s.stage,
      assigned_staff: {
        cutting: staffFor("cutting"), sewing: s.id === "NT-1007" ? "T3" : staffFor("sewing"),
        embroidery: staffFor("embroidery"), finishing: staffFor("finishing"), quality_control: staffFor("quality_control")
      },
      review_rating: null, review_text: "",
      quote_status: "accepted", quoted_at: null, accepted_at: created, fabric_problem: null,
      due_date: addDays(s.due), created_at: created, updated_at: addDays(Math.min(-1, s.created + stageIndex * 2))
    };
    data.orders.push(order);

    data.payments.push({ id: "P" + (++data.counters.payment), order_id: order.id, amount: deposit, method: s.method, kind: "Deposit", date: created, status: "confirmed" });
    if (s.paidInFull) {
      const balanceDate = addDays(s.due - 3);
      data.payments.push({ id: "P" + (++data.counters.payment), order_id: order.id, amount: quote.total - deposit, method: s.method, kind: "Balance", date: balanceDate, status: "confirmed" });
      order.balance_paid_at = balanceDate;
    }
    data.invoices.push({ id: "INV-" + order.id.split("-")[1], order_id: order.id, line_items: quote.lines, total: quote.total, created_at: created });

    if (s.delivery) {
      data.deliveries.push({
        id: "DL-" + order.id.split("-")[1], order_id: order.id, courier: "DHL", tracking_number: "DHL" + order.id.split("-")[1] + "56789",
        status: s.delivery, eta: addDays(s.due), updated: addDays(-1)
      });
    }
    if (s.review) {
      order.review_rating = s.review[0];
      order.review_text = s.review[1];
    }
  });
  data.counters.invoice = 1008;

  addSampleQuoteRequests(data);
  // Customers' notes are kept per tailor
  data.customers.forEach(c => { if (c.notes) data.customer_notes.push({ designer_id: "D1", customer_id: c.id, notes: c.notes }); });
  addDemoTailors(data);
  return data;
}

// Two customers waiting on the tailor, and a chat on an order being made
function addSampleQuoteRequests(data) {
  const at = (days, time) => addDays(days) + "T" + time + ":00.000Z";
  const shop = SHOP_NAME;
  const request = (id, customer, outfit, colour, embroidery, sleeve, neck, fabric, created) => {
    const profile = data.customers.find(c => c.id === customer).measurement_profiles.slice(-1)[0];
    const f = data.fabrics.find(x => x.id === fabric);
    return {
      id, customer_id: customer, designer_id: "D1", outfit_type: outfit, colour, embroidery, sleeve_style: sleeve, neck_style: neck,
      concept_variation: 1, concept_image_url: "", inspiration: null, measurement_profile_id: profile.id,
      fabric_id: f.id, fabric_supplier_id: f.supplier_id, fabric_yards: 0, fabric_cost: 0, line_items: [], quote_total: 0,
      deposit_amount: 0, deposit_paid_at: null, balance_paid_at: null, stage: "tailor_assigned",
      assigned_staff: { cutting: "", sewing: "", embroidery: "", finishing: "", quality_control: "" },
      review_rating: null, review_text: "", quote_status: "requested", quoted_at: null, accepted_at: null, fabric_problem: null,
      due_date: addDays(14 + created), created_at: addDays(created), updated_at: addDays(created)
    };
  };
  const tunde = request("NT-1009", "C2", "Agbada", "#1e2a44", "Gold", "Wide", "Round", "F8", -1);
  const tosin = request("NT-1010", "C5", "Bubu", "#7c1f2e", "Silver", "Wide", "V-neck", "F6", -3);
  data.orders.push(tunde, tosin);
  // Tosin's quote has been sent: 6 yd of Sunburst Ankara
  const f6 = data.fabrics.find(x => x.id === "F6");
  const quote = computeQuote("Bubu", "Silver", f6, 6);
  Object.assign(tosin, { fabric_yards: 6, fabric_cost: quote.fabricCost, line_items: quote.lines, quote_total: quote.total,
    deposit_amount: depositFor(quote.total), quote_status: "quoted", quoted_at: addDays(-2) });

  const welcome = `Thanks — your request is with ${shop}. We'll look at your design, style photos and measurements, and chat with you here to agree how many yards of fabric you need. Then we'll send your quote. Nothing is bought or charged until you accept it.`;
  let n = 0;
  const msg = (order, kind, name, body, when) => ({ id: "MSG" + (++n), order_id: order, sender_kind: kind, sender_name: name, body, photos: [], created_at: when });
  data.messages = [
    msg("NT-1010", "system", APP_NAME, welcome, at(-3, "10:02")),
    msg("NT-1010", "customer", "Tosin Adeyemi", "I'd like the bubu to reach the floor, and wide sleeves that cover my elbows.", at(-3, "10:04")),
    msg("NT-1010", "team", "Mary at " + shop, "Lovely! For a floor-length bubu at your height you'll need 6 yards of the Sunburst Ankara. Sending your quote now.", at(-2, "09:15")),
    msg("NT-1010", "system", APP_NAME, `Your quote is ready: Sunburst Ankara, 6 yd × ${money(f6.price_per_yard)} = ${money(quote.fabricCost)} · tailoring ${money(quote.lines[1].amount)} · embroidery ${money(quote.lines[2].amount)} · delivery ${money(quote.lines[3].amount)}. Total ${money(quote.total)}, deposit ${money(depositFor(quote.total))} (60%). Tap "Accept quote" to go ahead, or ask us a question here.`, at(-2, "09:16")),
    msg("NT-1009", "system", APP_NAME, welcome, at(-1, "18:40")),
    msg("NT-1009", "customer", "Tunde Balogun", "It's for my brother's wedding in six weeks. I'm 6ft 3 — is 10 yards enough for a full agbada?", at(-1, "18:42")),
    msg("NT-1008", "team", "Mary at " + shop, "Your fitting is booked for Saturday at 11am. Please bring the shoes you'll wear on the day.", at(-2, "12:30")),
    msg("NT-1008", "customer", "David Johnson", "Perfect, see you Saturday.", at(-2, "13:05"))
  ];
  data.chat_reads = [
    { order_id: "NT-1010", side: "team", last_read_at: at(-2, "09:16") },
    { order_id: "NT-1008", side: "customer", last_read_at: at(-2, "13:05") }
  ];
}

// ---- Load and save ----
// Demo mode keeps everything in this browser's localStorage.
// Live mode sends changes to Supabase (cloud.js).

// "db" holds all the app's data while it runs. app.js loads it once every script is ready.
let db = null;

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return upgradeData(JSON.parse(saved));
    }
  } catch (error) {
    console.warn("Could not load saved data, using sample data.", error);
  }
  return upgradeData(buildSampleData());
}

function saveData() {
  if (Cloud.live) {
    Cloud.save();
    return;
  }
  noticeFabricProblems(); // the database does this itself in live mode
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (error) {
    console.warn("Could not save data.", error);
    if (typeof toast === "function") toast("Couldn't save — this browser's storage is full.");
  }
}

function resetSampleData() {
  if (Cloud.live) return;
  if (confirm("This will erase your changes and restore the sample data. Continue?")) {
    db = upgradeData(buildSampleData());
    PhotoStore.clear();
    saveData();
    go(APP.home);
    renderAll();
  }
}

// ---- Lookups ----

// On the Business dashboard only the open tailor's own customers and orders can be found
function findCustomer(id) { return (inBusiness() ? bizCustomers() : db.customers).find(c => c.id === id); }
function findFabric(id) { return db.fabrics.find(f => f.id === id); }
function findSupplier(id) { return db.suppliers.find(s => s.id === id); }
function findOrder(id) { return db.orders.find(o => o.id === id && orderInScope(o)); }
function findStaff(id) { return db.staff.find(s => s.id === id); }
function findInvoice(orderId) { return db.invoices.find(i => i.order_id === orderId); }
function findDelivery(orderId) { return db.deliveries.find(d => d.order_id === orderId); }

function customerName(id) {
  const customer = findCustomer(id);
  return customer ? customer.name : "Unknown";
}

function supplierLabel(fabric) {
  const supplier = findSupplier(fabric.supplier_id);
  return supplier ? `${supplier.name}, ${supplier.location}` : "Unknown supplier";
}

function latestProfile(customer) {
  if (!customer || !customer.measurement_profiles.length) return null;
  return customer.measurement_profiles.slice().sort((a, b) => a.label.localeCompare(b.label)).slice(-1)[0];
}

function findProfile(profileId) {
  for (const customer of db.customers) {
    const profile = customer.measurement_profiles.find(p => p.id === profileId);
    if (profile) return profile;
  }
  return null;
}

// Finds a customer by name, or creates a new one if they don't exist yet
function findOrCreateCustomer(name, phone, email) {
  let customer = bizCustomers().find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!customer) {
    customer = { id: newId("C", db.customers), name, email: email || "", phone: phone || "", created_at: today(), notes: "", measurement_profiles: [],
      added_by_designer_id: inBusiness() ? bizDesignerId() : null };
    db.customers.push(customer);
  } else {
    if (phone) customer.phone = phone;
    if (email) customer.email = email;
  }
  return customer;
}

// Saves measurements into the customer's profile for this year (versioned by year)
function saveMeasurementProfile(customer, values) {
  const label = thisYear();
  let profile = customer.measurement_profiles.find(p => p.label === label);
  if (!profile) {
    profile = { id: newId("M", db.customers.flatMap(c => c.measurement_profiles)), label };
    customer.measurement_profiles.push(profile);
  }
  MEASUREMENT_FIELDS.forEach(field => {
    profile[field.key] = values[field.key] === "" || values[field.key] == null ? null : Number(values[field.key]);
  });
  profile.updated = today();
  return profile;
}

// ---- Money on orders ----
// Only confirmed payments count as paid.

function isConfirmed(payment) {
  return !payment.status || payment.status === "confirmed";
}

function amountPaid(orderId) {
  return db.payments.filter(p => p.order_id === orderId && isConfirmed(p)).reduce((total, p) => total + p.amount, 0);
}

// Paid in the customer app but not confirmed by the team yet
function amountAwaiting(orderId) {
  return db.payments.filter(p => p.order_id === orderId && p.status === "awaiting_confirmation").reduce((total, p) => total + p.amount, 0);
}

function paymentsAwaiting() {
  return bizPayments().filter(p => p.status === "awaiting_confirmation");
}

// Nothing is owed on a quote until the customer accepts it
function balanceOwed(order) {
  if (!isPlaced(order)) return 0;
  return Math.round((order.quote_total - amountPaid(order.id)) * 100) / 100;
}

function nextPaymentId() {
  if (Cloud.live) return Cloud.newId();
  db.counters.payment += 1;
  return "P" + db.counters.payment;
}

// Records a payment. The team's own entries (e.g. cash in the shop) count
// straight away; a customer's payment waits for the team to confirm it.
function recordOrderPayment(order, amount, method, date, byTeam) {
  const before = balanceOwed(order) - amountAwaiting(order.id);
  db.payments.push({
    id: nextPaymentId(), order_id: order.id, amount, method,
    kind: amount >= before ? "Balance" : "Part payment", date: date || today(),
    status: byTeam ? "confirmed" : "awaiting_confirmation"
  });
  refreshOrderPayments(order);
}

// The team confirms (or rejects) a payment
function confirmPayment(paymentId, accept) {
  const payment = db.payments.find(p => p.id === paymentId);
  if (!payment) return null;
  payment.status = accept ? "confirmed" : "rejected";
  payment.confirmed_at = today();
  const order = findOrder(payment.order_id);
  if (order) refreshOrderPayments(order);
  return payment;
}

// Works out the deposit and balance from confirmed payments, and moves the
// order on if the balance is cleared after quality control (step 14).
// The database does the same in live mode (supabase/setup.sql).
function refreshOrderPayments(order) {
  const paid = amountPaid(order.id);
  if (paid > 0 && paid >= Math.min(order.deposit_amount, order.quote_total) - 0.005) {
    order.deposit_paid_at = order.deposit_paid_at || today();
  } else if (stageIndex(order) <= 0) {
    order.deposit_paid_at = null;
  }
  if (paid > 0 && paid >= order.quote_total - 0.005) {
    order.balance_paid_at = order.balance_paid_at || today();
    if (order.stage === "quality_control") order.stage = "balance_paid";
  } else {
    order.balance_paid_at = null;
  }
  order.updated_at = today();
}

// ---- Where an order is in the 16-step lifecycle ----

function stageIndex(order) {
  return STAGES.findIndex(s => s.key === order.stage);
}

// True while the deposit is paid but not yet confirmed by the team
function depositAwaiting(order) {
  return !order.deposit_paid_at;
}

// How many of the 16 lifecycle steps are complete
function stepsDone(order) {
  const status = quoteStatus(order);
  if (status === "requested") return 4;                         // steps 1–4; waiting for the tailor's quote (step 5)
  if (status === "quoted") return 5;                            // waiting for the customer to accept (step 6)
  if (depositAwaiting(order)) return FIRST_STEP_OF_STAGES - 1; // steps 1–6; the deposit (step 7) isn't confirmed yet
  return FIRST_STEP_OF_STAGES + stageIndex(order) + 1 + (order.review_rating ? 1 : 0);
}

// The step being worked on now, e.g. "Sewing" — or "Complete"
function currentStepLabel(order) {
  const status = quoteStatus(order);
  if (status === "requested") return order.fabric_problem ? "Fabric sold out — new quote coming" : QUOTE_STATUS_LABELS.requested;
  if (status === "quoted") return "Quote ready to accept";
  if (depositAwaiting(order)) return depositStarted(order) ? "Deposit awaiting confirmation" : "Waiting for deposit";
  const done = stepsDone(order);
  return done >= LIFECYCLE.length ? "Complete" : LIFECYCLE[done];
}

// ---- Quotes: the tailor decides the yards ----
// A customer's order is a request until the tailor sends a quote and the
// customer accepts it. Orders from before this change, and walk-in orders
// the team takes, are "accepted" straight away.

function quoteStatus(order) {
  return order.quote_status || "accepted";
}

function isPlaced(order) {
  return quoteStatus(order) === "accepted";
}

// Orders being made (accepted quotes and walk-ins) — what production, payments and the dashboard count
function placedOrders() {
  return scopedOrders().filter(isPlaced);
}

// Customers waiting for the tailor, or deciding on a quote
function quoteRequests() {
  return scopedOrders().filter(o => !isPlaced(o));
}

// True once the customer has paid (or the shop has recorded) any of the deposit
function depositStarted(order) {
  return !!order.deposit_paid_at || db.payments.some(p => p.order_id === order.id && p.status !== "rejected");
}

// "Italian Cashmere has sold out" — why a fabric can't be sold in this amount, or "" if it can
function fabricProblemText(fabric, yards) {
  if (!fabric || fabric.deleted_at || fabric.status !== "approved") return `${fabric ? fabric.name : "That fabric"} is no longer on sale`;
  if (fabric.sold_out || fabric.yards_available < Math.max(fabric.min_order_yards || 0, 0.01)) return `${fabric.name} has sold out`;
  if (yards && fabric.yards_available < yards) return `Only ${fabric.yards_available} yd of ${fabric.name} is left`;
  return "";
}

// Step 4 → 5: the customer sends their design, photos, measurements and
// chosen fabric to the tailor. Nothing is bought and there's no price yet.
// In live mode the database makes the order, so this returns a Promise.
function requestQuote(details) {
  if (Cloud.live) return Cloud.requestQuote(details);
  const fabric = details.fabric;
  const tailor = designerById(details.designerId) || mainDesigner();
  if (tailor.admin_status !== "approved") throw new Error(`${tailor.business_name} isn't taking orders on NebedaHub right now. Please choose another tailor.`);
  if (tailor.custom_orders === false) throw new Error(`${tailor.business_name} isn't taking custom orders at the moment.`);
  const id = nextOrderId();
  const order = {
    id, customer_id: details.customerId, designer_id: tailor.id,
    outfit_type: details.outfit, colour: details.colour, embroidery: details.embroidery,
    sleeve_style: details.sleeve, neck_style: details.neck,
    concept_variation: details.variation || 1, concept_image_url: "",
    inspiration: details.inspiration || null,
    measurement_profile_id: details.profileId || null,
    fabric_id: fabric.id, fabric_supplier_id: fabric.supplier_id,
    fabric_yards: 0, fabric_cost: 0, line_items: [], quote_total: 0,
    deposit_amount: 0, deposit_paid_at: null, balance_paid_at: null,
    stage: "tailor_assigned",
    assigned_staff: { cutting: "", sewing: "", embroidery: "", finishing: "", quality_control: "" },
    review_rating: null, review_text: "",
    quote_status: "requested", quoted_at: null, accepted_at: null, fabric_problem: null,
    due_date: addDays(14), created_at: today(), updated_at: today()
  };
  db.orders.push(order);
  addSystemMessage(order, `Thanks — your request is with ${tailor.business_name}. We'll look at your design, style photos and measurements, and chat with you here to agree how many yards of fabric you need. Then we'll send your quote. Nothing is bought or charged until you accept it.`);
  if (details.note) addChatMessage(order, "customer", details.note, []);
  return order;
}

// Step 5: the team sends the quote — the yards they agreed with the customer,
// and another fabric if they agreed one. The price is yards × the seller's
// price per yard + tailoring + embroidery + delivery from the price list.
// The database does this in live mode (wearvia_send_quote), so this returns a Promise.
function sendQuote(order, fabricId, yards, note) {
  if (Cloud.live) return Cloud.sendQuote(order, fabricId, yards, note);
  const fabric = findFabric(fabricId || order.fabric_id);
  yards = Math.round(Number(yards) * 100) / 100;
  if (isPlaced(order)) throw new Error(`The customer has already accepted the quote for ${order.id}. It can't be changed now.`);
  if (!fabric) throw new Error("Choose a fabric for the quote.");
  if (!(yards > 0) || yards > 100 || Math.round(yards * 4) !== yards * 4) throw new Error("Enter the yards needed, in quarter yards (for example 4.5 or 5.25).");
  if (fabric.deleted_at || fabric.status !== "approved" || fabric.sold_out) throw new Error(`${fabric.name} isn't on sale any more. Choose another fabric.`);
  if (yards < (fabric.min_order_yards || 0)) throw new Error(`The smallest order for ${fabric.name} is ${fabric.min_order_yards} yd.`);
  if (yards > fabric.yards_available) throw new Error(`Only ${fabric.yards_available} yd of ${fabric.name} is left in stock.`);
  usePricesOf(order.designer_id);   // the order's own tailor's price list
  const quote = computeQuote(order.outfit_type, order.embroidery, fabric, yards);
  const deposit = depositFor(quote.total);
  Object.assign(order, {
    fabric_id: fabric.id, fabric_supplier_id: fabric.supplier_id, fabric_yards: yards, fabric_cost: quote.fabricCost,
    line_items: quote.lines, quote_total: quote.total, deposit_amount: deposit,
    quote_status: "quoted", quoted_at: today(), fabric_problem: null, updated_at: today()
  });
  if (note && note.trim()) addChatMessage(order, "team", note.trim(), []);
  addSystemMessage(order, `Your quote is ready: ${fabric.name}, ${yards} yd × ${money(fabric.price_per_yard)} = ${money(quote.fabricCost)} · tailoring ${money(quote.lines[1].amount)} · embroidery ${money(quote.lines[2].amount)} · delivery ${money(quote.lines[3].amount)}. Total ${money(quote.total)}, deposit ${money(deposit)} (60%). Tap "Accept quote" to go ahead, or ask us a question here.`);
  return order;
}

// Step 6: the customer accepts. Only now is the fabric taken out of stock,
// the seller's order line and the invoice made, and tailors assigned. If the
// fabric sold out in the meantime, the customer is told in the chat and the
// request goes back to the tailor. Returns { ok, message } (a Promise in live mode).
function acceptQuote(order) {
  if (Cloud.live) return Cloud.acceptQuote(order);
  if (isPlaced(order)) return { ok: true, already: true };
  const shop = designerName(order.designer_id);
  if (quoteStatus(order) !== "quoted") throw new Error(`There's no quote to accept yet. ${shop} will send it in the chat.`);
  const fabric = findFabric(order.fabric_id);
  const problem = fabricProblemText(fabric, order.fabric_yards);
  if (problem) {
    order.quote_status = "requested";
    order.fabric_problem = problem;
    addSystemMessage(order, `Sorry — ${problem}, so this quote can't be accepted. Nothing has been charged. ${shop} will suggest another fabric here in the chat and send you a new quote.`);
    return { ok: false, message: `Sorry — ${problem}. ${shop} will suggest another fabric in the chat.` };
  }
  fabric.yards_available = Math.round((fabric.yards_available - order.fabric_yards) * 100) / 100;
  const staff = autoAssignStaff(order.designer_id);
  STAFF_ROLES.forEach(role => { if (!order.assigned_staff[role.key]) order.assigned_staff[role.key] = staff[role.key]; });
  Object.assign(order, { quote_status: "accepted", accepted_at: today(), fabric_problem: null, updated_at: today() });
  if (!order.due_date || order.due_date < addDays(14)) order.due_date = addDays(14);
  recordFabricOrder(order); // the fabric seller sees it in their orders
  if (!findInvoice(order.id)) db.invoices.push({ id: "INV-" + order.id.split("-")[1], order_id: order.id, line_items: order.line_items, total: order.quote_total, created_at: today() });
  addSystemMessage(order, `Quote accepted. ${order.fabric_yards} yd of ${fabric.name} is bought for your outfit. Next: pay your deposit of ${money(order.deposit_amount)} and we'll start making it.`);
  return { ok: true };
}

// Demo mode: if a fabric sells out while a customer waits for (or decides on)
// a quote, tell them in the chat and send the request back to the tailor.
// The database does this in live mode.
function noticeFabricProblems() {
  if (!db || !db.orders) return;
  quoteRequests().forEach(order => {
    if (order.fabric_problem) return;
    const problem = fabricProblemText(findFabric(order.fabric_id), quoteStatus(order) === "quoted" ? order.fabric_yards : 0);
    if (!problem) return;
    const wasQuoted = quoteStatus(order) === "quoted";
    order.fabric_problem = problem;
    order.quote_status = "requested";
    addSystemMessage(order, `Sorry — ${problem}, so ${wasQuoted ? "this quote can't be accepted any more. " : ""}${designerName(order.designer_id)} will suggest another fabric here in the chat and send you a new quote.`);
  });
}

function isOpen(order) {
  return order.stage !== "delivered";
}

function isLate(order) {
  return isPlaced(order) && isOpen(order) && order.due_date < today();
}

// Staff member responsible for the step in progress (if it's a production step)
function staffForCurrentStep(order) {
  const next = STAGES[stageIndex(order) + 1];
  if (!next || !next.role) return null;
  return findStaff(order.assigned_staff[next.role]);
}

// Pick the least busy person for each role when a new order comes in (step 8)
function autoAssignStaff(designerId) {
  const assigned = {};
  const main = (mainDesigner() || {}).id;
  STAFF_ROLES.forEach(role => {
    const people = db.staff.filter(s => s.role === role.key && (s.designer_id || main) === (designerId || main));
    if (!people.length) { assigned[role.key] = ""; return; }
    const load = person => db.orders.filter(o => isOpen(o) && o.assigned_staff[role.key] === person.id).length;
    people.sort((a, b) => load(a) - load(b));
    assigned[role.key] = people[0].id;
  });
  return assigned;
}

function nextOrderId() {
  const highest = db.orders.reduce((max, o) => Math.max(max, Number(o.id.split("-")[1])), 1000);
  return "NT-" + (highest + 1);
}

// A walk-in order taken by the team: the yards are entered directly, the
// fabric is bought and the deposit taken straight away, and a tailor assigned.
// (Customers' orders go through requestQuote → sendQuote → acceptQuote instead.)
// In live mode the database creates the order, so this returns a Promise.
function createPaidOrder(details) {
  if (Cloud.live) return Cloud.placeOrder(details);
  const id = nextOrderId();
  const order = {
    id, customer_id: details.customerId, designer_id: bizDesignerId(),
    outfit_type: details.outfit, colour: details.colour, embroidery: details.embroidery,
    sleeve_style: details.sleeve, neck_style: details.neck,
    concept_variation: details.variation || 1, concept_image_url: "",
    inspiration: details.inspiration || null,   // customer's style photos, link and note (inspiration.js)
    measurement_profile_id: details.profileId || null,
    fabric_id: details.fabric.id, fabric_supplier_id: details.fabric.supplier_id,
    fabric_yards: details.yards, fabric_cost: details.quote.fabricCost,
    line_items: details.quote.lines, quote_total: details.quote.total,
    deposit_amount: details.deposit, deposit_paid_at: null, balance_paid_at: null,
    stage: "tailor_assigned",
    assigned_staff: autoAssignStaff(bizDesignerId()),
    review_rating: null, review_text: "",
    quote_status: "accepted", quoted_at: null, accepted_at: today(), fabric_problem: null,
    due_date: details.dueDate || addDays(14), created_at: today(), updated_at: today()
  };
  db.orders.push(order);
  db.payments.push({
    id: nextPaymentId(), order_id: id, amount: details.deposit, method: details.method, kind: "Deposit", date: today(),
    status: details.confirmed ? "confirmed" : "awaiting_confirmation"
  });
  db.invoices.push({ id: "INV-" + id.split("-")[1], order_id: id, line_items: order.line_items, total: order.quote_total, created_at: today() });
  recordFabricOrder(order); // the fabric seller sees it in their orders
  refreshOrderPayments(order);
  return order;
}

// Moves an order forward one production step. Returns an error message if it can't.
function advanceOrder(order) {
  const index = stageIndex(order);
  const next = STAGES[index + 1];
  if (!next) return "This order has been delivered.";
  if (depositAwaiting(order)) return `The deposit for ${order.id} hasn't been confirmed yet. Confirm it under Payments first.`;
  if (next.key === "balance_paid") {
    if (balanceOwed(order) > 0) return `Waiting for the balance of ${money(balanceOwed(order))} before this can move on.`;
    order.balance_paid_at = order.balance_paid_at || today();
  }
  if (next.key === "delivered") {
    const delivery = findDelivery(order.id);
    if (!delivery) return "Dispatch the order with a courier first.";
    delivery.status = "Delivered";
    delivery.updated = today();
  }
  order.stage = next.key;
  order.updated_at = today();
  return null;
}

// Production steps can be undone up to quality control; payments and deliveries can't be undone
function canMoveBack(order) {
  const index = stageIndex(order);
  return index > 0 && index <= STAGES.findIndex(s => s.key === "quality_control");
}

function moveOrderBack(order) {
  if (!canMoveBack(order)) return;
  order.stage = STAGES[stageIndex(order) - 1].key;
  order.updated_at = today();
}

function dispatchOrder(order, courier) {
  let delivery = findDelivery(order.id);
  if (!delivery) {
    delivery = { id: Cloud.live ? Cloud.newId() : "DL-" + order.id.split("-")[1], order_id: order.id, courier, tracking_number: trackingNumber(courier), status: "Order ready", eta: addDays(3), updated: today() };
    db.deliveries.push(delivery);
  }
  return delivery;
}

// Moves a parcel on; reaching "Delivered" completes step 15
function advanceDelivery(delivery) {
  const index = DELIVERY_STATUSES.indexOf(delivery.status);
  if (index >= DELIVERY_STATUSES.length - 1) return;
  delivery.status = DELIVERY_STATUSES[index + 1];
  delivery.updated = today();
  if (delivery.status === "Delivered") {
    const order = findOrder(delivery.order_id);
    if (order && order.stage === "balance_paid") {
      order.stage = "delivered";
      order.updated_at = today();
    }
  }
}

// A tailor's rating including reviews left in the app. In live mode the
// database keeps rating and review_count up to date from the reviews table.
function designerRating(designerId) {
  const d = designerById(designerId) || designer();
  if (Cloud.live) return { rating: d.review_count > 0 && d.rating ? Number(d.rating).toFixed(1) : "—", count: d.review_count || 0 };
  const reviews = db.orders.filter(o => o.review_rating && o.designer_id === d.id);
  const count = (d.review_count || 0) + reviews.length;
  const sum = (d.rating || 0) * (d.review_count || 0) + reviews.reduce((total, o) => total + o.review_rating, 0);
  return { rating: count ? (sum / count).toFixed(1) : "—", count };
}

// ---- Customer summaries (used by the profile and customer screens) ----

function customerOrders(customerId) {
  return scopedOrders().filter(o => o.customer_id === customerId);
}

// The latest reviews of a tailor (demo mode; live pages get them from wearvia_tailor_page)
function recentReviews(count, designerId) {
  const id = designerId || designer().id;
  if (db.reviews) {
    return db.reviews.filter(r => r.designer_id === id).slice(-count).reverse().map(r => {
      const order = r.order_id ? findOrder(r.order_id) : null;
      return { rating: r.rating, text: r.review_text, who: order ? customerName(order.customer_id).split(" ")[0] : "A customer", outfit: order ? order.outfit_type : "" };
    });
  }
  const d = designerById(id);
  return db.orders.filter(o => o.review_rating && o.designer_id === id).slice(-count).reverse().map(o =>
    ({ rating: o.review_rating, text: o.review_text, who: customerName(o.customer_id).split(" ")[0], outfit: o.outfit_type }))
    .concat(d && d.sample_reviews ? d.sample_reviews : []).slice(0, count);
}

function customerSpend(customerId) {
  const orderPayments = customerOrders(customerId).reduce((total, o) => total + amountPaid(o.id), 0);
  const shopSales = (inBusiness() ? bizRtwSales() : db.rtw_sales).filter(s => s.customer_id === customerId && isConfirmed(s)).reduce((total, s) => total + s.price, 0);
  return orderPayments + shopSales;
}

function favouriteColour(customerId) {
  const counts = {};
  customerOrders(customerId).forEach(o => { counts[o.colour] = (counts[o.colour] || 0) + 1; });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return top ? colourName(top) : "—";
}
