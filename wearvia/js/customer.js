// ============================================================
// customer.js — the customer app: design, send to the tailor, chat,
// accept the quote, pay, track, review
// Follows the order lifecycle in WEARVIA-SPEC.md exactly:
//   1 outfit & design → 2 AI concept → 3 measurements → 4 fabric → send to tailor →
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
  send: ["designDone", "conceptApproved", "profileId", "fabricId"]
};
const FLAG_SCREEN = { designDone: "design", conceptApproved: "concept", profileId: "measurements", fabricId: "fabric" };

let balanceMethod = "Card";
let depositMethod = "Card";
let reviewStars = 5;
let flashMessage = "";

function newDraft() {
  return {
    outfit: "Agbada", colour: "#1e2a44", embroidery: "Gold", sleeve: "Wide", neck: "Round",
    variation: 1, designDone: false, conceptApproved: false, profileId: null,
    fabricId: null, fabricFilter: "All", inspiration: null, tailorNote: ""
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
    <button class="plus" onclick="go('outfit')" aria-label="Start an order">+</button>
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
  return `
    <div class="hero">
      <div class="brand">${APP_NAME}</div>
      <div class="tagline">${APP_TAGLINE}</div>
      <h2>Your Style.<br>Our Craft.<br>Timeless You.</h2>
      <button class="btn near-btn" onclick="go('tailors')"><span aria-hidden="true">📍</span> Find tailors near me</button>
      ${resume ? `<button class="btn2" onclick="go('${resume.screen}')">Continue your ${escapeHtml(d.outfit)} order with ${escapeHtml(draftDesigner().business_name)}</button>` : ""}
      <button class="btn2" onclick="go('outfit')">Start an Order${d && d.designerId ? "" : ` with ${escapeHtml(draftDesigner().business_name)}`}</button>
      <button class="btn2" onclick="go('market')">Fabric Marketplace</button>
      ${Cloud.isTeam() ? `<button class="btn2" onclick="go('biz/dashboard')">Business Dashboard</button>` : ""}
      <button class="linkish on-navy" onclick="go('seller')">Sell your fabric on ${APP_NAME} →</button>
      <button class="linkish on-navy" onclick="go('for-tailors')">Are you a tailor or designer? Join ${APP_NAME} →</button>
    </div>
    ${cNav("home")}`;
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
          ${o.name}<span class="chip-sub">from ${money(o.tailoring)}${approxMoney(o.tailoring, screenCurrency())}</span></button>`).join("")}
      </div>
      ${approxNote(screenCurrency())}
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
        <div class="meta">Pick the options closest to your photos — they set your price. Anything different goes in your note.</div>` : ""}
      <div class="selopt"><span class="fl">Colour <b>${escapeHtml(colourName(d.colour))}</b></span>
        <span class="swatches">
          ${COLOURS.map(c => `<button class="sw ${d.colour === c.hex ? "sel" : ""}" style="background:${c.hex}" title="${c.name}" aria-label="${c.name}" onclick="setDesign('colour','${c.hex}')"></button>`).join("")}
        </span>
      </div>
      <div class="selopt"><span class="fl">Embroidery</span><span class="optbtns">${opts("embroidery", EMBROIDERY.map(e => e.name))}</span></div>
      <div class="selopt"><span class="fl">Sleeve</span><span class="optbtns">${opts("sleeve", SLEEVES)}</span></div>
      <div class="selopt"><span class="fl">Neck</span><span class="optbtns">${opts("neck", NECKS)}</span></div>
      <button class="cta" onclick="generateConcept()">Generate AI Concept →</button>
    </div>`;
}

function generateConcept() {
  const d = draft();
  d.designDone = true;
  saveData();
  go("concept");
}

// ---- Screen 4: AI design concept (step 2) ----

let conceptGenerating = false; // true while "Generating…" shows after Regenerate

function screenConcept() {
  const d = draft();
  const busy = conceptGenerating;
  return `
    ${cTop("AI Design Concept", "design")}
    <div class="content">
      ${flowBar("concept")}
      ${inspirationBlock("draft", d.inspiration)}
      ${hasInspiration(d.inspiration) ? `<b class="insp-title">Our concept</b>` : ""}
      <div class="fab-card concept">
        <div class="concept-art ${busy ? "generating" : ""}" aria-busy="${busy}">
          ${conceptSVG(d, d.variation)}
          ${busy ? `<div class="gen-overlay" role="status"><span class="gen-spin"></span>Generating…</div>` : ""}
        </div>
        <div class="name">${escapeHtml(d.outfit)} · ${escapeHtml(d.embroidery)} embroidery · ${escapeHtml(d.sleeve)} sleeve</div>
        <div class="meta">${escapeHtml(colourName(d.colour))} · ${escapeHtml(d.neck)} neck · AI-generated concept based on your choices · Variation ${d.variation}</div>
      </div>
      <div class="optbtns two">
        <button class="optbtn" onclick="regenerateConcept()" ${busy ? "disabled" : ""}>↻ Regenerate</button>
        <button class="optbtn sel" onclick="approveConcept()" ${busy ? "disabled" : ""}>✓ Approve Concept</button>
      </div>
      <button class="linkish" onclick="go('design')">Change my options</button>
    </div>`;
}

function regenerateConcept() {
  if (conceptGenerating) return;
  conceptGenerating = true;
  renderAll();
  setTimeout(() => {
    const d = draft();
    d.variation += 1;
    d.conceptApproved = false;
    conceptGenerating = false;
    saveData();
    renderAll();
  }, 1000);
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
      ${selected ? `
        <div class="pick-bar">
          <div class="pick-head">
            <img src="${fabricCoverUrl(selected)}" alt="">
            <div><div class="name">${escapeHtml(selected.name)}</div>
              <div class="meta">${escapeHtml(seller ? seller.name : "")} · ${fabricPriceText(selected, unit)}${approxMoney(pricePerUnit(selected.price_per_yard, unit), fabricCurrency(selected))} · ${lengthText(selected.yards_available, unit)} left</div></div>
          </div>
          <div class="meta">Your tailor works out how many ${unitWord(unit, true)} you need with you. Nothing is bought yet.</div>
          <button class="cta" onclick="go('send')">Continue with this fabric →</button>
        </div>` : `<div class="pick-bar"><button class="cta" disabled>Tap a fabric to choose it</button></div>`}
    </div>`;
}

// ---- Send to tailor (end of step 4) ----

function screenSend() {
  const d = draft();
  const fabric = findFabric(d.fabricId);
  if (!fabric || !isBuyable(fabric)) {
    d.fabricId = null;
    return screenFabric();
  }
  const seller = findSupplier(fabric.supplier_id);
  const profile = findProfile(d.profileId);
  const photos = hasInspiration(d.inspiration) ? d.inspiration.photos.length : 0;
  const tailoring = findOutfit(d.outfit).tailoring;
  const embroidery = embroideryPrice(d.embroidery);
  const tailor = draftDesigner();
  const currency = designerCurrency(tailor);
  const unit = designerFabricUnit(tailor);
  const fc = fabricCurrency(fabric);
  const perUnit = pricePerUnit(fabric.price_per_yard, unit);
  return `
    ${cTop("Send to Tailor", "fabric")}
    <div class="content">
      ${flowBar("send")}
      <div class="order-head">
        <div class="thumb">${conceptSVG(d, d.variation)}</div>
        <div>
          <div class="name">${escapeHtml(d.outfit)} by ${escapeHtml(draftDesigner().business_name)}</div>
          <div class="meta">${escapeHtml(colourName(d.colour))} · ${escapeHtml(d.embroidery)} embroidery · ${escapeHtml(d.sleeve)} sleeve · ${escapeHtml(d.neck)} neck</div>
        </div>
      </div>
      <div class="mrow"><span>Style photos</span><span>${photos ? `${photos} attached` : "None"}</span></div>
      <div class="mrow"><span>Measurements</span><span>${profile ? `Saved (${escapeHtml(profile.label)})` : "Saved"}</span></div>
      <div class="pick-head">
        <img src="${fabricCoverUrl(fabric)}" alt="">
        <div><div class="name">${escapeHtml(fabric.name)}</div>
          <div class="meta">${fabricPriceText(fabric, unit)}${approxMoney(perUnit, fc)} · ${escapeHtml(seller ? seller.name : "")}</div></div>
        <button class="linkish" onclick="go('fabric')">Change</button>
      </div>
      <div class="send-next">
        <b>What happens next</b>
        <ol>
          <li>${escapeHtml(draftDesigner().business_name)} looks at your design, photos and measurements.</li>
          <li>You chat here in the app to agree how many ${unitWord(unit, true)} of fabric you need.</li>
          <li>They send your quote in ${escapeHtml(currencyInfo(currency).name)}: fabric (${unitWord(unit, true)} × ${money(perUnit, fc)}) + tailoring ${money(tailoring, currency)}${approxMoney(tailoring, currency)} + embroidery ${money(embroidery, currency)} + delivery ${money(DELIVERY_FEE, currency)}.</li>
          ${fc !== currency ? `<li>The seller prices this fabric in ${escapeHtml(currencyInfo(fc).name)}. ${escapeHtml(tailor.business_name)}'s quote converts it into ${escapeHtml(currencyInfo(currency).name)} at the day's exchange rate${fxRate(fc, currency) ? ` (today ${escapeHtml(rateText(fxRate(fc, currency), fc, currency))})` : ""}, and shows the rate used.</li>` : ""}
          <li>Accept it and pay a ${Math.round(DEPOSIT_RATE * 100)}% deposit. The fabric is only bought then.</li>
        </ol>
      </div>
      ${approxNote(currency) || approxNote(fc)}
      <label class="field"><span>Anything to tell the tailor? <small>(optional)</small></span>
        <textarea id="tailor-note" rows="3" maxlength="${CHAT_TEXT_MAX}" placeholder="e.g. It's for a wedding on 12 June. I'm 6ft 2 and like a loose fit."
          oninput="draft().tailorNote=this.value;saveData()">${escapeHtml(d.tailorNote || "")}</textarea></label>
      <button id="send-request" class="cta" onclick="sendToTailor()">Send to Tailor</button>
      <div class="meta centre">Nothing to pay now.</div>
    </div>`;
}

let sendingRequest = false;
function sendToTailor() {
  if (sendingRequest) return;
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
  if (!fabric || !isBuyable(fabric)) {
    toast("That fabric has just sold out. Please choose another.");
    d.fabricId = null;
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
    variation: d.variation, profileId: d.profileId, fabric,
    inspiration: hasInspiration(d.inspiration)
      ? { photos: d.inspiration.photos.slice(), link: cleanStyleLink(d.inspiration.link) || "", note: d.inspiration.note || "" }
      : null,
    note: (d.tailorNote || "").trim()
  });
  Promise.resolve(sent)
    .then(order => {
      db.session.customerId = owner.id;
      db.draft = null;
      saveData();
      flashMessage = `Sent! ${designerName(order.designer_id)} will chat with you here to agree the yards, then send your quote.`;
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
// no-leakage.sql: wearvia_delivery_details); the demo follows the same rule.
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
    <div class="mrow"><span>${side === "customer" ? tailor : "Your business address"}</span><span>${x.tailor_address ? escapeHtml(x.tailor_address) : side === "customer" ? "Not added yet — ask in the chat" : `Not added yet — add it in <a href="#/biz/profile">My profile</a>`}</span></div>
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
    <div class="meta">Deposit ${money(deposit, cur)} (${Math.round(DEPOSIT_RATE * 100)}%) · balance ${money(order.quote_total - deposit, cur)} after quality control.</div>
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
  return `<button class="${primary ? "cta" : "btn-outline"} chat-open" onclick="go('chat/${order.id}')">💬 Chat with ${escapeHtml(designerName(order.designer_id))}${unread ? ` <span class="chat-badge">${unread} new</span>` : ""}</button>`;
}

// What the customer can do now on an order that's still a request or a quote
function quoteBlock(order) {
  const status = quoteStatus(order);
  if (status === "requested") {
    return `<div class="quote-card waiting">
      <b>${escapeHtml(QUOTE_STATUS_LABELS.requested)}</b>
      ${order.fabric_problem ? `<div class="notice warn">${escapeHtml(order.fabric_problem)}. ${escapeHtml(designerName(order.designer_id))} will suggest another fabric in the chat.</div>` : ""}
      <div class="meta">${escapeHtml(designerName(order.designer_id))} will chat with you to agree how many yards of fabric you need, then send your quote here. Nothing is bought or charged until you accept it.</div>
      ${chatButton(order, true)}
    </div>`;
  }
  if (status === "quoted") {
    return `<div class="quote-card">
      <b>Your quote from ${escapeHtml(designerName(order.designer_id))}</b>
      ${quoteLinesHtml(order)}
      <button id="accept-quote" class="cta" onclick="acceptQuoteFromApp('${order.id}')">Accept quote</button>
      <button class="btn-outline" onclick="go('chat/${order.id}')">Ask a question</button>
      <div class="meta">When you accept, the fabric is bought for your outfit and you pay the ${Math.round(DEPOSIT_RATE * 100)}% deposit.</div>
      ${payProtectionLine()}
    </div>`;
  }
  return "";
}

let acceptingQuote = false;
function acceptQuoteFromApp(orderId) {
  const order = findOrder(orderId);
  if (!order || acceptingQuote) return;
  if (!confirm(`Accept the quote of ${money(order.quote_total, orderCurrency(order))}? The fabric is bought for your outfit and you'll pay a deposit of ${money(order.deposit_amount, orderCurrency(order))}.`)) return;
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
        flashMessage = "Quote accepted — your fabric is bought. Now pay your deposit and we'll start making your outfit.";
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
  const deposit = order.deposit_amount;
  const cur = orderCurrency(order);
  return `
    ${cTop("Pay Deposit", "tracking/" + order.id)}
    <div class="content">
      ${flash()}
      <div class="qline"><span>Order Total</span><span>${money(order.quote_total, cur)}</span></div>
      <div class="qline"><span>Deposit Required (${Math.round(DEPOSIT_RATE * 100)}%)</span><span>${money(deposit, cur)}${approxMoney(deposit, cur)}</span></div>
      <div class="qline"><span>Balance (after quality control)</span><span>${money(order.quote_total - deposit, cur)}</span></div>
      <div class="meta">You pay in ${escapeHtml(currencyInfo(cur).name)} (${escapeHtml(cur)}), ${escapeHtml(designerName(order.designer_id))}'s currency.</div>
      ${approxNote(cur)}
      <div class="selopt"><span class="fl">Method</span>
        <span class="optbtns">${["Card", "Apple Pay", "Bank transfer"].map(m =>
          `<button class="optbtn ${depositMethod === m ? "sel" : ""}" onclick="depositMethod='${m}';renderAll()">${m}</button>`).join("")}</span>
      </div>
      <label class="field">Delivery address <small>(optional — shared with ${escapeHtml(designerName(order.designer_id))} once your deposit is confirmed)</small>
        <input id="pay-address" maxlength="300" value="${escapeHtml(deliveryDetails(order).delivery_address)}" placeholder="House number, street, town, postcode" autocomplete="street-address"></label>
      ${payProtectionLine()}
      <div class="meta">Demo checkout — no real money is taken. Your deposit shows as <b>awaiting confirmation</b> until ${escapeHtml(designerName(order.designer_id))} confirms it. Stripe connects here in the full version.</div>
      <button id="pay-deposit" class="cta" onclick="payDeposit('${order.id}')">Pay ${money(deposit, cur)} Deposit</button>
    </div>`;
}

// Step 7: the deposit waits for Nebeda Threads to confirm it before production starts
function payDeposit(orderId) {
  const order = findOrder(orderId);
  if (!order || !isPlaced(order) || depositStarted(order)) return;
  const addressBox = document.getElementById("pay-address");
  const address = addressBox ? addressBox.value.trim() : "";
  if (address && Cloud.live) Cloud.setDeliveryAddress(order, address).catch(error => toast(error.message));
  else if (address) order.delivery_address = hideContactDetails(address).text;
  db.payments.push({
    id: nextPaymentId(), order_id: order.id, amount: order.deposit_amount, method: depositMethod, kind: "Deposit",
    date: today(), status: "awaiting_confirmation", currency_code: orderCurrency(order)
  });
  refreshOrderPayments(order);
  saveData();
  flashMessage = `Thank you! Your deposit of ${money(order.deposit_amount, orderCurrency(order))} is awaiting confirmation — we'll start as soon as it's confirmed.`;
  go("tracking/" + order.id);
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
  return `
    ${cTop("Chat · " + order.id, "tracking/" + order.id)}
    <div class="content chat-content" data-chat-scroll="${order.id}" onscroll="chatScrolled(this)">
      <details class="chat-brief">
        <summary>Your order: ${escapeHtml(order.outfit_type)}${hasInspiration(order.inspiration) ? " · style photos" : ""} · measurements</summary>
        ${inspirationBlock(order.id, order.inspiration)}
        <div class="meta">${escapeHtml(colourName(order.colour))} · ${escapeHtml(order.embroidery)} embroidery · ${escapeHtml(order.sleeve_style)} sleeve · ${escapeHtml(order.neck_style)} neck</div>
        ${fabric ? `<div class="meta">Fabric: <b>${escapeHtml(fabric.name)}</b> · ${fabricPriceText(fabric, unit)}${isPlaced(order) || status === "quoted" ? ` · ${lengthText(order.fabric_yards, unit)}` : ""}</div>` : ""}
        ${profile ? `<div class="chat-measure">${MEASUREMENT_FIELDS.filter(f => profile[f.key] != null).map(f => `<span>${f.label} <b>${bodyText(profile[f.key], customerBodyUnit(customer))}</b></span>`).join("")}</div>` : ""}
      </details>
      ${status === "quoted" ? `<div class="chat-quote-bar"><span>Quote: <b>${money(order.quote_total, cur)}</b> · deposit ${money(order.deposit_amount, cur)}</span>
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
        <button class="cta" onclick="go('outfit')">Start an Order</button>` : ""}
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
    action = `<button class="cta" onclick="go('pay/${order.id}')">Pay ${money(order.deposit_amount, cur)} Deposit →</button>`;
  } else if (order.stage === "delivered" && !order.review_rating) {
    action = `<button class="cta" onclick="go('review/${order.id}')">Leave a Review →</button>`;
  } else if (due > 0 && qcPassed) {
    action = `
      <div class="selopt"><span class="fl">Pay by</span><span class="optbtns">${["Card", "Apple Pay", "Bank transfer"].map(m =>
        `<button class="optbtn ${balanceMethod === m ? "sel" : ""}" onclick="balanceMethod='${m}';renderAll()">${m}</button>`).join("")}</span></div>
      <button class="cta" onclick="payBalance('${order.id}')">Pay ${money(due, cur)} Balance</button>
      ${payProtectionLine()}`;
  }
  return `
    ${cTop("Order #" + order.id, "orders")}
    <div class="content">
      ${flash()}
      <div class="order-head">
        <div class="thumb">${conceptSVG({ outfit: order.outfit_type, colour: order.colour, embroidery: order.embroidery, sleeve: order.sleeve_style, neck: order.neck_style }, order.concept_variation)}</div>
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
  recordOrderPayment(order, due, balanceMethod, today(), false);
  saveData();
  flashMessage = `Thank you! Your balance of ${money(due, orderCurrency(order))} is awaiting confirmation. Your outfit goes out for delivery once it's confirmed.`;
  renderAll();
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

function screenRtw(designerId) {
  const d = designerById(designerId) || mainDesigner();
  const items = rtwOf(d.id);
  return `
    ${cTop("Ready to Wear · " + escapeHtml(d.business_name), d.slug ? "tailor/" + d.slug : "tailors")}
    <div class="content">
      ${flash()}
      ${items.length ? "" : `<div class="empty">${escapeHtml(d.business_name)} has no ready-to-wear pieces right now.</div>`}
      <div class="chip-grid">
        ${items.map(item => `<div class="chip rtw">
          <div class="rtw-swatch" style="background:${item.color}"></div>
          ${escapeHtml(item.name)}<span class="chip-sub gold">${money(item.price, rtwCurrency(item))}${approxMoney(item.price, rtwCurrency(item))}</span>
          <span class="chip-sub">${item.stock > 0 ? item.stock + " in stock" : "Sold out"}</span>
          <button class="optbtn sel" onclick="buyRtw('${item.id}')" ${item.stock > 0 ? "" : "disabled"}>Buy</button>
        </div>`).join("")}
      </div>
    </div>
    ${cNav("tailors")}`;
}

function buyRtw(itemId) {
  const item = db.ready_to_wear.find(i => i.id === itemId);
  if (!item || item.stock <= 0) return;
  if (!confirm(`Buy ${item.name} for ${money(item.price, rtwCurrency(item))}? (Demo checkout — no real money is taken.)`)) return;
  if (!Cloud.live) item.stock -= 1; // live mode: the database takes it out of stock
  db.rtw_sales.push({ id: newId("RS", db.rtw_sales), item_id: item.id, customer_id: db.session.customerId, price: item.price, cost: item.cost,
    date: today(), status: "awaiting_confirmation", currency_code: rtwCurrency(item) });
  saveData();
  flashMessage = `${item.name} ordered — your payment is awaiting confirmation. ${designerName(item.designer_id || (mainDesigner() || {}).id)} will post it to you once it's confirmed.`;
  renderAll();
}

// ---- Profile ----

function screenProfile() {
  const customer = currentCustomer();
  const signIn = Cloud.live ? `
    ${Cloud.me ? `<div class="meta">Signed in as ${escapeHtml(Cloud.me.email)}</div>` : ""}
    <button class="btn-outline" onclick="Auth.signOut()">Sign out</button>` : `
    <label class="field">${customer ? "Switch customer (demo)" : "Sign in as an existing customer (demo)"}
      <select onchange="signInAs(this.value)">
        <option value="">— choose —</option>
        ${db.customers.map(c => `<option value="${c.id}" ${customer && customer.id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
      </select>
    </label>`;
  if (!customer) {
    return `
      ${cTop("Profile")}
      <div class="content">
        <div class="empty">New here? Your profile is created when you save your measurements during your first order.</div>
        <button class="cta" onclick="go('outfit')">Start an Order</button>
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
  joinTailor: screenJoinTailor,
  rtw: screenRtw,
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
