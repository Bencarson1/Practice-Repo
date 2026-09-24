// ============================================================
// sellers-data.js — fabric sellers, their fabrics and their orders
//
// Every read and write for the Fabric Seller area goes through the
// functions in this file, so moving to Supabase means changing this
// file (and photos.js) only. The tables match supabase/schema.sql:
//
//   db.suppliers     → fabric_sellers   (every supplier is a seller shop)
//   db.fabrics       → fabrics          (photos → fabric_photos + Storage)
//   db.fabric_orders → fabric_orders    (one row per order that uses a seller's fabric)
//
// A fabric's status is "pending" (waiting for Nebeda Threads),
// "approved" (live in the marketplace) or "hidden" (taken down by
// Nebeda Threads). Deleted fabrics keep their row with deleted_at set,
// so old orders can still show what was bought.
// ============================================================

const FABRIC_TYPES = ["Ankara", "Aso Oke", "Kente", "Lace", "Adire", "Brocade", "Senator", "Cashmere", "Wool", "Linen", "Silk", "Cotton", "Other"];

// Colour families customers filter by. hex is used for swatches.
const FABRIC_COLOURS = [
  { name: "Blue", hex: "#1e3a5f" }, { name: "Navy", hex: "#1f2a44" }, { name: "Gold", hex: "#c9a24a" },
  { name: "Yellow", hex: "#e8c21e" }, { name: "Orange", hex: "#e8871e" }, { name: "Red", hex: "#a3242e" },
  { name: "Burgundy", hex: "#7c1f2e" }, { name: "Pink", hex: "#d98aa0" }, { name: "Purple", hex: "#5b2d7a" },
  { name: "Green", hex: "#1d7a5a" }, { name: "Brown", hex: "#6b4a2b" }, { name: "Black", hex: "#1b1b1b" },
  { name: "White", hex: "#f4f1ea" }, { name: "Ivory", hex: "#efe6d2" }, { name: "Grey", hex: "#8a8a8a" },
  { name: "Multicolour", hex: "#9c6b2f" }
];

const DELIVERY_TIMES = ["Same day", "Next day", "1–3 days", "2–4 days", "3–5 days", "5–7 days", "1–2 weeks"];

const FABRIC_STATUS_LABELS = { pending: "Waiting for approval", approved: "Live", hidden: "Hidden" };

// Which drawn pattern a fabric type uses when it has no photos
const TYPE_PATTERN = {
  Ankara: "ankara", "Aso Oke": "aso_oke", Kente: "kente", Lace: "lace", Adire: "adire", Brocade: "brocade",
  Linen: "linen", Silk: "silk", Senator: "plain", Cashmere: "plain", Wool: "plain", Cotton: "linen"
};

function hexNoHash(hex) { return String(hex || "#1e2a44").replace("#", ""); }

function samplePhotos(kind, colours, count) {
  const text = colours.map(hexNoHash).join("-");
  return [0, 2, 1, 0].slice(0, count || 3).map((view, i) => `pattern:${kind}:${text}:${i === 3 ? 0 : view}`);
}

// ---- Lookups ----

function activeFabrics() {
  return db.fabrics.filter(f => !f.deleted_at);
}

function sellerFabrics(sellerId) {
  return activeFabrics().filter(f => f.supplier_id === sellerId);
}

function currentSeller() {
  return db.session.sellerId ? findSupplier(db.session.sellerId) : null;
}

function isSoldOut(fabric) {
  return !!fabric.sold_out || fabric.metres_available < (fabric.min_order_metres || 0.5);
}

// Customers can see approved fabrics; they can buy them if they are also in stock
function isOnMarket(fabric) {
  return !fabric.deleted_at && fabric.status === "approved";
}

function isBuyable(fabric) {
  return isOnMarket(fabric) && !isSoldOut(fabric);
}

function fabricPhotoRefs(fabric) {
  if (fabric.photos && fabric.photos.length) return fabric.photos;
  // No photos yet: draw a plain swatch in the fabric's colour and type
  return [`pattern:${TYPE_PATTERN[fabric.category] || "plain"}:${hexNoHash(fabric.color)}-c9a24a-efe6d2:0`];
}

function fabricCoverUrl(fabric) {
  return photoUrl(fabricPhotoRefs(fabric)[0]);
}

function sellerLogoUrl(seller) {
  return photoUrl(seller && seller.logo ? seller.logo : `logo:${initialsOf(seller ? seller.name : "?")}:1e2a44`);
}

function sellerRatingText(seller) {
  return seller.rating ? `⭐ ${seller.rating}` : "New seller";
}

function colourFamilyHex(name) {
  const found = FABRIC_COLOURS.find(c => c.name === name);
  return found ? found.hex : "#1e2a44";
}

// Picks the nearest colour family for a hex colour (for fabrics added without one)
function nearestColourName(hex) {
  const rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0);
  const [r, g, b] = rgb(hex);
  let best = FABRIC_COLOURS[0], bestDistance = Infinity;
  FABRIC_COLOURS.filter(c => c.name !== "Multicolour").forEach(c => {
    const [r2, g2, b2] = rgb(c.hex);
    const distance = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (distance < bestDistance) { best = c; bestDistance = distance; }
  });
  return best.name;
}

function nextFabricId(data) {
  const highest = (data || db).fabrics.reduce((max, f) => Math.max(max, Number(f.id.slice(1)) || 0), 0);
  return "F" + (highest + 1);
}

// ---- Marketplace search (what customers see) ----

const PRICE_BANDS = [
  { key: "any", label: "Any price", test: () => true },
  { key: "u10", label: "Under £10/m", test: p => p < 10 },
  { key: "10-25", label: "£10–£25/m", test: p => p >= 10 && p <= 25 },
  { key: "25-50", label: "£25–£50/m", test: p => p > 25 && p <= 50 },
  { key: "50", label: "Over £50/m", test: p => p > 50 }
];

const MARKET_SORTS = [
  { key: "new", label: "Newest" },
  { key: "low", label: "Price: low to high" },
  { key: "high", label: "Price: high to low" }
];

function marketFabrics(filters) {
  const f = filters || {};
  const band = PRICE_BANDS.find(p => p.key === f.price) || PRICE_BANDS[0];
  const words = String(f.search || "").toLowerCase().split(/\s+/).filter(Boolean);
  const list = activeFabrics().filter(fabric => {
    if (!isOnMarket(fabric)) return false;
    if (f.type && f.type !== "All" && fabric.category !== f.type) return false;
    if (f.colour && f.colour !== "All" && fabric.colour_name !== f.colour) return false;
    if (f.seller && f.seller !== "All" && fabric.supplier_id !== f.seller) return false;
    if (f.inStock && isSoldOut(fabric)) return false;
    if (!band.test(fabric.price_per_metre)) return false;
    if (words.length) {
      const seller = findSupplier(fabric.supplier_id);
      const text = [fabric.name, fabric.category, fabric.colour_name, fabric.description, seller && seller.name, seller && seller.location].join(" ").toLowerCase();
      if (!words.every(w => text.includes(w))) return false;
    }
    return true;
  });
  const sorters = {
    new: (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || Number(b.id.slice(1)) - Number(a.id.slice(1)),
    low: (a, b) => a.price_per_metre - b.price_per_metre,
    high: (a, b) => b.price_per_metre - a.price_per_metre
  };
  // Sold-out fabrics go to the end so customers see what they can buy first
  return list.sort((a, b) => (isSoldOut(a) - isSoldOut(b)) || (sorters[f.sort] || sorters.new)(a, b));
}

// ---- Writes by a seller ----

function saveSellerProfile(sellerId, values) {
  let seller = sellerId ? findSupplier(sellerId) : null;
  if (!seller) {
    const highest = db.suppliers.reduce((max, s) => Math.max(max, Number(s.id.slice(1)) || 0), 0);
    seller = { id: "S" + (highest + 1), rating: null, created_at: today(), logo: null };
    db.suppliers.push(seller);
  }
  seller.name = values.name;
  seller.location = values.location;
  seller.phone = values.phone;
  seller.delivery_estimate = values.delivery_estimate;
  if (values.logo !== undefined) seller.logo = values.logo;
  seller.updated_at = today();
  return seller;
}

// Adds or updates one of the seller's fabrics. Changes to what a fabric looks like
// (photos, name, type, colour, description) go back to Nebeda Threads for approval.
function saveSellerFabric(sellerId, fabricId, values) {
  let fabric = fabricId ? findFabric(fabricId) : null;
  if (fabric && fabric.supplier_id !== sellerId) throw new Error("That fabric belongs to another seller.");
  const isNew = !fabric;
  if (isNew) {
    fabric = { id: nextFabricId(), supplier_id: sellerId, status: "pending", sold_out: false, deleted_at: null, created_at: today(), review_note: "" };
    db.fabrics.push(fabric);
  }
  const looksDifferent = !isNew && (
    fabric.name !== values.name || fabric.category !== values.category || fabric.colour_name !== values.colour_name ||
    (fabric.description || "") !== values.description || JSON.stringify(fabric.photos || []) !== JSON.stringify(values.photos));
  Object.assign(fabric, {
    name: values.name, category: values.category, colour_name: values.colour_name, color: colourFamilyHex(values.colour_name),
    price_per_metre: values.price_per_metre, metres_available: values.metres_available,
    min_order_metres: values.min_order_metres, description: values.description, photos: values.photos,
    updated_at: today()
  });
  if (looksDifferent && fabric.status === "approved") {
    fabric.status = "pending";
    fabric.review_note = "";
  }
  return { fabric, isNew, needsReview: fabric.status === "pending" };
}

function setFabricSoldOut(fabricId, soldOut) {
  const fabric = findFabric(fabricId);
  fabric.sold_out = soldOut;
  fabric.updated_at = today();
  return fabric;
}

function deleteSellerFabric(fabricId) {
  const fabric = findFabric(fabricId);
  fabric.deleted_at = today();
  // Photos only matter while someone can see the fabric
  (fabric.photos || []).forEach(ref => PhotoStore.remove(ref));
  fabric.photos = [];
  return fabric;
}

// ---- Writes by Nebeda Threads ----

function reviewFabric(fabricId, status, note) {
  const fabric = findFabric(fabricId);
  fabric.status = status;
  fabric.review_note = note || "";
  fabric.reviewed_at = today();
  return fabric;
}

// ---- Seller orders ----

function sellerOrders(sellerId) {
  return db.fabric_orders.filter(o => o.seller_id === sellerId).slice().sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

function fabricOrderFor(order) {
  const fabric = findFabric(order.fabric_id);
  return {
    id: "FO-" + order.id.split("-")[1], order_id: order.id, seller_id: fabric ? fabric.supplier_id : order.fabric_supplier_id,
    fabric_id: order.fabric_id, fabric_name: fabric ? fabric.name : "Fabric", metres: order.fabric_metres,
    price_per_metre: fabric ? fabric.price_per_metre : order.fabric_cost / order.fabric_metres, total: order.fabric_cost,
    customer_id: order.customer_id, deliver_to: `${SHOP_NAME}, ${designer().location}`,
    status: "new", created_at: order.created_at, sent_at: null
  };
}

// Called when a customer pays their deposit (or a walk-in order is taken)
function recordFabricOrder(order) {
  if (db.fabric_orders.some(o => o.order_id === order.id)) return;
  db.fabric_orders.push(fabricOrderFor(order));
}

function markFabricOrderSent(fabricOrderId) {
  const row = db.fabric_orders.find(o => o.id === fabricOrderId);
  if (!row || row.status !== "new") return null;
  row.status = "sent";
  row.sent_at = today();
  return row;
}

function cancelFabricOrder(orderId) {
  db.fabric_orders.forEach(o => { if (o.order_id === orderId) o.status = "cancelled"; });
}

// ---- Sample sellers ----

function sampleSellers() {
  return [
    { id: "S9",  name: "Mama Titi Wax Prints", location: "Peckham, London", phone: "07700 900301", delivery_estimate: "Next day", rating: 4.8, logo: "logo:MT:7c1f2e" },
    { id: "S10", name: "Kente Corner",         location: "Birmingham",      phone: "07700 900302", delivery_estimate: "1–3 days", rating: 4.7, logo: "logo:KC:2d4f3a" },
    { id: "S11", name: "Indigo Adire Studio",  location: "Abeokuta, Ogun",  phone: "+234 803 555 0142", delivery_estimate: "5–7 days", rating: 4.9, logo: "logo:IA:1e3a5f" },
    { id: "S12", name: "Lace Lounge",          location: "Manchester",      phone: "07700 900304", delivery_estimate: "1–3 days", rating: 4.6, logo: "logo:LL:8a6d1f" }
  ];
}

function sampleSellerFabrics() {
  const f = (id, seller, name, type, colour, price, stock, min, kind, colours, description, extra) => Object.assign({
    id, name, category: type, colour_name: colour, color: colours[0], price_per_metre: price, supplier_id: seller,
    metres_available: stock, min_order_metres: min, description, photos: samplePhotos(kind, colours, 3),
    status: "approved", sold_out: false, deleted_at: null, created_at: addDays(-Number(id.slice(1))), review_note: ""
  }, extra || {});
  return [
    f("F11", "S9", "Blue Harvest Ankara", "Ankara", "Blue", 9.5, 60, 2, "ankara", ["#1e3a5f", "#e8871e", "#f4f1ea"],
      "Bright Dutch-style wax print with orange rings on deep blue. 100% cotton, 116 cm wide. Holds its colour wash after wash."),
    f("F12", "S9", "Sunset Swirl Ankara", "Ankara", "Orange", 11, 35, 2, "ankara", ["#e8871e", "#7c1f2e", "#e8c21e"],
      "Warm orange and burgundy swirls. Lovely for Bubu, two pieces and headwraps. Cotton, 116 cm wide."),
    f("F13", "S9", "Kola Nut Wax Print", "Ankara", "Green", 12, 6, 2, "ankara", ["#2d4f3a", "#c9a24a", "#efe6d2"],
      "Green and gold kola nut print. Our best seller — back soon.", { sold_out: true }),
    f("F14", "S10", "Royal Kente Strip", "Kente", "Gold", 32, 25, 2, "kente", ["#c9a227", "#1d7a5a", "#a3242e"],
      "Hand-woven kente strips in gold, green and red, sewn into full-width cloth. Ideal for weddings and naming ceremonies."),
    f("F15", "S10", "Emerald Kente", "Kente", "Green", 34, 8, 2, "kente", ["#1d7a5a", "#c9a227", "#1b1b1b"],
      "Emerald and gold kente with black accents. Only a few metres left from this weave."),
    f("F16", "S11", "Indigo Adire Eleko", "Adire", "Blue", 14, 30, 2, "adire", ["#1f2a5f", "#dfe6f4", "#f4f1ea"],
      "Hand-dyed indigo adire using the starch-resist method. Every metre is slightly different. Cotton, 110 cm wide."),
    f("F17", "S11", "Midnight Adire Oniko", "Adire", "Navy", 15, 22, 2, "adire", ["#141b3a", "#8fa3cf", "#f4f1ea"],
      "Tie-dyed oniko circles on midnight indigo. Soft cotton that gets better with every wash.", { status: "pending" }),
    f("F18", "S12", "Ivory Cord Lace", "Lace", "Ivory", 28, 18, 1, "lace", ["#efe6d2", "#ffffff", "#c9a24a"],
      "Ivory cord lace with a scalloped edge. Perfect for bridal and engagement outfits. 130 cm wide."),
    f("F19", "S12", "Rose Gold Beaded Lace", "Lace", "Pink", 65, 12, 1, "lace", ["#d98aa0", "#c9a24a", "#fff4f0"],
      "Heavy beaded lace with rose-gold sequins, hand-finished. For statement aso ebi and evening wear."),
    f("F20", "S12", "Champagne French Lace", "Lace", "Gold", 48, 15, 1, "lace", ["#d8c089", "#fff8e8", "#8a6d1f"],
      "Light French lace in champagne.", { status: "hidden", review_note: "Photos don't show the fabric clearly. Please add a close-up." })
  ];
}

// Descriptions and photos for the first ten sample fabrics
const FIRST_FABRIC_DETAILS = {
  F1:  ["Blue", "plain", ["#1e3a5f", "#3b5b85", "#c9a24a"], "Soft Italian cashmere with a gentle drape. Warm without being heavy — ideal for kaftans and winter senators."],
  F2:  ["Gold", "ankara", ["#c9a24a", "#1e2a44", "#efe6d2"], "Classic gold and navy wax print. 100% cotton, 116 cm wide."],
  F3:  ["Burgundy", "aso_oke", ["#7c1f2e", "#c9a24a", "#efe6d2"], "Hand-loomed aso oke from Iseyin in deep burgundy with gold threads. Traditional for weddings."],
  F4:  ["Gold", "lace", ["#8a6d1f", "#e8c77a", "#fff2cc"], "Gold cord lace with a scalloped border. A favourite for bubu and aso ebi."],
  F5:  ["Navy", "plain", ["#20304a", "#3d5070", "#c9a24a"], "Smooth navy senator material. Crease-resistant, easy to wear all day."],
  F6:  ["Orange", "ankara", ["#e8871e", "#7c1f2e", "#f4e3a1"], "Sunburst print in orange and burgundy. Cotton, 116 cm wide."],
  F7:  ["Navy", "plain", ["#1f2a44", "#2f3c5a", "#8a8a8a"], "Fine Scottish wool suiting in midnight navy. Sharp tailoring, keeps its shape."],
  F8:  ["Gold", "aso_oke", ["#c9a227", "#7c1f2e", "#fff2cc"], "Royal gold aso oke, hand-woven. Stiff enough for a grand agbada."],
  F9:  ["White", "linen", ["#f4f1ea", "#c8bfa8", "#a89c80"], "Breathable Irish linen. Cool in summer, softens with every wash."],
  F10: ["Green", "silk", ["#1d7a5a", "#7fd1b0", "#0e3d2c"], "Emerald silk with a rich sheen. Beautiful for two pieces and evening dresses."]
};

// Adds the sample sellers and their fabrics (with new ids if a saved fabric already uses one)
function addSampleSellers(data) {
  sampleSellers().forEach(s => {
    if (!data.suppliers.some(existing => existing.id === s.id)) data.suppliers.push(Object.assign({ created_at: addDays(-200) }, s));
  });
  sampleSellerFabrics().forEach(fabric => {
    if (data.fabrics.some(f => f.id === fabric.id)) fabric.id = nextFabricId(data);
    data.fabrics.push(fabric);
  });
}

// Brings any saved data up to date with the fields this version uses.
// Safe to run more than once.
function upgradeData(data) {
  data.session = data.session || {};
  if (data.session.sellerId === undefined) data.session.sellerId = null;

  data.suppliers.forEach(s => {
    if (s.phone === undefined) s.phone = "07700 9004" + String(Number(s.id.slice(1)) || 0).padStart(2, "0");
    if (s.logo === undefined) s.logo = null;
    if (!s.created_at) s.created_at = "2025-01-01";
  });

  if (!data.sample_sellers_added) {
    addSampleSellers(data);
    data.sample_sellers_added = true;
  }

  data.fabrics.forEach(f => {
    const details = FIRST_FABRIC_DETAILS[f.id];
    if (!f.status) f.status = "approved";
    if (f.sold_out === undefined) f.sold_out = false;
    if (f.deleted_at === undefined) f.deleted_at = null;
    if (!f.colour_name) f.colour_name = details ? details[0] : nearestColourName(f.color);
    if (f.description === undefined) f.description = details ? details[3] : "";
    if (!f.photos) f.photos = details ? samplePhotos(details[1], details[2], 3) : [];
    if (!f.created_at) f.created_at = "2025-01-01";
    if (f.review_note === undefined) f.review_note = "";
  });

  if (!data.fabric_orders) {
    data.fabric_orders = [];
    const previous = db;
    db = data; // fabricOrderFor reads through the usual lookups
    data.orders.forEach(order => {
      const row = fabricOrderFor(order);
      if (order.stage !== "tailor_assigned") { row.status = "sent"; row.sent_at = addDays(1, order.created_at); }
      data.fabric_orders.push(row);
    });
    db = previous;
  }
  data.version = 3;
  return data;
}
