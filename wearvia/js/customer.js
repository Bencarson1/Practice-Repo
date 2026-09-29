// ============================================================
// customer.js — the customer app: design, send to the tailor, chat,
// accept the quote, pay, track, review
// Follows the order lifecycle in WEARVIA-SPEC.md exactly:
//   1 outfit & design → 2 style reference / AI variation → 3 measurements → 4 fabric → send to tailor →
//   5 tailor's quote (the tailor decides the yards in the chat) → 6 accept (fabric bought) →
//   7 deposit → (8–15 production) → 16 review
// ============================================================

// Steps 1–4 happen in the customer app, one screen each, ending with "Send to tailor".
// Nothing is bought and there's no price yet: the tailor agrees the yards with
// the customer in the order's chat, then sends the quote.
const FLOW = [
  { screen: "design", label: "Design" },
  { screen: "concept", label: "Concept" },
  { screen: "measurements", label: "Measure" },
  { screen: "fabric", label: "Fabric" },
  { screen: "send", label: "Send" }
];

// What must be done before each screen can open, and where to send the customer if it isn't
const FLOW_REQUIRES = {
  concept: ["designDone"],
  measurements: ["designDone", "conceptApproved"],
  fabric: ["designDone", "conceptApproved", "profileId"],
  send: ["designDone", "conceptApproved", "profileId"]
};
const FLAG_SCREEN = { designDone: "design", conceptApproved: "concept", profileId: "measurements" };

let balanceMethod = "Card";
let depositMethod = "Card";
let reviewStars = 5;
let flashMessage = "";

function newDraft() {
  return {
    outfit: "Agbada", colour: "#1e2a44", embroidery: "Gold", sleeve: "Wide", neck: "Round",
    variation: 1, designDone: false, conceptApproved: false, profileId: null,
    fabricId: null, fabricPlan: "marketplace", fabricFilter: "All", inspiration: null, tailorNote: ""
  };
}

function draft() {
  if (!db.draft) db.draft = newDraft();
  return db.draft;
}

function currentCustomer() {
  return db.session.customerId ? findCustomer(db.session.customerId) : null;
}

// Returns the screen the customer should be sent to instead, or null if they can stay
function flowRedirect(screen) {
  const needs = FLOW_REQUIRES[screen];
  if (!needs) return null;
  const d = draft();
  const missing = needs.find(flag => !d[flag]);
  return missing ? FLAG_SCREEN[missing] : null;
}

// ---- Shared pieces of the customer layout ----

function cTop(title, backTo) {
  return `<div class="c-topbar">
    ${backTo ? `<button class="back" onclick="back('${backTo}')" aria-label="Back">‹</button>` : ""}
    <span class="c-title">${title}</span>
  </div>`;
}

function cNav(active) {
  const customer = currentCustomer();
  const unread = customer ? unreadTotal(customerOrders(customer.id), "customer") : 0;
  const item = (screen, icon, label, badge) =>
    `<button class="item ${active === screen ? "on" : ""}" onclick="go('${screen}')"><span aria-hidden="true">${icon}</span>${label}${badge || ""}</button>`;
  return `<nav class="bottomnav" aria-label="Customer menu">
    ${item("home", "🏠", "Home")}
    ${item("orders", "📦", "Orders", unreadBadge(unread, "in your orders"))}
    <button class="plus" onclick="startOrder()" aria-label="Start an order">+</button>
    ${item("market", "🧶", "Fabrics")}
    ${item("tailors", "📍", "Tailors")}
    ${item("profile", "👤", "Profile")}
  </nav>`;
}

function flowBar(screen) {
  const current = FLOW.findIndex(f => f.screen === screen);
  return `<ol class="flowbar" aria-label="Order steps">
    ${FLOW.map((f, i) => `<li class="${i < current ? "done" : i === current ? "now" : ""}"><span></span>${f.label}</li>`).join("")}
  </ol>`;
}

function flash() {
  if (!flashMessage) return "";
  const html = `<div class="notice">${escapeHtml(flashMessage)}</div>`;
  flashMessage = "";
  return html;
}

// ---- Changing earlier choices undoes later steps ----
// (Nothing is bought while choosing, so there's no stock to put back.)

function resetAfterDesign() {
  const d = draft();
  d.conceptApproved = false;
  d.profileId = null;
}

function setDesign(key, value) {
  const d = draft();
  if (d[key] === value) return;
  d[key] = value;
  if (d.conceptApproved) resetAfterDesign();
  saveData();
  renderAll();
}

function startOver() {
  if (!confirm("Start a new order? Your current choices will be cleared.")) return;
  clearDraftInspiration();
  db.draft = newDraft();
  saveData();
  go("outfit");
}

// ---- Screen 1: Home ----

function screenHome() {
  const d = db.draft;
  const inProgress = d && d.designDone;
  const resume = inProgress ? FLOW.slice().reverse().find(f => !flowRedirect(f.screen)) : null;

  const tailors = (db.designers || [])
    .filter(t => (t.admin_status || "approved") === "approved" && t.custom_orders !== false)
    .slice()
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
    .slice(0, 6);

  const fabrics = (db.fabrics || [])
    .filter(f => f.status === "approved" && !f.deleted_at && !f.sold_out && Number(f.yards_available || 0) > 0)
    .slice(0, 8);

  const readyToWear = (db.ready_to_wear || [])
    .filter(i => i.active !== false)
    .slice()
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured))
    .slice(0, 6);

  const home = db.homepage || {};
  const categoryPhotos = {
    Agbada: home.category_agbada || "https://images.unsplash.com/photo-1782566208081-6b5135fddf23?auto=format&fit=crop&w=700&q=82",
    Kaftan: home.category_kaftan || "https://images.unsplash.com/photo-1776880470534-2e19345ab02b?auto=format&fit=crop&w=700&q=82",
    Senator: home.category_senator || "https://images.unsplash.com/photo-1775754787083-238dd19e1545?auto=format&fit=crop&w=700&q=82",
    Bubu: home.category_bubu || "https://images.unsplash.com/photo-1663044022557-7d5d4c1d5318?auto=format&fit=crop&w=700&q=82",
    "Two Piece": home.category_two_piece || "https://images.unsplash.com/photo-1663043994777-7ed4b4e6cba3?auto=format&fit=crop&w=700&q=82",
    Dress: home.category_dress || "https://images.unsplash.com/photo-1648328414427-fc902f51808c?auto=format&fit=crop&w=700&q=82",
    Wedding: home.category_wedding || "https://images.unsplash.com/photo-1648328414427-fc902f51808c?auto=format&fit=crop&w=700&q=82",
    Suit: home.category_suit || "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=700&q=82"
  };
  const hiddenCategories = new Set(String(home.hidden_categories || "").split(",").map(x => x.trim()).filter(Boolean));
  const orderNames = String(home.category_order || "Agbada,Kaftan,Senator,Bubu,Two Piece,Dress,Wedding,Suit").split(",").map(x => x.trim()).filter(Boolean);
  const outfitByName = new Map(OUTFITS.map(o => [o.name, o]));
  const categories = orderNames.map(name => outfitByName.get(name)).filter(Boolean).filter(o => !hiddenCategories.has(o.name)).slice(0, 8);

  const heroImage = home.hero_image || "https://images.unsplash.com/photo-1648328414427-fc902f51808c?auto=format&fit=crop&w=1600&q=88";
  const heroTitle = home.hero_title || "Everything Fashion, All in One Place.";
  const heroText = home.hero_text || "Discover trusted tailors, shop fabrics, explore ready-to-wear and manage your custom order in one marketplace.";

  return `
    <div class="market-home customer-home-vintage">

      <header class="customer-shop-header">
        <a class="customer-shop-logo" href="#/" aria-label="NebedaHub home">
          <img src="assets/nebedahub-logo.svg" alt="NebedaHub">
        </a>

        <div class="market-home-search customer-shop-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Search outfits, fabrics, tailors and fashion"
            aria-label="Search NebedaHub"
            onkeydown="if(event.key==='Enter'){homeSearch(this.value)}">
          <button onclick="homeSearch(this.previousElementSibling.value)">Search</button>
        </div>

        <div class="customer-shop-actions">
          <button onclick="go('orders')">Orders</button>
          <button onclick="go('account')">Account</button>
        </div>
      </header>

      <nav class="customer-shop-nav" aria-label="Customer marketplace navigation">
        <button onclick="go('outfit')">Outfits</button>
        <button onclick="go('market')">Fabrics</button>
        <button onclick="go('tailors')">Tailors</button>
        <a href="#customer-how-it-works">How it works</a>
      </nav>

      <section class="customer-hero-banner" style="--customer-hero:url('${escapeHtml(heroImage)}')">
        <div class="customer-hero-overlay"></div>
        <div class="customer-hero-content">
          <span class="market-kicker">NEBEDAHUB MARKETPLACE</span>
          <h1>${escapeHtml(heroTitle)}</h1>
          <p>${escapeHtml(heroText)}</p>
          <div class="customer-hero-actions">
            <button class="market-primary" onclick="startOrder()">Start an order</button>
            <button class="market-secondary" onclick="go('tailors')">Find tailors near me</button>
          </div>
          ${resume ? `<button class="market-resume customer-resume" onclick="go('${resume.screen}')">Continue your ${escapeHtml(d.outfit)} order${draftHasTailor() ? ` with ${escapeHtml(draftDesigner().business_name)}` : ""} →</button>` : ""}
        </div>
      </section>

      <section class="customer-quick-row" aria-label="Shop categories">
        <button onclick="startOrder()"><b>Custom outfits</b><span>Design and order</span></button>
        <button onclick="go('rtw')"><b>Ready to Wear</b><span>Shop finished pieces</span></button>
        <button onclick="go('market')"><b>Fabrics</b><span>Browse marketplace fabrics</span></button>
        <button onclick="go('tailors')"><b>Tailors</b><span>Find a professional</span></button>
      </section>

      <section class="market-section customer-popular-tailors">
        <div class="market-section-head">
          <div><span class="market-kicker">Professionals</span><h2>Popular Tailors</h2></div>
          <button class="market-text-link" onclick="go('tailors')">See all tailors →</button>
        </div>
        ${tailors.length ? `
          <div class="market-tailor-grid">
            ${tailors.map(t => `<a class="market-tailor-card" href="#/tailor/${encodeURIComponent(t.slug || t.id)}">
              <img src="${escapeHtml(photoUrl(t.profile_image) || photoUrl(`logo:${initialsOf(t.business_name)}:7a1f2b`))}" alt="">
              <span>
                <b>${escapeHtml(t.business_name)}</b>
                <small>${escapeHtml(tailorAreaText(t) || t.location || "Tailor")}</small>
                <small class="market-rating">${tailorRatingText(t)}</small>
              </span>
            </a>`).join("")}
          </div>`
          : `<div class="market-empty-card"><b>More tailors are joining.</b><span>Search your area to see who is available.</span><button onclick="go('tailors')">Find tailors</button></div>`}
      </section>

      <section class="market-section">
        <div class="market-section-head">
          <div><span class="market-kicker">Shop materials</span><h2>Fabric Marketplace</h2></div>
          <button class="market-text-link" onclick="go('market')">Browse all fabrics →</button>
        </div>
        ${fabrics.length ? `
          <div class="market-home-products">
            ${fabrics.map(f => {
              const seller = findSupplier(f.supplier_id);
              const unit = screenFabricUnit();
              return `<button class="market-home-product" onclick="go('fabricView/${f.id}')">
                <span class="market-home-product-image"><img src="${fabricCoverUrl(f)}" alt="${escapeHtml(f.name)}"></span>
                <b>${escapeHtml(f.name)}</b>
                <span class="market-home-price">${escapeHtml(fabricPriceText(f, unit))}</span>
                <small>${escapeHtml(seller ? seller.name : "Fabric seller")}</small>
              </button>`;
            }).join("")}
          </div>`
          : `<div class="market-empty-card"><b>Fabric sellers are joining NebedaHub.</b><span>You can still start an order and let your tailor help with fabric.</span><button onclick="startOrder()">Start an order</button></div>`}
      </section>

      <section class="market-section">
        <div class="market-section-head">
          <div><span class="market-kicker">Explore styles</span><h2>Popular Outfit Categories</h2></div>
          <button class="market-text-link" onclick="startOrder()">View all outfits →</button>
        </div>
        <div class="market-category-grid">
          ${categories.map(o => {
            const photo = categoryPhotos[o.name] || categoryPhotos.Dress;
            return `<button class="market-category-card" onclick="startHomeOutfit('${escapeHtml(o.name)}')">
              <span class="market-category-art"><img src="${escapeHtml(photo)}" alt="${escapeHtml(o.name)} fashion" loading="lazy"></span>
              <span class="market-category-copy"><b>${escapeHtml(o.name)}</b><small>Request a tailor quote</small></span>
            </button>`;
          }).join("")}
        </div>
      </section>

      <section class="market-section">
        <div class="market-section-head">
          <div><span class="market-kicker">Shop now</span><h2>Ready to Wear</h2></div>
          <button class="market-text-link" onclick="go('rtw')">Open the shop →</button>
        </div>
        ${readyToWear.length ? `<div class="rtw-product-grid home-rtw-grid">${readyToWear.map(rtwProductCard).join("")}</div>`
          : `<div class="market-empty-card"><b>Ready-to-wear shops are opening.</b><span>Approved designers can publish finished products here.</span><button onclick="go('tailors')">Browse designers</button></div>`}
      </section>

      <section class="customer-trust-strip">
        <div><b>Verified marketplace</b><span>Approved tailors and fabric sellers</span></div>
        <div><b>Quote before payment</b><span>Review the full quote first</span></div>
        <div><b>Order protection</b><span>Keep your order journey on NebedaHub</span></div>
        <div><b>Connected support</b><span>Design, chat and tracking stay together</span></div>
      </section>

      <section class="market-service-grid" id="customer-how-it-works">
        <div><b>1. Choose a style</b><span>Start with an outfit or upload your inspiration.</span></div>
        <div><b>2. Choose a tailor</b><span>Find a professional that suits your order.</span></div>
        <div><b>3. Add fabric</b><span>Choose marketplace fabric or ask your tailor to recommend one.</span></div>
        <div><b>4. Review and track</b><span>See your quote and follow production from one place.</span></div>
      </section>

      <section class="market-join-panel">
        <div>
          <span class="market-kicker">Join the marketplace</span>
          <h2>Sell fashion services or fabrics</h2>
          <p>Build your business on NebedaHub.</p>
        </div>
        <div class="market-join-actions">
          <a href="${escapeHtml(appUrl("business", "welcome"))}">Join as tailor or designer</a>
          <a href="${escapeHtml(appUrl("seller", "welcome"))}">Join as fabric seller</a>
        </div>
      </section>

      <footer class="customer-market-footer">
        <span>© NebedaHub</span>
        <a href="#customer-how-it-works">How it works</a>
        <a href="${escapeHtml(appUrl("business", "welcome"))}">For tailors</a>
        <a href="${escapeHtml(appUrl("seller", "welcome"))}">For fabric sellers</a>
      </footer>
    </div>
    ${cNav("home")}`;
}

function homeSearch(value) {
  const q = String(value || "").trim();
  if (!q) return;
  marketFilters.search = q;
  go("market");
}

function startHomeOutfit(outfit) {
  const d = draft();
  d.outfit = outfit;
  saveData();
  startOrder();
}

// "Start an Order": the customer picks their tailor first (Find tailors near
// me → a tailor → Request a quote), then designs the outfit for them
let pickingTailor = false;

function draftHasTailor() {
  const d = db.draft;
  return !!(d && d.designerId && designerById(d.designerId));
}

function startOrder() {
  if (draftHasTailor()) { go("outfit"); return; }
  pickingTailor = true;
  go("tailors");
}

// ---- Screen 2: Outfit picker (step 1) ----

function screenOutfit() {
  const d = draft();
  const photos = hasInspiration(d.inspiration) ? d.inspiration.photos.length : 0;
  return `
    ${cTop("What do you want made?", "home")}
    <div class="content">
      ${flowBar("design")}
      <div class="chip-grid">
        ${OUTFITS.map(o => `<button class="chip ${d.outfit === o.name ? "sel" : ""}" onclick="setDesign('outfit','${o.name}')">
          ${o.name}<span class="chip-sub">Price set by your tailor</span></button>`).join("")}
      </div>
      <p class="meta centre">NebedaHub does not set tailoring prices. Your chosen tailor sends you a quote after reviewing your request.</p>
      <button class="style-cta" onclick="go('inspiration')">
        <span class="style-cta-icon" aria-hidden="true">📷</span>
        <span>${photos ? `<b>Your style photos (${photos})</b><small>Tap to add, change or remove</small>`
          : `<b>I have a photo of the style I want</b><small>Upload screenshots from Instagram, TikTok, Pinterest or your camera</small>`}</span>
        <span aria-hidden="true">›</span>
      </button>
      <button class="cta" onclick="go('design')">Design &amp; Customise →</button>
      ${d.designDone || photos ? `<button class="linkish" onclick="startOver()">Start over</button>` : ""}
    </div>
    ${cNav("outfit")}`;
}

// ---- Screen 3: Design & customise (step 1) ----

function screenDesign() {
  const d = draft();
  const opts = (key, list) => list.map(v =>
    `<button class="optbtn ${d[key] === v ? "sel" : ""}" onclick="setDesign('${key}','${v}')">${v}</button>`).join("");
  return `
    ${cTop("Design Your " + escapeHtml(d.outfit), "outfit")}
    <div class="content">
      ${flowBar("design")}
      ${hasInspiration(d.inspiration) ? `
        <button class="insp-strip" onclick="go('inspiration')">
          <span class="insp-strip-photos">${d.inspiration.photos.slice(0, 3).map(ref => `<img src="${photoUrl(ref)}" alt="">`).join("")}</span>
          <span><b>${d.inspiration.photos.length} style photo${d.inspiration.photos.length === 1 ? "" : "s"} attached</b><small>Edit photos, link or note</small></span><span aria-hidden="true">›</span>
        </button>
        <div class="meta">Pick the options closest to your photos. They help your tailor understand the work and prepare your quote. Anything different goes in your note.</div>` : ""}
      <div class="selopt"><span class="fl">Colour <b>${escapeHtml(colourName(d.colour))}</b></span>
        <span class="swatches">
          ${COLOURS.map(c => `<button class="sw ${d.colour === c.hex ? "sel" : ""}" style="background:${c.hex}" title="${c.name}" aria-label="${c.name}" onclick="setDesign('colour','${c.hex}')"></button>`).join("")}
        </span>
      </div>
      <div class="selopt"><span class="fl">Embroidery</span><span class="optbtns">${opts("embroidery", EMBROIDERY.map(e => e.name))}</span></div>
      <div class="selopt"><span class="fl">Sleeve</span><span class="optbtns">${opts("sleeve", SLEEVES)}</span></div>
      <div class="selopt"><span class="fl">Neck</span><span class="optbtns">${opts("neck", NECKS)}</span></div>
      <button class="cta" onclick="generateConcept()">${hasInspiration(d.inspiration) ? "Use My Uploaded Style →" : "Preview My Design →"}</button>
    </div>`;
}

function generateConcept() {
  const d = draft();
  d.designDone = true;
  saveData();
  go("concept");
}

// ---- Screen 4: style reference or design preview (step 2) ----

let conceptGenerating = false;

function screenConcept() {
  const d = draft();
  const hasStyle = hasInspiration(d.inspiration);
  const busy = conceptGenerating;

  if (hasStyle) {
    return `
      ${cTop("Your Style Reference", "design")}
      <div class="content">
        ${flowBar("concept")}
        ${inspirationBlock("draft", d.inspiration)}
        <div class="notice">
          <b>Your uploaded photos are the design reference.</b>
          <div class="meta">You can use the original style exactly, or ask AI for three faithful variations. The original photos always stay attached for your tailor.</div>
        </div>
        ${d.inspiration && d.inspiration.note ? `<div class="card"><b>Your requested changes</b><p>${escapeHtml(d.inspiration.note)}</p></div>` : ""}
        ${aiVariationPanel(d.inspiration)}
        ${selectedStyleSummary(d.inspiration)}
        <button class="cta" onclick="approveConcept()">${d.inspiration && d.inspiration.aiSelected ? "Use Selected AI Variation →" : "Use Original Style →"}</button>
        <button class="btn-outline" onclick="go('inspiration')">Edit photos or instructions</button>
        <button class="linkish" onclick="go('design')">Change design options</button>
      </div>`;
  }

  return `
    ${cTop("Design Preview", "design")}
    <div class="content">
      ${flowBar("concept")}
      <div class="notice">
        <b>This is a simple preview, not an AI copy of a real garment.</b>
        <div class="meta">It only reflects the outfit type, colour, neckline, sleeves and embroidery options you selected.</div>
      </div>
      <div class="fab-card concept">
        <div class="concept-art ${busy ? "generating" : ""}" aria-busy="${busy}">
          ${conceptSVG(d, d.variation)}
          ${busy ? `<div class="gen-overlay" role="status"><span class="gen-spin"></span>Updating…</div>` : ""}
        </div>
        <div class="name">${escapeHtml(d.outfit)} · ${escapeHtml(d.embroidery)} embroidery · ${escapeHtml(d.sleeve)} sleeve</div>
        <div class="meta">${escapeHtml(colourName(d.colour))} · ${escapeHtml(d.neck)} neck · visual preview based on your choices</div>
      </div>
      <div class="optbtns two">
        <button class="optbtn" onclick="regenerateConcept()" ${busy ? "disabled" : ""}>↻ Another Preview</button>
        <button class="optbtn sel" onclick="approveConcept()" ${busy ? "disabled" : ""}>✓ Use This Design</button>
      </div>
      <button class="style-cta" onclick="go('inspiration')">
        <span class="style-cta-icon" aria-hidden="true">📷</span>
        <span><b>Have a photo of the style?</b><small>Upload it and your tailor will receive the original reference</small></span>
        <span aria-hidden="true">›</span>
      </button>
      <button class="linkish" onclick="go('design')">Change my options</button>
    </div>`;
}

function regenerateConcept() {
  if (conceptGenerating || hasInspiration(draft().inspiration)) return;
  conceptGenerating = true;
  renderAll();
  setTimeout(() => {
    const d = draft();
    d.variation += 1;
    d.conceptApproved = false;
    conceptGenerating = false;
    saveData();
    renderAll();
  }, 500);
}

function approveConcept() {
  draft().conceptApproved = true;
  saveData();
  go("measurements");
}

// ---- Screen 5: Measurements (step 3) ----

// Measurements are saved in inches; the customer types and sees them in inches or centimetres
function measurementRows(values, unit) {
  const cm = unit === "cm";
  return MEASUREMENT_FIELDS.map(f => `
    <label class="mrow"><span>${f.label}${f.required ? "" : ' <small class="fl">(optional)</small>'}</span>
      <span><input name="${f.key}" type="number" inputmode="decimal" min="${cm ? 2 : 1}" max="${cm ? 300 : 120}" step="${cm ? 0.5 : 0.25}" value="${values && values[f.key] != null ? bodyValue(values[f.key], unit) : ""}" ${f.required ? "required" : ""}> <span class="unit-word">${cm ? "cm" : "in"}</span></span>
    </label>`).join("");
}

// The unit the customer measures in: their profile's, or (before they have one) this device's
let draftBodyUnit = null;
function currentBodyUnit() {
  const customer = currentCustomer();
  if (customer && customer.measurement_unit) return customer.measurement_unit;
  return draftBodyUnit || customerBodyUnit(null);
}

function bodyUnitToggle(formId) {
  const unit = currentBodyUnit();
  return `<div class="selopt unit-toggle"><span class="fl">Measure in</span><span class="optbtns" role="group" aria-label="Measurement unit">
    <button type="button" class="optbtn ${unit === "in" ? "sel" : ""}" aria-pressed="${unit === "in"}" onclick="switchBodyUnit('in', '${formId}')">Inches</button>
    <button type="button" class="optbtn ${unit === "cm" ? "sel" : ""}" aria-pressed="${unit === "cm"}" onclick="switchBodyUnit('cm', '${formId}')">Centimetres</button></span></div>`;
}

// Changes the unit without losing what's been typed: the numbers on the form are converted
function switchBodyUnit(unit, formId) {
  const form = document.getElementById(formId);
  const before = form ? form.dataset.unit : currentBodyUnit();
  if (before === unit) return;
  const typed = {};
  if (form) MEASUREMENT_FIELDS.forEach(f => { typed[f.key] = inchesFrom(form[f.key].value, before); });
  const customer = currentCustomer();
  if (customer) customer.measurement_unit = unit; else draftBodyUnit = unit;
  saveData();
  renderAll();
  const again = document.getElementById(formId);
  if (again) MEASUREMENT_FIELDS.forEach(f => { again[f.key].value = typed[f.key] == null ? "" : bodyValue(typed[f.key], unit); });
}

function screenMeasurements() {
  const customer = currentCustomer();
  const latest = latestProfile(customer);
  const older = customer ? customer.measurement_profiles.filter(p => p.label !== thisYear()) : [];
  return `
    ${cTop("My Measurements", "concept")}
    <div class="content">
      ${flowBar("measurements")}
      <form id="flow-measure-form" class="stack" data-unit="${currentBodyUnit()}" onsubmit="return saveFlowMeasurements(event)">
        ${customer ? `<div class="meta">Saving to <b>${escapeHtml(customer.name)}</b>'s ${thisYear()} measurement profile.</div>` : `
          <div class="meta">Your measurements are saved to your profile so you only enter them once a year.</div>
          <label class="field">Your name<input name="name" required autocomplete="name"></label>
          <label class="field">Email<input name="email" type="email" autocomplete="email"></label>
          <label class="field">Phone${phoneFieldHtml("phone", "", browserCountry())}</label>`}
        ${bodyUnitToggle("flow-measure-form")}
        ${older.length ? `<div class="optbtns">${older.map(p => `<button type="button" class="optbtn" onclick="copyProfile('${p.id}')">Copy from ${p.label}</button>`).join("")}</div>` : ""}
        <div>${measurementRows(latest && latest.label === thisYear() ? latest : null, currentBodyUnit())}</div>
        <button class="cta" type="submit">Save &amp; Choose Fabric →</button>
      </form>
    </div>`;
}

function copyProfile(profileId) {
  const profile = findProfile(profileId);
  const form = document.querySelector("form[id$=measure-form]");
  MEASUREMENT_FIELDS.forEach(f => { if (profile[f.key] != null) form[f.key].value = bodyValue(profile[f.key], form.dataset.unit); });
}

// What was typed, in inches (how measurements are saved)
function readMeasurements(form) {
  const values = {};
  MEASUREMENT_FIELDS.forEach(f => { values[f.key] = inchesFrom(form[f.key].value, form.dataset.unit || "in"); });
  return values;
}

function saveFlowMeasurements(event) {
  event.preventDefault();
  const form = event.target;
  let customer = currentCustomer();
  if (!customer) {
    customer = findOrCreateCustomer(form.name.value.trim(), readPhone(form, "phone"), form.email.value.trim());
    customer.measurement_unit = form.dataset.unit || currentBodyUnit();
    db.session.customerId = customer.id;
  }
  const profile = saveMeasurementProfile(customer, readMeasurements(form));
  draft().profileId = profile.id;
  saveData();
  go("fabric");
  return false;
}

// ---- Screen 6: Fabric marketplace (step 4) ----
// The photo grid and filters are in marketplace.js. The customer only
// chooses the fabric: how many yards they need depends on their size and the
// style, so the tailor works it out with them after they send the order.

function screenFabric() {
  const d = draft();
  marketMode = "flow";
  let selected = findFabric(d.fabricId);
  let gone = "";
  if (selected && !isBuyable(selected)) {
    gone = `<div class="notice">${escapeHtml(selected.name)} is no longer available. Please choose another fabric.</div>`;
    d.fabricId = null;
    selected = null;
  }
  const seller = selected ? findSupplier(selected.supplier_id) : null;
  const unit = screenFabricUnit();

  return `
    ${cTop("Fabric Marketplace", "measurements")}
    <div class="content">
      ${flowBar("fabric")}
      ${gone}
      ${marketFilterBar()}
      <div id="market-results" class="stack">${marketResults()}</div>
      ${marketplaceSellerDirectory()}
      ${selected ? `
        <div class="pick-bar">
          <div class="pick-head">
            <img src="${fabricCoverUrl(selected)}" alt="">
            <div><div class="name">${escapeHtml(selected.name)}</div>
              <div class="meta">${escapeHtml(seller ? seller.name : "")} · ${fabricPriceText(selected, unit)}${approxMoney(pricePerUnit(selected.price_per_yard, unit), fabricCurrency(selected))} · ${lengthText(selected.yards_available, unit)} left</div></div>
          </div>
          <div class="meta">Your tailor works out how many ${unitWord(unit, true)} you need with you. Nothing is bought yet.</div>
          <button class="cta" onclick="setFabricPlan('marketplace')">Continue with this fabric →</button>
        </div>` : `
        <div class="pick-bar stack">
          <div class="notice"><b>No marketplace fabric yet?</b><div class="meta">You can still send your design and measurements to the tailor and start the chat. Fabric can be agreed later.</div></div>
          <button class="cta" onclick="setFabricPlan('recommend')">Let my tailor recommend fabric →</button>
          <button class="btn-outline" onclick="setFabricPlan('own')">I already have my fabric</button>
        </div>`}
    </div>`;
}

function setFabricPlan(plan) {
  const d = draft();
  d.fabricPlan = plan;
  if (plan !== "marketplace") d.fabricId = null;
  saveData();
  go("send");
}

// ---- Send to tailor (end of step 4) ----

function draftPrimaryStyleRef(d) {
  if (!d || !hasInspiration(d.inspiration)) return null;
  return d.inspiration.aiSelected || (d.inspiration.photos && d.inspiration.photos[0]) || null;
}

function orderPrimaryStyleRef(order) {
  if (!order || !hasInspiration(order.inspiration)) return null;
  return (order.inspiration.photos && order.inspiration.photos[0]) || null;
}

function stylePreviewThumb(ref, alt, extraClass) {
  return ref
    ? `<button type="button" class="style-preview-thumb ${extraClass || ""}" onclick="openStylePreviewRef('${escapeHtml(ref)}','${escapeHtml(alt || "Style reference")}')" aria-label="View ${escapeHtml(alt || "style reference")} full screen"><img src="${photoUrl(ref)}" alt="${escapeHtml(alt || "Style reference")}"></button>`
    : "";
}

function openStylePreviewRef(ref, title) {
  if (!ref) return;
  styleViewer = { photos: [ref], index: 0, title: title || "Style reference", returnFocus: document.activeElement };
  document.addEventListener("keydown", styleViewerKeys);
  drawStyleViewer();
}

function screenSend() {
  const d = draft();
  let fabric = findFabric(d.fabricId);
  if (fabric && !isBuyable(fabric)) {
    d.fabricId = null;
    d.fabricPlan = "recommend";
    fabric = null;
  }
  const seller = fabric ? findSupplier(fabric.supplier_id) : null;
  const profile = findProfile(d.profileId);
  const tailor = draftDesigner();
  const currency = designerCurrency(tailor);
  const unit = designerFabricUnit(tailor);
  const fc = fabric ? fabricCurrency(fabric) : currency;
  const perUnit = fabric ? pricePerUnit(fabric.price_per_yard, unit) : 0;
  const styleRef = draftPrimaryStyleRef(d);
  const styleLabel = d.inspiration && d.inspiration.aiSelected ? "Selected AI design" : styleRef ? "Uploaded style reference" : "Design preview";
  const tailorName = draftHasTailor() ? draftDesigner().business_name : "Your tailor";
  const fabricTitle = fabric
    ? fabric.name
    : d.fabricPlan === "own"
      ? "I already have my fabric"
      : d.fabricPlan === "recommend"
        ? "Let my tailor recommend fabric"
        : "Decide fabric with tailor";
  const fabricText = fabric
    ? `${fabricPriceText(fabric, unit)}${approxMoney(perUnit, fc)} · ${seller ? seller.name : ""}`
    : d.fabricPlan === "own"
      ? "You will provide your own fabric for this order."
      : "Your tailor will recommend suitable fabrics from the NebedaHub marketplace after reviewing your design.";

  return `
    ${cTop("Send to Tailor", "fabric")}
    <div class="content send-review">
      ${flowBar("send")}
      <section class="send-summary-card">
        <div class="send-style-row">
          ${styleRef
            ? stylePreviewThumb(styleRef, styleLabel, "send-style-image")
            : `<div class="style-preview-thumb send-style-image fallback">${conceptSVG(d, d.variation)}</div>`}
          <div class="send-style-copy">
            <span class="eyebrow">${escapeHtml(styleLabel)}</span>
            <div class="name big">${escapeHtml(d.outfit)}${draftHasTailor() ? ` by ${escapeHtml(tailorName)}` : ""}</div>
            <div class="meta">${escapeHtml(colourName(d.colour))} · ${escapeHtml(d.embroidery)} embroidery · ${escapeHtml(d.sleeve)} sleeve · ${escapeHtml(d.neck)} neck</div>
          </div>
        </div>
        <div class="send-check-row"><span>Measurements</span><strong>✓ ${profile ? `Saved (${escapeHtml(profile.label)})` : "Saved"}</strong></div>
      </section>

      <section class="send-choice-card">
        <div class="row-between">
          <div><span class="eyebrow">Fabric preference</span><h3>${escapeHtml(fabricTitle)}</h3></div>
          <button class="linkish" type="button" onclick="go('fabric')">Change</button>
        </div>
        ${fabric ? `
          <div class="recommended-choice send-fabric-choice">
            <img src="${fabricCoverUrl(fabric)}" alt="">
            <div><b>${escapeHtml(fabric.name)}</b><div class="meta">${escapeHtml(fabricText)}</div></div>
          </div>`
          : `<p class="meta">${escapeHtml(fabricText)}</p>`}
        ${!fabric && d.fabricPlan === "recommend" ? `<div class="status-pill waiting">Waiting for tailor recommendation</div>` : ""}
      </section>

      <section class="send-next compact">
        <b>What happens next</b>
        <ol>
          <li>${escapeHtml(tailorName)} reviews your design and measurements.</li>
          <li>${fabric ? "The tailor confirms how much fabric is needed." : d.fabricPlan === "own" ? "You and the tailor confirm your own fabric is suitable." : "The tailor recommends marketplace fabrics for you to choose from."}</li>
          <li>Your tailor sends the final itemised quote.</li>
          <li>You accept the quote before any marketplace fabric is bought.</li>
        </ol>
      </section>

      ${approxNote(currency) || (fabric ? approxNote(fc) : "")}
      <label class="field send-note"><span>Note to your tailor <small>(optional)</small></span>
        <textarea id="tailor-note" rows="3" maxlength="${CHAT_TEXT_MAX}" placeholder="Wedding date, fit preference, special request…"
          oninput="draft().tailorNote=this.value;saveData()">${escapeHtml(d.tailorNote || "")}</textarea></label>
      ${draftHasTailor() ? `<button id="send-request" class="cta send-main-cta" onclick="sendToTailor()">Send Request to Tailor</button>
      <div class="meta centre">No payment required yet.</div>` : `<div class="notice">Choose the tailor who'll make it. Your design, measurements and fabric preference are kept.</div>
      <button id="send-request" class="cta" onclick="startOrder()">Choose your tailor</button>`}
    </div>`;
}

let sendingRequest = false;
function sendToTailor() {
  if (sendingRequest) return;
  if (!draftHasTailor()) { startOrder(); return; }
  const d = draft();
  const fabric = findFabric(d.fabricId);
  // The order belongs to whoever the measurements were saved for
  const owner = db.customers.find(c => c.measurement_profiles.some(p => p.id === d.profileId));
  if (!owner) {
    toast("Please save your measurements again.");
    d.profileId = null;
    go("measurements");
    return;
  }
  if (fabric && !isBuyable(fabric)) {
    toast("That fabric has just sold out. You can choose another or continue without marketplace fabric.");
    d.fabricId = null;
    d.fabricPlan = "later";
    go("fabric");
    return;
  }
  const note = document.getElementById("tailor-note");
  if (note) d.tailorNote = note.value;
  sendingRequest = true;
  const button = document.getElementById("send-request");
  if (button) { button.disabled = true; button.textContent = "Sending…"; }
  const sent = requestQuote({
    customerId: owner.id, designerId: draftDesignerId(),
    outfit: d.outfit, colour: d.colour, embroidery: d.embroidery, sleeve: d.sleeve, neck: d.neck,
    variation: d.variation, profileId: d.profileId, fabric: fabric || null,
    fabricPlan: d.fabricPlan || (fabric ? "marketplace" : "recommend"),
    inspiration: hasInspiration(d.inspiration)
      ? { photos: d.inspiration.photos.slice(), aiSelected: d.inspiration.aiSelected || null, link: cleanStyleLink(d.inspiration.link) || "", note: d.inspiration.note || "" }
      : null,
    note: (d.tailorNote || "").trim()
  });
  Promise.resolve(sent)
    .then(order => {
      db.session.customerId = owner.id;
      db.draft = null;
      saveData();
      flashMessage = `Sent! ${designerName(order.designer_id)} can now chat with you about the design, fabric and quote.`;
      go("tracking/" + order.id);
    })
    .catch(error => {
      toast(error.message || "Couldn't send your order. Please try again.");
      renderAll();
    })
    .finally(() => { sendingRequest = false; });
}

// ---- Keeping orders on NebedaHub ----

function payProtectionLine() {
  return `<p class="protect-line">🛡️ ${escapeHtml(PAY_PROTECTION_LINE)}</p>`;
}

// The tailor's business address and the customer's delivery address. The
// database only hands them over once the deposit is CONFIRMED (supabase/
// no-leakage.sql: wearvia_delivery_details); the customer app follows the same rule.
function deliveryDetails(order) {
  if (Cloud.live) {
    return (db.delivery_details || []).find(x => x.order_id === order.id)
      || { unlocked: !!order.deposit_paid_at, tailor_address: "", delivery_address: "" };
  }
  const d = designerById(order.designer_id) || {};
  const country = countryByCode(d.country_code);
  return {
    unlocked: !!order.deposit_paid_at,
    tailor_address: order.deposit_paid_at ? [d.address_line, d.city, d.postcode, country && country.name].filter(Boolean).join(", ") : "",
    delivery_address: order.delivery_address || ""
  };
}

function deliveryBoxHtml(order, side) {
  if (!isPlaced(order)) return "";
  const x = deliveryDetails(order);
  const tailor = escapeHtml(designerName(order.designer_id));
  if (!x.unlocked) {
    return `<div class="handover locked"><b>🔒 Delivery and fitting details</b>
      <p class="meta">${side === "customer" ? `${tailor}'s business address and your delivery address` : "Your business address and the customer's delivery address"}
      appear here for both of you once the deposit is confirmed.</p></div>`;
  }
  const form = side === "customer" ? `<form class="inline-form" onsubmit="return saveDeliveryAddress(event, '${order.id}')">
      <input name="address" maxlength="300" value="${escapeHtml(x.delivery_address)}" placeholder="House number, street, town, postcode" aria-label="Your delivery address" autocomplete="street-address">
      <button type="submit" class="optbtn sel">${x.delivery_address ? "Update" : "Save"}</button></form>` : "";
  return `<div class="handover">
    <b>📦 Delivery and fitting details</b>
    <div class="mrow"><span>${side === "customer" ? tailor : "Your business address"}</span><span>${x.tailor_address ? escapeHtml(x.tailor_address) : side === "customer" ? "Not added yet — ask in the chat" : `Not added yet — add it in <a href="#/profile">My profile</a>`}</span></div>
    <div class="mrow"><span>${side === "customer" ? "Your delivery address" : "Customer's delivery address"}</span><span>${x.delivery_address ? escapeHtml(x.delivery_address) : side === "customer" ? "Add it below" : "The customer hasn't added it yet"}</span></div>
    ${form}
    <p class="meta">Shared because the deposit is confirmed — for delivery and fittings only. Keep payments and changes on ${APP_NAME} so you're protected.</p>
  </div>`;
}

function saveDeliveryAddress(event, orderId) {
  event.preventDefault();
  const order = findOrder(orderId);
  const address = event.target.address.value.trim();
  if (!order) return false;
  if (Cloud.live) {
    Cloud.setDeliveryAddress(order, address).then(() => { toast("Delivery address saved."); renderAll(); }, error => toast(error.message));
    return false;
  }
  order.delivery_address = hideContactDetails(address).text;
  saveData();
  toast("Delivery address saved.");
  renderAll();
  return false;
}

// ---- Screen 8: the tailor's quote (steps 5 and 6) ----

// The itemised quote, in the tailor's currency. When the seller's fabric was
// converted, the exchange rate the database used is shown too.
function quoteLinesHtml(order) {
  const deposit = order.deposit_amount;
  const cur = orderCurrency(order);
  return `${order.line_items.map(l => `<div class="qline"><span>${escapeHtml(l.label)}</span><span>${money(l.amount, cur)}</span></div>`).join("")}
    <div class="qtotal"><span>Total</span><span>${money(order.quote_total, cur)}${approxMoney(order.quote_total, cur)}</span></div>
    ${exchangeRateHtml(order)}
    <div class="meta">${typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE ? `Customer pays the full ${money(order.quote_total, cur)} upfront in transaction test mode.` : `Deposit ${money(deposit, cur)} (${Math.round(DEPOSIT_RATE * 100)}%) · balance ${money(order.quote_total - deposit, cur)} after quality control.`}</div>
    ${approxNote(cur)}`;
}

// "Fabric converted from ₦67,500 at £1 = ₦1,752.98 (26 Sep 2026)"
function exchangeRateHtml(order) {
  if (!order.exchange_rate || !order.fabric_currency_code || order.fabric_currency_code === orderCurrency(order)) return "";
  const fc = order.fabric_currency_code;
  return `<div class="meta fx-line">💱 The seller charges ${money(order.fabric_cost_in_fabric_currency, fc)}. Converted into ${escapeHtml(currencyInfo(orderCurrency(order)).name)} at
    <b>${escapeHtml(rateText(order.exchange_rate, fc, orderCurrency(order)))}</b>${order.exchange_rate_date ? `, the exchange rate on ${formatDate(order.exchange_rate_date)}` : ""} — fixed for this order.</div>`;
}

function chatButton(order, primary) {
  const unread = unreadCount(order.id, "customer");
  const seller = order.fabric_supplier_id && isPlaced(order) ? findSupplier(order.fabric_supplier_id) : null;
  const label = seller ? "Order chat" : "Chat with " + designerName(order.designer_id);
  return `<button class="${primary ? "cta" : "btn-outline"} chat-open" onclick="go('chat/${order.id}')">💬 ${escapeHtml(label)}${unread ? ` <span class="chat-badge">${unread} new</span>` : ""}</button>`;
}

function openRecommendedFabricPhotos(fabricId, index) {
  const fabric = findFabric(fabricId);
  const photos = fabric ? fabricPhotoRefs(fabric) : [];
  if (!photos.length) return;
  styleViewer = {
    photos: photos.slice(),
    index: Math.min(index || 0, photos.length - 1),
    title: fabric.name,
    returnFocus: document.activeElement
  };
  document.addEventListener("keydown", styleViewerKeys);
  drawStyleViewer();
}

function customerFabricRecommendationsHtml(order) {
  const pending = fabricRecommendations(order, ["pending"]);
  const selectedRec = fabricRecommendations(order, ["selected"])[0] || null;
  const selectedFabric = selectedRec ? findFabric(selectedRec.fabric_id) : (order.fabric_id ? findFabric(order.fabric_id) : null);

  if (!pending.length) {
    if (!selectedFabric || quoteStatus(order) !== "requested") return "";
    const seller = findSupplier(selectedFabric.supplier_id);
    return `<div class="card fabric-choice-card">
      <div class="row-between"><h3>Your fabric</h3><span class="badge stage-quote">Selected</span></div>
      <div class="recommended-choice">
        <button type="button" class="recommended-photo" onclick="openRecommendedFabricPhotos('${selectedFabric.id}',0)" aria-label="View photos of ${escapeHtml(selectedFabric.name)}">
          <img src="${fabricCoverUrl(selectedFabric)}" alt="">
        </button>
        <div>
          <b>${escapeHtml(selectedFabric.name)}</b>
          <div class="meta">${escapeHtml(seller ? seller.name : "Fabric seller")} · ${escapeHtml(fabricPriceText(selectedFabric, designerFabricUnit(designerById(order.designer_id))))}</div>
          <div class="meta">Your tailor will confirm how much you need and include it in the quote.</div>
        </div>
      </div>
    </div>`;
  }

  const batch = pending[0].batch_id;
  const recs = pending.filter(r => r.batch_id === batch);
  const note = recs[0] && recs[0].note ? recs[0].note : "";

  return `<div class="card fabric-choice-card">
    <h3>Your tailor recommends these fabrics</h3>
    <p class="meta">Choose the one you prefer. Nothing is bought yet. Your tailor will confirm the amount needed before sending the final quote.</p>
    ${note ? `<div class="notice soft"><b>Tailor's note:</b> ${escapeHtml(note)}</div>` : ""}
    <div class="customer-recommend-grid">
      ${recs.map(rec => {
        const fabric = findFabric(rec.fabric_id);
        if (!fabric) return "";
        const seller = findSupplier(fabric.supplier_id);
        const available = isBuyable(fabric);
        const unit = designerFabricUnit(designerById(order.designer_id));
        return `<div class="customer-recommend ${available ? "" : "unavailable"}">
          <button type="button" class="recommended-photo" onclick="openRecommendedFabricPhotos('${fabric.id}',0)" aria-label="View photos of ${escapeHtml(fabric.name)}">
            <img src="${fabricCoverUrl(fabric)}" alt="">
            <span class="pcount">▣ ${fabricPhotoRefs(fabric).length}</span>
          </button>
          <div class="recommend-info">
            <b>${escapeHtml(fabric.name)}</b>
            <small>${escapeHtml(seller ? seller.name : "Fabric seller")}</small>
            <small>${escapeHtml(fabricPriceText(fabric, unit))} · ${available ? lengthText(fabric.yards_available, unit) + " in stock" : "Unavailable"}</small>
          </div>
          <button type="button" class="optbtn sel" onclick="chooseTailorRecommendedFabric('${order.id}','${rec.id}')" ${available ? "" : "disabled"}>
            ${available ? "Choose this fabric" : "Unavailable"}
          </button>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

let choosingRecommendedFabric = false;
function chooseTailorRecommendedFabric(orderId, recommendationId) {
  const order = findOrder(orderId);
  if (!order || choosingRecommendedFabric) return;
  const rec = (db.fabric_recommendations || []).find(r => r.id === recommendationId && r.order_id === order.id);
  const fabric = rec ? findFabric(rec.fabric_id) : null;
  if (!rec || !fabric) { toast("That recommendation is no longer available."); return; }
  if (!confirm(`Choose ${fabric.name} for this order? Nothing will be charged yet.`)) return;
  choosingRecommendedFabric = true;
  let result;
  try {
    result = chooseRecommendedFabricForOrder(order, recommendationId);
  } catch (error) {
    result = Promise.reject(error);
  }
  Promise.resolve(result)
    .then(() => {
      if (!Cloud.live) saveData();
      flashMessage = `${fabric.name} selected. Your tailor can now confirm the amount needed and send your quote.`;
      renderAll();
    })
    .catch(error => toast(error.message || "Could not choose that fabric."))
    .finally(() => { choosingRecommendedFabric = false; });
}

// What the customer can do now on an order that's still a request or a quote
function quoteBlock(order) {
  const status = quoteStatus(order);
  if (status === "requested") {
    const recs = customerFabricRecommendationsHtml(order);
    return `${recs}<div class="quote-card waiting">
      <b>${escapeHtml(QUOTE_STATUS_LABELS.requested)}</b>
      ${order.fabric_problem ? `<div class="notice warn">${escapeHtml(order.fabric_problem)}. ${escapeHtml(designerName(order.designer_id))} will suggest another fabric in the chat.</div>` : ""}
      <div class="meta">${recs ? "Once you choose a recommended fabric, your tailor confirms the amount needed and sends the quote." : order.fabric_plan === "recommend" ? escapeHtml(designerName(order.designer_id)) + " will recommend suitable marketplace fabrics here. You can choose one before the quote is sent." : escapeHtml(designerName(order.designer_id)) + " will chat with you about the fabric, confirm how much is needed, then send your quote here."} Nothing is bought or charged until you accept the quote.</div>
      ${chatButton(order, true)}
    </div>`;
  }
  if (status === "quoted") {
    return `<div class="quote-card">
      <b>Your quote from ${escapeHtml(designerName(order.designer_id))}</b>
      ${quoteLinesHtml(order)}
      <button id="accept-quote" class="cta" onclick="acceptQuoteFromApp('${order.id}')">Accept quote</button>
      <button class="btn-outline" onclick="go('chat/${order.id}')">Ask a question</button>
      <div class="meta">${typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE ? "When you accept, you will test-pay the full order amount upfront. No real money moves." : `When you accept, the fabric is bought for your outfit and you pay the ${Math.round(DEPOSIT_RATE * 100)}% deposit.`}</div>
      ${payProtectionLine()}
    </div>`;
  }
  return "";
}

let acceptingQuote = false;
function acceptQuoteFromApp(orderId) {
  const order = findOrder(orderId);
  if (!order || acceptingQuote) return;
  const testMode = typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE;
  const confirmText = testMode
    ? `Accept the quote of ${money(order.quote_total, orderCurrency(order))}? In transaction test mode you will test-pay the full amount upfront. No real money will move.`
    : `Accept the quote of ${money(order.quote_total, orderCurrency(order))}? The fabric is bought for your outfit and you\'ll pay a deposit of ${money(order.deposit_amount, orderCurrency(order))}.`;
  if (!confirm(confirmText)) return;
  acceptingQuote = true;
  const button = document.getElementById("accept-quote");
  if (button) { button.disabled = true; button.textContent = "Accepting…"; }
  let result;
  try {
    result = acceptQuote(order);
  } catch (error) {
    result = Promise.reject(error);
  }
  Promise.resolve(result)
    .then(outcome => {
      if (!Cloud.live) saveData();
      if (outcome && outcome.ok) {
        flashMessage = typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE ? "Quote accepted. Now test-pay the full order amount upfront." : "Quote accepted. Now pay your deposit and we will start making your outfit.";
        go("pay/" + orderId);
      } else {
        flashMessage = (outcome && outcome.message) || "That quote can't be accepted any more.";
        renderAll();
      }
    })
    .catch(error => {
      toast(error.message || "Couldn't accept the quote. Please try again.");
      renderAll();
    })
    .finally(() => { acceptingQuote = false; });
}

// ---- Screen 9: Payment (step 7) ----

function screenPay(orderId) {
  const order = findOrder(orderId);
  if (!order) return screenNotFound();
  if (!isPlaced(order) || depositStarted(order)) return screenTracking(orderId);
  const cur = orderCurrency(order);
  const fullAmount = order.quote_total;
  const testMode = typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE;
  return `
    ${cTop(testMode ? "Pay in Full · Test Mode" : "Pay", "tracking/" + order.id)}
    <div class="content">
      ${flash()}
      <div class="qline"><span>Order Total</span><span>${money(fullAmount, cur)}</span></div>
      ${testMode ? `
        <div class="card attention">
          <b>🧪 TRANSACTION TEST MODE</b>
          <p class="hint">The customer pays 100% upfront. No real card is charged and no real payout is sent.</p>
        </div>
        <div class="card">
          <h3>Protected payout rules</h3>
          <div class="qline"><span>NebedaHub commission</span><span>10%</span></div>
          <div class="qline"><span>Tailor payout</span><span>70% released · 30% protected</span></div>
          <div class="qline"><span>Fabric seller payout</span><span>70% after dispatch · 30% after tailor quality approval</span></div>
          <p class="hint">Commission is calculated separately from each seller's or tailor's portion.</p>
        </div>`
        : ONLINE_PAYMENTS_ENABLED
          ? `<div class="meta"><b>Payment methods:</b> Secure payment methods will be shown at checkout.</div>`
          : `<div class="card attention"><b>Online payments are not open yet.</b><p class="hint">Do not send money directly to a tailor or fabric seller.</p></div>`}
      <label class="field">Delivery address <small>(optional)</small>
        <input id="pay-address" maxlength="300" value="${escapeHtml(deliveryDetails(order).delivery_address)}" placeholder="House number, street, town, postcode" autocomplete="street-address"></label>
      ${payProtectionLine()}
      <div class="meta">${testMode ? "Test only. No money moves." : ONLINE_PAYMENTS_ENABLED ? "Secure checkout is handled by the approved payment provider." : "Payments are currently disabled while NebedaHub completes payment setup."}</div>
      ${testMode
        ? `<button id="pay-deposit" class="cta" onclick="payDeposit('${order.id}')">🧪 Test Pay ${money(fullAmount, cur)} in Full</button>`
        : !ONLINE_PAYMENTS_ENABLED ? "" : `<button id="pay-deposit" class="cta" onclick="payDeposit('${order.id}')">Continue to secure payment</button>`}
    </div>`;
}

function payDeposit(orderId) {
  const order = findOrder(orderId);
  if (!order || !isPlaced(order) || depositStarted(order)) return;
  const addressBox = document.getElementById("pay-address");
  const address = addressBox ? addressBox.value.trim() : "";
  const testMode = typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE;
  if (testMode && Cloud.live) {
    if (!confirm("Run a TEST full payment? No real money will move.")) return;
    const button = document.getElementById("pay-deposit");
    if (button) { button.disabled = true; button.textContent = "Running test payment…"; }
    const saveAddress = address ? Cloud.setDeliveryAddress(order, address) : Promise.resolve();
    Promise.resolve(saveAddress)
      .then(() => Cloud.testPayment(order, "Full"))
      .then(result => {
        flashMessage = "TEST full payment successful. " + money(result.amount, result.currency) +
          " simulated. NebedaHub commission " + money(result.platform_commission, result.currency) +
          ". Tailor 70% release " + money(result.tailor_initial, result.currency) +
          ", tailor protected 30% " + money(result.tailor_held, result.currency) +
          (result.seller_net > 0 ? ". Fabric seller 70% waits for dispatch and 30% waits for tailor quality approval." : ".") +
          " No real money moved.";
        go("tracking/" + order.id);
      })
      .catch(error => {
        toast(error.message || "The test payment could not be completed.");
        if (button) { button.disabled = false; button.textContent = "Test Pay in Full"; }
      });
    return;
  }
  if (!ONLINE_PAYMENTS_ENABLED) { toast("Online payments are not open yet. Please do not pay outside NebedaHub."); return; }
  toast("Protected checkout will be enabled after the payment provider is connected.");
}

// ---- Chat with Nebeda Threads (every order) ----

function screenChat(orderId) {
  const order = findOrder(orderId);
  if (!order) return screenNotFound();
  const profile = findProfile(order.measurement_profile_id);
  const fabric = findFabric(order.fabric_id);
  const status = quoteStatus(order);
  const unit = orderFabricUnit(order);
  const cur = orderCurrency(order);
  const customer = findCustomer(order.customer_id);
  const seller = order.fabric_supplier_id && isPlaced(order) ? findSupplier(order.fabric_supplier_id) : null;
  return `
    ${cTop((seller ? "Order Chat · " : "Chat · ") + order.id, "tracking/" + order.id)}
    <div class="content chat-content" data-chat-scroll="${order.id}" onscroll="chatScrolled(this)">
      ${seller ? `<div class="notice soft"><b>Shared order chat</b><br>You, ${escapeHtml(designerName(order.designer_id))} and ${escapeHtml(seller.name)} can all message here about this fabric order.</div>` : ""}
      <details class="chat-brief">
        <summary>Your order: ${escapeHtml(order.outfit_type)}${hasInspiration(order.inspiration) ? " · style photos" : ""} · measurements</summary>
        ${inspirationBlock(order.id, order.inspiration)}
        <div class="meta">${escapeHtml(colourName(order.colour))} · ${escapeHtml(order.embroidery)} embroidery · ${escapeHtml(order.sleeve_style)} sleeve · ${escapeHtml(order.neck_style)} neck</div>
        ${fabric ? `<div class="meta">Fabric: <b>${escapeHtml(fabric.name)}</b> · ${fabricPriceText(fabric, unit)}${isPlaced(order) || status === "quoted" ? ` · ${lengthText(order.fabric_yards, unit)}` : ""}</div>` : ""}
        ${profile ? `<div class="chat-measure">${MEASUREMENT_FIELDS.filter(f => profile[f.key] != null).map(f => `<span>${f.label} <b>${bodyText(profile[f.key], customerBodyUnit(customer))}</b></span>`).join("")}</div>` : ""}
      </details>
      ${status === "quoted" ? `<div class="chat-quote-bar"><span>Quote: <b>${money(order.quote_total, cur)}</b>${typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE ? " · full payment upfront" : " · deposit " + money(order.deposit_amount, cur)}</span>
        <button class="optbtn sel" onclick="go('tracking/${order.id}')">View &amp; accept</button></div>` : ""}
      ${chatLogHtml(order, "customer", false)}
    </div>
    ${chatComposerHtml(order, "customer")}`;
}

// ---- My orders ----

function screenOrders() {
  const customer = currentCustomer();
  const orders = customer ? customerOrders(customer.id).slice().reverse() : [];
  const d = db.draft;
  return `
    ${cTop("My Orders")}
    <div class="content">
      ${d && d.designDone ? `<button class="selopt" onclick="go('${FLOW.slice().reverse().find(f => !flowRedirect(f.screen)).screen}')">
        <span><b>${escapeHtml(d.outfit)}</b> · not placed yet<br><span class="fl">Continue where you left off</span></span><span>›</span></button>` : ""}
      ${orders.map(o => `<button class="selopt" onclick="go('tracking/${o.id}')">
        <span><b>${escapeHtml(o.outfit_type)}</b> · ${o.id}<br><span class="fl">${escapeHtml(currentStepLabel(o) === "Complete" ? "Complete" : "Now: " + currentStepLabel(o))}</span></span>
        <span>${unreadBadge(unreadCount(o.id, "customer"))} ›</span></button>`).join("")}
      ${!orders.length && !(d && d.designDone) ? `<div class="empty">${customer ? "No orders yet." : "Your orders appear here once you place one."}</div>
        <button class="cta" onclick="startOrder()">Start an Order</button>` : ""}
    </div>
    ${cNav("orders")}`;
}

// ---- Screen 10: Order tracking (steps 1–16) ----

function lifecycleList(order) {
  const done = stepsDone(order);
  const staff = staffForCurrentStep(order);
  return `<ul class="track">${LIFECYCLE.map((label, i) => {
    const state = i < done ? "done" : i === done ? "now" : "";
    let extra = "";
    if (i === done && staff) extra = ` <span class="fl">· ${escapeHtml(staff.name)}</span>`;
    if (i === done && isPlaced(order) && depositAwaiting(order)) extra = ` <span class="fl awaiting">· ${depositStarted(order) ? `awaiting confirmation by ${escapeHtml(designerName(order.designer_id))}` : "waiting for your deposit"}</span>`;
    if (i === done && !isPlaced(order)) extra = ` <span class="fl awaiting">· ${escapeHtml(currentStepLabel(order).toLowerCase())}</span>`;
    if (i === done && label === "Delivery" && findDelivery(order.id)) extra = ` <span class="fl">· ${escapeHtml(findDelivery(order.id).status)}</span>`;
    return `<li><span class="tdot ${state}"></span><span class="${state}-t">${i + 1}. ${label}</span>${extra}</li>`;
  }).join("")}</ul>`;
}

function screenTracking(orderId) {
  const order = findOrder(orderId);
  if (!order) return screenNotFound();
  const balance = balanceOwed(order);
  const awaiting = amountAwaiting(order.id);
  const due = Math.round((balance - awaiting) * 100) / 100;
  const delivery = findDelivery(order.id);
  const qcPassed = stageIndex(order) >= STAGES.findIndex(s => s.key === "quality_control") && !depositAwaiting(order);
  const placed = isPlaced(order);
  const cur = orderCurrency(order);
  let action = "";
  if (!placed) {
    action = quoteBlock(order);
  } else if (!depositStarted(order)) {
    action = Cloud.live && !ONLINE_PAYMENTS_ENABLED && !(typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE)
      ? `<div class="card attention"><b>Payment not open yet</b><p class="hint">Your quote is accepted. NebedaHub will notify you when protected in-app payment is enabled. Do not pay the seller outside NebedaHub.</p></div>`
      : `<button class="cta" onclick="go('pay/${order.id}')">${typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE ? "🧪 Test Pay " + money(order.quote_total, cur) + " in Full" : "Pay " + money(order.deposit_amount, cur) + " Deposit"} →</button>`;
  } else if (order.stage === "delivered" && !order.review_rating) {
    const heldTailor = (db.test_allocations || []).filter(a => a.order_id === order.id && a.recipient_type === "tailor" && a.release_stage === "tailor_customer_acceptance" && a.status === "secured").reduce((n,a) => n + (a.amount || 0), 0);
    action = heldTailor > 0 && typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE
      ? `<div class="card attention"><b>Final tailor payment is protected</b><p class="hint">The tailor has confirmed delivery. Please confirm whether you received the outfit and are happy with it.</p></div>
         <button class="cta" onclick="confirmCustomerOutfit('${order.id}', true)">I received it and I am happy</button>
         <button class="btn-outline" onclick="confirmCustomerOutfit('${order.id}', false)">I have a problem with the outfit</button>`
      : `<button class="cta" onclick="go('review/${order.id}')">Leave a Review →</button>`;
  } else if (due > 0 && qcPassed) {
    action = `
      ${Cloud.live && typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE ? `<div class="card attention"><b>🧪 Transaction test mode</b><p class="hint">No real money will move.</p></div>` : Cloud.live && ONLINE_PAYMENTS_ENABLED ? `<div class="meta"><b>Secure payment:</b> Continue through NebedaHub's protected checkout.</div>` : !Cloud.live ? `<div class="selopt"><span class="fl">Pay by</span><span class="optbtns">${["Card", "Apple Pay", "Bank transfer"].map(m =>
        `<button class="optbtn ${balanceMethod === m ? "sel" : ""}" onclick="balanceMethod='${m}';renderAll()">${m}</button>`).join("")}</span></div>` : `<div class="card attention"><b>Balance payment is not open yet.</b><p class="hint">Do not pay outside NebedaHub. Protected in-app payment will be enabled before live transactions open.</p></div>`}
      ${Cloud.live && !ONLINE_PAYMENTS_ENABLED && !(typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE) ? "" : `<button id="pay-balance" class="cta" onclick="payBalance('${order.id}')">${typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE ? "🧪 Test Pay " : "Pay "}${money(due, cur)} Balance</button>`}
      ${payProtectionLine()}`;
  }
  return `
    ${cTop("Order #" + order.id, "orders")}
    <div class="content">
      ${flash()}
      <div class="order-head">
        ${orderPrimaryStyleRef(order)
          ? stylePreviewThumb(orderPrimaryStyleRef(order), "Order style", "order-style-thumb")
          : `<div class="thumb">${conceptSVG({ outfit: order.outfit_type, colour: order.colour, embroidery: order.embroidery, sleeve: order.sleeve_style, neck: order.neck_style }, order.concept_variation)}</div>`}
        <div>
          <div class="name">${escapeHtml(order.outfit_type)} by ${escapeHtml(designerName(order.designer_id))}</div>
          ${placed ? `
          <div class="meta">Total ${money(order.quote_total, cur)}${approxMoney(order.quote_total, cur)} · Paid ${money(amountPaid(order.id), cur)}</div>
          ${awaiting > 0 ? `<div class="meta awaiting">${money(awaiting, cur)} awaiting confirmation by ${escapeHtml(designerName(order.designer_id))}</div>` : ""}
          <div class="meta">${due > 0 ? `Balance ${money(due, cur)}${qcPassed ? " — due now" : " after quality control"}` : balance > 0 ? "Nothing more to pay right now" : "Paid in full"}</div>
          <div class="meta">Due ${formatDate(order.due_date)}</div>` : `
          <div class="meta">Sent to the tailor ${formatDate(order.created_at)}</div>
          <div class="meta">Now: ${escapeHtml(currentStepLabel(order))}</div>`}
        </div>
      </div>
      ${action}
      ${placed || quoteStatus(order) === "quoted" ? chatButton(order, false) : ""}
      ${deliveryBoxHtml(order, "customer")}
      ${inspirationBlock(order.id, order.inspiration)}
      ${lifecycleList(order)}
      ${order.review_rating ? `<div class="meta">Your review: ${"★".repeat(order.review_rating)} ${escapeHtml(order.review_text)}</div>` : ""}
      <div class="optbtns">
        ${placed ? `<button class="optbtn" onclick="go('invoice/${order.id}')">Invoice</button>` : ""}
        ${delivery ? `<button class="optbtn" onclick="go('delivery/${order.id}')">Track delivery</button>` : ""}
      </div>
      <div class="meta">${escapeHtml(designerName(order.designer_id))} updates each stage as your outfit is made.</div>
    </div>
    ${cNav("orders")}`;
}

// Step 14: the customer pays the balance after quality control.
// It counts once Nebeda Threads confirms it.
function payBalance(orderId) {
  const order = findOrder(orderId);
  const due = Math.round((balanceOwed(order) - amountAwaiting(order.id)) * 100) / 100;
  if (due <= 0) return;
  const testMode = typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE;
  if (testMode && Cloud.live) {
    if (!confirm("Run a TEST balance payment? No real money will move.")) return;
    const button = document.getElementById("pay-balance");
    if (button) { button.disabled = true; button.textContent = "Running test payment…"; }
    Cloud.testPayment(order, "Balance")
      .then(result => {
        flashMessage = "TEST balance successful. " + money(result.amount, result.currency) + " simulated. Fabric seller secured " + money(result.seller_secured, result.currency) + ", tailor secured " + money(result.tailor_secured, result.currency) + ". No real money moved.";
        renderAll();
      })
      .catch(error => {
        toast(error.message || "The test balance could not be completed.");
        if (button) { button.disabled = false; button.textContent = "Test Pay Balance"; }
      });
    return;
  }
  if (!ONLINE_PAYMENTS_ENABLED) { toast("Online payments are not open yet. Please do not pay outside NebedaHub."); return; }
  toast("Protected checkout will be enabled after the payment provider is connected.");
}

function confirmCustomerOutfit(orderId, happy) {
  const order = findOrder(orderId);
  if (!order) return;
  const message = happy
    ? "Confirm you received the outfit and are happy? This releases the protected 30% to the tailor in TEST mode."
    : "Report a problem with the outfit? In TEST mode, the protected 30% is split using the current rule: 20% refund to you and 10% to the tailor.";
  if (!confirm(message)) return;
  Cloud.customerOutfitResult(order, happy)
    .then(result => {
      flashMessage = happy
        ? "TEST mode: final tailor balance released. No real money moved."
        : "TEST mode: " + money(result.customer_refund, result.currency) + " simulated refund to customer and " + money(result.tailor_release, result.currency) + " released to tailor. No real money moved.";
      renderAll();
    })
    .catch(error => toast(error.message || "Could not complete the protected payment step."));
}

// ---- Screen 20: Delivery tracking (step 15) ----

function deliveryTimeline(delivery) {
  const index = DELIVERY_STATUSES.indexOf(delivery.status);
  return `<ul class="track">${DELIVERY_STATUSES.map((s, i) => {
    const state = i < index || (i === index && s === "Delivered") ? "done" : i === index ? "now" : "";
    return `<li><span class="tdot ${state}"></span><span class="${state}-t">${s}</span></li>`;
  }).join("")}</ul>`;
}

function screenDelivery(orderId) {
  const order = findOrder(orderId);
  if (!order) return screenNotFound();
  const delivery = findDelivery(orderId);
  return `
    ${cTop("Delivery", "tracking/" + orderId)}
    <div class="content">
      ${delivery ? `
        <div class="selopt"><span class="fl">Courier</span><span>${escapeHtml(delivery.courier)}</span></div>
        <div class="selopt"><span class="fl">Tracking Number</span><span>${escapeHtml(delivery.tracking_number)}</span></div>
        <div class="selopt"><span class="fl">Estimated</span><span>${formatDate(delivery.eta)}</span></div>
        ${deliveryTimeline(delivery)}` : `<div class="empty">Not dispatched yet. You'll get a tracking number when ${escapeHtml(designerName(order.designer_id))} sends your order.</div>`}
    </div>
    ${cNav("orders")}`;
}

// ---- Screen 11: Review (step 16) ----

function screenReview(orderId) {
  const order = findOrder(orderId);
  if (!order) return screenNotFound();
  if (order.stage !== "delivered") {
    return `${cTop("Rate Your Order", "tracking/" + orderId)}<div class="content"><div class="empty">You can leave a review once your order is delivered.</div></div>`;
  }
  if (order.review_rating) {
    return `${cTop("Rate Your Order", "tracking/" + orderId)}<div class="content"><div class="empty">Thanks — you rated this order ${"★".repeat(order.review_rating)}.</div></div>`;
  }
  return `
    ${cTop("Rate Your Order", "tracking/" + orderId)}
    <div class="content">
      <form class="stack" onsubmit="return submitReview(event, '${order.id}')">
        <div class="fab-card centre">
          <div class="name">${escapeHtml(order.outfit_type)} — delivered</div>
          <div class="stars" role="radiogroup" aria-label="Star rating">${[1, 2, 3, 4, 5].map(n =>
            `<button type="button" role="radio" aria-checked="${reviewStars === n}" aria-label="${n} star${n > 1 ? "s" : ""}" class="${reviewStars >= n ? "on" : ""}" onclick="reviewStars=${n};renderAll()">★</button>`).join("")}</div>
          <div class="meta">Tap to rate</div>
        </div>
        <label class="field">Tell others about your outfit<textarea name="text" rows="3" placeholder="Optional"></textarea></label>
        <button class="cta" type="submit">Submit Review</button>
      </form>
    </div>`;
}

function submitReview(event, orderId) {
  event.preventDefault();
  const order = findOrder(orderId);
  order.review_rating = reviewStars;
  order.review_text = hideContactDetails(event.target.text.value.trim()).text;   // the database does the same
  order.updated_at = today();
  if (db.reviews) {
    // Live mode: reviews are their own table; the database copies it onto the order
    db.reviews.push({ id: Cloud.newId(), order_id: order.id, designer_id: order.designer_id, customer_id: order.customer_id,
      rating: order.review_rating, review_text: order.review_text, created_at: today() });
  }
  saveData();
  flashMessage = "Thank you for your review!";
  reviewStars = 5;
  go("tracking/" + orderId);
  return false;
}

// ---- Screen 19: Invoice ----

function invoiceBody(order) {
  const invoice = findInvoice(order.id);
  const customer = findCustomer(order.customer_id);
  const paid = amountPaid(order.id);
  const cur = (invoice && invoice.currency_code) || orderCurrency(order);
  return `
    <div class="invoice">
      <div class="row-between"><b class="serif">${escapeHtml(designerName(order.designer_id))}</b><span class="fl">via ${APP_NAME}</span></div>
      <div class="meta">Invoice ${escapeHtml(invoice ? invoice.id : "—")} · ${formatDate(invoice ? invoice.created_at : order.created_at)}</div>
      <div class="meta">Billed to ${escapeHtml(customer ? customer.name : "Customer")}${customer && customer.email ? " · " + escapeHtml(customer.email) : ""}</div>
      ${order.line_items.map(l => `<div class="qline"><span>${escapeHtml(l.label)}</span><span>${money(l.amount, cur)}</span></div>`).join("")}
      <div class="qtotal"><span>Total</span><span>${money(order.quote_total, cur)}</span></div>
      <div class="qline"><span>Paid</span><span>${money(paid, cur)}</span></div>
      <div class="qline"><b>Balance</b><b>${money(Math.max(order.quote_total - paid, 0), cur)}</b></div>
      ${exchangeRateHtml(order)}
      <div class="meta">All amounts in ${escapeHtml(currencyInfo(cur).name)} (${escapeHtml(cur)}).</div>
    </div>`;
}

function screenInvoice(orderId) {
  const order = findOrder(orderId);
  if (!order) return screenNotFound();
  if (!isPlaced(order)) return screenTracking(orderId);
  return `
    ${cTop("Invoice #" + order.id, "tracking/" + orderId)}
    <div class="content">
      ${invoiceBody(order)}
      <div class="optbtns two no-print">
        <button class="optbtn" onclick="window.print()">Download PDF</button>
        <button class="optbtn" onclick="shareInvoice('${order.id}')">Share</button>
      </div>
    </div>`;
}

function shareInvoice(orderId) {
  const order = findOrder(orderId);
  const cur = orderCurrency(order);
  const text = `${designerName(order.designer_id)} invoice for order ${order.id}: ${order.outfit_type}, total ${money(order.quote_total, cur)}, balance ${money(Math.max(balanceOwed(order), 0), cur)}.`;
  if (navigator.share) {
    navigator.share({ title: `Invoice ${order.id}`, text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast("Invoice summary copied to clipboard."), () => toast(text));
  } else {
    toast(text);
  }
}

// ---- Screens 21–22: Browse designers and designer profile ----
// Now "Find tailors near me" and each tailor's public page (tailors.js).
// The old addresses still work.

function screenDesigners() {
  return screenTailors();
}

function screenDesigner(id) {
  const d = designerById(id) || mainDesigner();
  if (d && d.slug) { go("tailor/" + d.slug, true); return ""; }
  return screenTailors();
}

// ---- Screen 18: Ready-to-wear shop (customer side) ----

let rtwShopSearch = "";
let rtwShopCategory = "All";

function rtwPublished(items) {
  return (items || []).filter(i => i.active !== false);
}

function rtwProductCard(item) {
  const designer = designerById(item.designer_id);
  const image = item.photo ? photoUrl(item.photo) : "";
  return `<article class="rtw-product-card">
    <button class="rtw-product-photo" onclick="go('rtwItem/${item.id}')">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}">` : `<div class="rtw-photo-empty">Product photo coming soon</div>`}
      ${item.featured ? '<span class="rtw-featured-badge">Featured</span>' : ""}
      ${item.stock <= 0 ? '<span class="rtw-soldout-badge">Sold out</span>' : ""}
    </button>
    <div class="rtw-product-info">
      <button class="rtw-product-name" onclick="go('rtwItem/${item.id}')">${escapeHtml(item.name)}</button>
      <div class="muted small-text">${escapeHtml(item.category || "Ready to wear")}${designer ? " · " + escapeHtml(designer.business_name) : ""}</div>
      <div class="rtw-product-price">${money(item.price, rtwCurrency(item))}${approxMoney(item.price, rtwCurrency(item))}</div>
      <div class="small-text">${item.stock > 0 ? item.stock + " in stock" : "Currently unavailable"}${(item.sizes || []).length ? " · " + escapeHtml(item.sizes.join(", ")) : ""}</div>
    </div>
  </article>`;
}

function screenRtw(designerId) {
  const allPublished = rtwPublished(db.ready_to_wear);
  const d = designerId ? designerById(designerId) : null;
  let items = d ? allPublished.filter(i => i.designer_id === d.id) : allPublished;
  const categories = ["All"].concat(Array.from(new Set(items.map(i => i.category || "Other"))).sort());

  if (!categories.includes(rtwShopCategory)) rtwShopCategory = "All";
  const q = String(rtwShopSearch || "").trim().toLowerCase();
  items = items.filter(i =>
    (rtwShopCategory === "All" || (i.category || "Other") === rtwShopCategory)
    && (!q || [i.name, i.category, i.description, (i.sizes || []).join(" "), (designerById(i.designer_id) || {}).business_name].join(" ").toLowerCase().includes(q))
  ).sort((a,b) => Number(!!b.featured)-Number(!!a.featured) || Number(b.stock>0)-Number(a.stock>0) || String(a.name).localeCompare(String(b.name)));

  const title = d ? d.business_name + " · Ready to Wear" : "Ready to Wear";
  const subtitle = d
    ? `Shop finished pieces from ${escapeHtml(d.business_name)}. These are ready-made products, not custom tailoring orders.`
    : "Shop ready-made fashion from approved NebedaHub designers.";

  return `
    ${cTop(title, d && d.slug ? "tailor/" + d.slug : "home")}
    <div class="content rtw-storefront">
      ${flash()}
      <section class="rtw-store-hero">
        <div><span class="eyebrow">NebedaHub Ready to Wear</span><h1>${escapeHtml(title)}</h1><p>${subtitle}</p></div>
        <div class="rtw-trust">Real products · Designer listed · Protected checkout when payments open</div>
      </section>

      <div class="rtw-shop-toolbar">
        <input aria-label="Search ready to wear" placeholder="Search products, sizes or designers" value="${escapeHtml(rtwShopSearch)}" oninput="rtwShopSearch=this.value;renderAll()">
        <div class="chips">${categories.map(cat => `<button class="chip ${rtwShopCategory===cat?"active":""}" onclick="rtwShopCategory='${escapeHtml(cat)}';renderAll()">${escapeHtml(cat)}</button>`).join("")}</div>
      </div>

      ${!items.length ? `<div class="empty">${d ? escapeHtml(d.business_name) + " has no matching ready-to-wear products right now." : "No ready-to-wear products are available yet."}</div>` : ""}
      <div class="rtw-product-grid">${items.map(rtwProductCard).join("")}</div>
    </div>
    ${cNav("tailors")}`;
}

function screenRtwItem(itemId) {
  const item = (db.ready_to_wear || []).find(i => i.id === itemId && i.active !== false);
  if (!item) return `${cTop("Product not found", "rtw")}<div class="content"><div class="empty">This product is no longer available.</div></div>${cNav("tailors")}`;
  const d = designerById(item.designer_id);
  const image = item.photo ? photoUrl(item.photo) : "";
  const sizes = item.sizes || [];
  return `
    ${cTop(item.name, d ? "rtw/" + d.id : "rtw")}
    <div class="content rtw-product-page">
      <div class="rtw-detail-grid">
        <div class="rtw-detail-photo">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}">` : '<div class="rtw-photo-empty">Product photo coming soon</div>'}</div>
        <div class="rtw-detail-info">
          <div class="muted">${escapeHtml(item.category || "Ready to wear")}</div>
          <h1>${escapeHtml(item.name)}</h1>
          <div class="rtw-detail-price">${money(item.price, rtwCurrency(item))}${approxMoney(item.price, rtwCurrency(item))}</div>
          ${d ? `<p>Sold by <a href="#/tailor/${escapeHtml(d.slug)}"><b>${escapeHtml(d.business_name)}</b></a></p>` : ""}
          <p>${escapeHtml(item.description || "Ready-to-wear piece from a NebedaHub designer.")}</p>
          ${sizes.length ? `<div><b>Available sizes</b><div class="rtw-size-list">${sizes.map(s => `<span>${escapeHtml(s)}</span>`).join("")}</div></div>` : ""}
          <div class="notice ${item.stock <= 2 ? "attention" : ""}">${item.stock > 0 ? item.stock + " available" : "Sold out"}</div>
          <button class="cta" onclick="buyRtw('${item.id}')" ${item.stock > 0 ? "" : "disabled"}>${item.stock > 0 ? "Buy this item" : "Sold out"}</button>
          <p class="meta">NebedaHub protected checkout is being connected. Do not send money directly outside the platform.</p>
        </div>
      </div>
    </div>
    ${cNav("tailors")}`;
}

function buyRtw(itemId) {
  const item = db.ready_to_wear.find(i => i.id === itemId);
  if (!item || item.stock <= 0) return;
  if (!ONLINE_PAYMENTS_ENABLED) {
    toast("Ready-to-wear checkout is not open yet. Please do not pay outside NebedaHub.");
    return;
  }
  toast("Protected ready-to-wear checkout will be enabled after the payment provider is connected.");
}

// ---- Profile ----

function screenProfile() {
  const customer = currentCustomer();
  const signIn = `
    ${Cloud.me ? `<div class="meta">Signed in as ${escapeHtml(Cloud.me.email)}</div>` : ""}
    <button class="btn-outline" onclick="Auth.signOut()">Sign out</button>`;
  if (!customer) {
    return `
      ${cTop("Profile")}
      <div class="content">
        <div class="empty">New here? Your profile is created when you save your measurements during your first order.</div>
        <button class="cta" onclick="startOrder()">Start an Order</button>
        ${signIn}
      </div>
      ${cNav("profile")}`;
  }
  return `
    ${cTop("Profile")}
    <div class="content">
      <div class="stat"><div class="l">Customer since ${escapeHtml(customer.created_at.slice(0, 4))}</div><div class="n">${escapeHtml(customer.name)}</div></div>
      <div class="mrow"><span>Orders</span><span>${customerOrders(customer.id).length}</span></div>
      <div class="mrow"><span>Total spent</span><span>${totalsHtml(customerSpend(customer.id), viewerCurrency())}</span></div>
      <div class="mrow"><span>Favourite colour</span><span>${escapeHtml(favouriteColour(customer.id))}</span></div>
      <div class="mrow"><span>Measurement profiles</span><span>${customer.measurement_profiles.map(p => p.label).sort().join(", ") || "None yet"}</span></div>
      <button class="cta" onclick="go('myMeasurements')">Edit Measurements</button>
      ${customerSettingsForm(customer)}
      ${signIn}
      ${Cloud.live ? "" : `<button class="linkish" onclick="signInAs('')">Sign out</button>`}
    </div>
    ${cNav("profile")}`;
}

// Where the customer is, the currency they see approximate prices in, inches or
// centimetres, and their phone number (with its country code)
function customerSettingsForm(customer) {
  const country = customer.country_code || browserCountry();
  const currency = customer.currency_code || countryCurrency(country) || "GBP";
  return `<form class="stack settings-form" onsubmit="return saveCustomerSettings(event)">
    <b>Your country, currency and measurements</b>
    <label class="field">Country<select name="country" onchange="suggestCurrency(this.form, this.value)">${countryOptions(country, "Choose your country")}</select></label>
    <label class="field">Show approximate prices in<select name="currency">${currencyOptions(currency)}</select></label>
    <label class="field">Body measurements in<select name="unit">
      <option value="in" ${customerBodyUnit(customer) === "in" ? "selected" : ""}>Inches</option>
      <option value="cm" ${customerBodyUnit(customer) === "cm" ? "selected" : ""}>Centimetres</option></select></label>
    <label class="field">Phone${phoneFieldHtml("phone", customer.phone || "", country)}</label>
    <p class="meta">Tailors charge in their own currency; we show "≈" prices in yours. Dates and times show in your time zone${timeZoneName() ? ` (${escapeHtml(timeZoneName())})` : ""}.</p>
    <button type="submit" class="btn-outline">Save</button>
  </form>`;
}

// Choosing a country picks its currency (it can still be changed)
function suggestCurrency(form, country) {
  const currency = countryCurrency(country);
  if (currency && form.currency) form.currency.value = currency;
  if (form.phone_cc && country) form.phone_cc.value = country;
}

function saveCustomerSettings(event) {
  event.preventDefault();
  const form = event.target;
  const customer = currentCustomer();
  if (!customer) return false;
  const phone = readPhone(form, "phone");
  if (phone && !phoneLooksRight(phone)) { toast("That phone number doesn't look right."); return false; }
  Object.assign(customer, { country_code: form.country.value || null, currency_code: form.currency.value || null,
    measurement_unit: form.unit.value === "cm" ? "cm" : "in", phone });
  saveData();
  toast("Saved.");
  renderAll();
  return false;
}

function signInAs(customerId) {
  db.session.customerId = customerId || null;
  saveData();
  renderAll();
}

function screenMyMeasurements() {
  const customer = currentCustomer();
  if (!customer) return screenProfile();
  const latest = latestProfile(customer);
  const older = customer.measurement_profiles.filter(p => p.label !== thisYear());
  return `
    ${cTop("My Measurements", "profile")}
    <div class="content">
      <form id="my-measure-form" class="stack" data-unit="${currentBodyUnit()}" onsubmit="return saveMyMeasurements(event)">
        <div class="meta">Saving to your ${thisYear()} profile. Earlier years are kept.</div>
        ${bodyUnitToggle("my-measure-form")}
        ${older.length ? `<div class="optbtns">${older.map(p => `<button type="button" class="optbtn" onclick="copyProfile('${p.id}')">Copy from ${p.label}</button>`).join("")}</div>` : ""}
        <div>${measurementRows(latest, currentBodyUnit())}</div>
        <button class="cta" type="submit">Save Measurements</button>
      </form>
    </div>
    ${cNav("profile")}`;
}

function saveMyMeasurements(event) {
  event.preventDefault();
  saveMeasurementProfile(currentCustomer(), readMeasurements(event.target));
  saveData();
  toast("Measurements saved.");
  go("profile");
  return false;
}

function screenNotFound() {
  return `${cTop("Not found", "home")}<div class="content"><div class="empty">We couldn't find that page.</div></div>${cNav("")}`;
}

// ---- Which function draws which customer screen ----

const CUSTOMER_SCREENS = {
  home: screenHome,
  outfit: screenOutfit,
  inspiration: screenInspiration,
  design: screenDesign,
  concept: screenConcept,
  measurements: screenMeasurements,
  fabric: screenFabric,
  market: screenMarket,
  fabricView: screenFabricView,
  send: screenSend,
  pay: screenPay,
  chat: screenChat,
  orders: screenOrders,
  tracking: screenTracking,
  delivery: screenDelivery,
  review: screenReview,
  invoice: screenInvoice,
  designers: screenDesigners,
  designer: screenDesigner,
  tailors: screenTailors,
  tailor: screenTailorPage,
  rtw: screenRtw,
  rtwItem: screenRtwItem,
  profile: screenProfile,
  myMeasurements: screenMyMeasurements
};

function renderCustomer(screen, id) {
  const redirect = flowRedirect(screen);
  if (redirect) {
    go(redirect, true);
    return;
  }
  const draw = CUSTOMER_SCREENS[screen] || screenNotFound;
  const el = document.getElementById("customer-app");
  el.innerHTML = draw(id);
  el.classList.toggle("is-hero", screen === "home");
  el.classList.toggle("is-wide", WIDE_SCREENS.includes(screen));
  el.classList.toggle("is-chat", screen === "chat");
  afterChatRender();
}
