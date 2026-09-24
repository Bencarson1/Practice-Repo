// ============================================================
// data.js — settings, the order lifecycle, sample data,
// saving/loading, and helper functions used everywhere
// ============================================================

// ---- Settings you can change ----
const APP_NAME = "Wearvia";          // the platform name shown in the app
const SHOP_NAME = "Nebeda Threads";  // the first shop (designer) using Wearvia
const CURRENCY = "£";
const STORAGE_KEY = "wearvia-app-v2";
const DEPOSIT_RATE = 0.6;            // 60% deposit, balance after quality control
const DELIVERY_FEE = 15;
const LOW_STOCK_METRES = 10;

// ---- The confirmed order lifecycle (WEARVIA-SPEC.md, section 2) ----
// Keep this sequence exactly.
const LIFECYCLE = [
  "Outfit & design chosen",       // 1
  "AI design concept approved",   // 2
  "Measurements saved",           // 3
  "Fabric selected",              // 4
  "Fabric purchased",             // 5
  "Quotation generated",          // 6
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
// tailoring = our making price in £; metres = typical fabric needed
const OUTFITS = [
  { name: "Agbada",    tailoring: 280, metres: 7 },
  { name: "Kaftan",    tailoring: 150, metres: 4 },
  { name: "Senator",   tailoring: 170, metres: 4 },
  { name: "Bubu",      tailoring: 140, metres: 5 },
  { name: "Two Piece", tailoring: 180, metres: 5 },
  { name: "Dress",     tailoring: 160, metres: 4 },
  { name: "Wedding",   tailoring: 450, metres: 8 },
  { name: "Suit",      tailoring: 350, metres: 4 },
  { name: "Aso Ebi",   tailoring: 160, metres: 5 },
  { name: "Custom",    tailoring: 200, metres: 5 }
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
const SLEEVES = ["Wide", "Fitted"];
const NECKS = ["Round", "V-neck"];
const PAYMENT_METHODS = ["Card", "Apple Pay", "Bank transfer", "Cash"];
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

// Itemised quotation: fabric, tailoring, embroidery, delivery → total (screen 8)
function computeQuote(outfit, embroidery, fabric, metres) {
  const fabricCost = Math.round(metres * fabric.price_per_metre * 100) / 100;
  const lines = [
    { label: `Fabric — ${fabric.name} (${metres} m × ${money(fabric.price_per_metre)})`, amount: fabricCost },
    { label: `Tailoring (${outfit})`, amount: findOutfit(outfit).tailoring },
    { label: `Embroidery (${embroidery})`, amount: embroideryPrice(embroidery) },
    { label: "Delivery", amount: DELIVERY_FEE }
  ];
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, total, fabricCost };
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

    // Price is per metre in pounds (£); stock is in metres
    fabrics: [
      { id: "F1", name: "Italian Cashmere",   category: "Cashmere", color: "#1e3a5f", price_per_metre: 45, supplier_id: "S1", metres_available: 74,  min_order_metres: 2 },
      { id: "F2", name: "Ankara Print",       category: "Ankara",   color: "#c9a24a", price_per_metre: 8,  supplier_id: "S2", metres_available: 120, min_order_metres: 2 },
      { id: "F3", name: "Aso Oke",            category: "Aso Oke",  color: "#7c1f2e", price_per_metre: 25, supplier_id: "S3", metres_available: 40,  min_order_metres: 3 },
      { id: "F4", name: "Gold Lace",          category: "Lace",     color: "#8a6d1f", price_per_metre: 22, supplier_id: "S4", metres_available: 7,   min_order_metres: 2 },
      { id: "F5", name: "Navy Senator",       category: "Senator",  color: "#20304a", price_per_metre: 9,  supplier_id: "S5", metres_available: 120, min_order_metres: 2 },
      { id: "F6", name: "Sunburst Ankara",    category: "Ankara",   color: "#e8871e", price_per_metre: 10, supplier_id: "S2", metres_available: 44,  min_order_metres: 2 },
      { id: "F7", name: "Midnight Navy Wool", category: "Wool",     color: "#1f2a44", price_per_metre: 44, supplier_id: "S6", metres_available: 27,  min_order_metres: 2 },
      { id: "F8", name: "Royal Gold Aso Oke", category: "Aso Oke",  color: "#c9a227", price_per_metre: 49, supplier_id: "S3", metres_available: 20,  min_order_metres: 3 },
      { id: "F9", name: "Classic White Linen",category: "Linen",    color: "#f4f1ea", price_per_metre: 17.5, supplier_id: "S7", metres_available: 55, min_order_metres: 1 },
      { id: "F10", name: "Emerald Silk",      category: "Silk",     color: "#1d7a5a", price_per_metre: 38, supplier_id: "S8", metres_available: 13,  min_order_metres: 1 }
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

    // What the customer app is doing right now
    session: { customerId: null },
    draft: null,
    counters: { order: 1008, payment: 0, invoice: 0 }
  };

  // Independent fabric sellers and their market stalls (sellers-data.js)
  addSampleSellers(data);
  data.sample_sellers_added = true;

  // Build sample orders through the same quote maths as the real flow
  const samples = [
    { id: "NT-1001", customer: "C1", outfit: "Dress",     colour: "#c9a24a", embroidery: "None",   sleeve: "Fitted", neck: "V-neck", fabric: "F11",  metres: 4, stage: "sewing",          created: -14, due: 7,   method: "Card" },
    { id: "NT-1002", customer: "C2", outfit: "Suit",      colour: "#1e2a44", embroidery: "None",   sleeve: "Fitted", neck: "V-neck", fabric: "F7",  metres: 4, stage: "cutting",         created: -16, due: -2,  method: "Bank transfer" },
    { id: "NT-1003", customer: "C3", outfit: "Agbada",    colour: "#c9a24a", embroidery: "Gold",   sleeve: "Wide",   neck: "Round",  fabric: "F8",  metres: 7, stage: "quality_control", created: -24, due: 3,   method: "Bank transfer" },
    { id: "NT-1004", customer: "C4", outfit: "Senator",   colour: "#1e2a44", embroidery: "Silver", sleeve: "Fitted", neck: "Round",  fabric: "F5",  metres: 4, stage: "balance_paid",    created: -21, due: 1,   method: "Card", paidInFull: true, delivery: "In transit" },
    { id: "NT-1005", customer: "C1", outfit: "Two Piece", colour: "#2d4f3a", embroidery: "Gold",   sleeve: "Fitted", neck: "Round",  fabric: "F10", metres: 5, stage: "tailor_assigned", created: -2,  due: 12,  method: "Apple Pay" },
    { id: "NT-1006", customer: "C5", outfit: "Bubu",      colour: "#7c1f2e", embroidery: "Gold",   sleeve: "Wide",   neck: "Round",  fabric: "F4",  metres: 5, stage: "delivered",       created: -40, due: -20, method: "Card", paidInFull: true, delivery: "Delivered", review: [5, "Beautiful work and a perfect fit."] },
    { id: "NT-1007", customer: "C5", outfit: "Kaftan",    colour: "#1e2a44", embroidery: "Silver", sleeve: "Wide",   neck: "V-neck", fabric: "F1",  metres: 4, stage: "embroidery",      created: -10, due: 5,   method: "Bank transfer" },
    { id: "NT-1008", customer: "C6", outfit: "Wedding",   colour: "#efe6d2", embroidery: "Gold",   sleeve: "Wide",   neck: "Round",  fabric: "F3",  metres: 8, stage: "fitting",         created: -18, due: 30,  method: "Card" }
  ];

  const staffFor = role => data.staff.find(s => s.role === role).id;

  samples.forEach(s => {
    const fabric = data.fabrics.find(f => f.id === s.fabric);
    const quote = computeQuote(s.outfit, s.embroidery, fabric, s.metres);
    const created = addDays(s.created);
    const deposit = depositFor(quote.total);
    const stageIndex = STAGES.findIndex(st => st.key === s.stage);
    const measurementProfile = data.customers.find(c => c.id === s.customer).measurement_profiles.slice(-1)[0];

    const order = {
      id: s.id, customer_id: s.customer, designer_id: "D1",
      outfit_type: s.outfit, colour: s.colour, embroidery: s.embroidery, sleeve_style: s.sleeve, neck_style: s.neck,
      concept_variation: 1, concept_image_url: "",
      measurement_profile_id: measurementProfile.id,
      fabric_id: fabric.id, fabric_supplier_id: fabric.supplier_id, fabric_metres: s.metres, fabric_cost: quote.fabricCost,
      line_items: quote.lines, quote_total: quote.total,
      deposit_amount: deposit, deposit_paid_at: created, balance_paid_at: null,
      stage: s.stage,
      assigned_staff: {
        cutting: staffFor("cutting"), sewing: s.id === "NT-1007" ? "T3" : staffFor("sewing"),
        embroidery: staffFor("embroidery"), finishing: staffFor("finishing"), quality_control: staffFor("quality_control")
      },
      review_rating: null, review_text: "",
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

  return data;
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
    go("home");
    renderAll();
  }
}

// ---- Lookups ----

function findCustomer(id) { return db.customers.find(c => c.id === id); }
function findFabric(id) { return db.fabrics.find(f => f.id === id); }
function findSupplier(id) { return db.suppliers.find(s => s.id === id); }
function findOrder(id) { return db.orders.find(o => o.id === id); }
function findStaff(id) { return db.staff.find(s => s.id === id); }
function findInvoice(orderId) { return db.invoices.find(i => i.order_id === orderId); }
function findDelivery(orderId) { return db.deliveries.find(d => d.order_id === orderId); }
function designer() { return db.designers[0]; }

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
  let customer = db.customers.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!customer) {
    customer = { id: newId("C", db.customers), name, email: email || "", phone: phone || "", created_at: today(), notes: "", measurement_profiles: [] };
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
  return db.payments.filter(p => p.status === "awaiting_confirmation");
}

function balanceOwed(order) {
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
  if (depositAwaiting(order)) return FIRST_STEP_OF_STAGES - 1; // steps 1–6; the deposit (step 7) isn't confirmed yet
  return FIRST_STEP_OF_STAGES + stageIndex(order) + 1 + (order.review_rating ? 1 : 0);
}

// The step being worked on now, e.g. "Sewing" — or "Complete"
function currentStepLabel(order) {
  if (depositAwaiting(order)) return "Deposit awaiting confirmation";
  const done = stepsDone(order);
  return done >= LIFECYCLE.length ? "Complete" : LIFECYCLE[done];
}

function isOpen(order) {
  return order.stage !== "delivered";
}

function isLate(order) {
  return isOpen(order) && order.due_date < today();
}

// Staff member responsible for the step in progress (if it's a production step)
function staffForCurrentStep(order) {
  const next = STAGES[stageIndex(order) + 1];
  if (!next || !next.role) return null;
  return findStaff(order.assigned_staff[next.role]);
}

// Pick the least busy person for each role when a new order comes in (step 8)
function autoAssignStaff() {
  const assigned = {};
  STAFF_ROLES.forEach(role => {
    const people = db.staff.filter(s => s.role === role.key);
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

// Creates an order once the deposit is paid (step 7) and assigns a tailor (step 8).
// details.confirmed is true when the team takes the deposit itself (a walk-in order);
// a deposit paid in the customer app waits for the team to confirm it.
// In live mode the database creates the order, so this returns a Promise.
function createPaidOrder(details) {
  if (Cloud.live) return Cloud.placeOrder(details);
  const id = nextOrderId();
  const order = {
    id, customer_id: details.customerId, designer_id: designer().id,
    outfit_type: details.outfit, colour: details.colour, embroidery: details.embroidery,
    sleeve_style: details.sleeve, neck_style: details.neck,
    concept_variation: details.variation || 1, concept_image_url: "",
    inspiration: details.inspiration || null,   // customer's style photos, link and note (inspiration.js)
    measurement_profile_id: details.profileId || null,
    fabric_id: details.fabric.id, fabric_supplier_id: details.fabric.supplier_id,
    fabric_metres: details.metres, fabric_cost: details.quote.fabricCost,
    line_items: details.quote.lines, quote_total: details.quote.total,
    deposit_amount: details.deposit, deposit_paid_at: null, balance_paid_at: null,
    stage: "tailor_assigned",
    assigned_staff: autoAssignStaff(),
    review_rating: null, review_text: "",
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

// Designer rating including reviews left in the app
function designerRating() {
  const d = designer();
  if (db.reviews) {
    // Live mode: every review on Wearvia (customers can only see their own orders)
    const count = db.reviews.length;
    const rating = count ? db.reviews.reduce((t, r) => t + r.rating, 0) / count : d.rating;
    return { rating: Number(rating).toFixed(1), count };
  }
  const reviews = db.orders.filter(o => o.review_rating);
  const count = d.review_count + reviews.length;
  const sum = d.rating * d.review_count + reviews.reduce((total, o) => total + o.review_rating, 0);
  return { rating: (sum / count).toFixed(1), count };
}

// ---- Customer summaries (used by the profile and customer screens) ----

function customerOrders(customerId) {
  return db.orders.filter(o => o.customer_id === customerId);
}

// The latest reviews, for the designer's page
function recentReviews(count) {
  if (db.reviews) {
    return db.reviews.slice(-count).reverse().map(r => {
      const order = r.order_id ? findOrder(r.order_id) : null;
      return { rating: r.rating, text: r.review_text, who: order ? customerName(order.customer_id).split(" ")[0] : "A customer", outfit: order ? order.outfit_type : "" };
    });
  }
  return db.orders.filter(o => o.review_rating).slice(-count).reverse().map(o =>
    ({ rating: o.review_rating, text: o.review_text, who: customerName(o.customer_id).split(" ")[0], outfit: o.outfit_type }));
}

function customerSpend(customerId) {
  const orderPayments = customerOrders(customerId).reduce((total, o) => total + amountPaid(o.id), 0);
  const shopSales = db.rtw_sales.filter(s => s.customer_id === customerId && isConfirmed(s)).reduce((total, s) => total + s.price, 0);
  return orderPayments + shopSales;
}

function favouriteColour(customerId) {
  const counts = {};
  customerOrders(customerId).forEach(o => { counts[o.colour] = (counts[o.colour] || 0) + 1; });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return top ? colourName(top) : "—";
}
