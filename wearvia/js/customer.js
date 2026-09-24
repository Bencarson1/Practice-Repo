// ============================================================
// customer.js — the customer app: design, order, pay, track, review
// Follows the order lifecycle in WEARVIA-SPEC.md exactly:
//   1 outfit & design → 2 AI concept → 3 measurements → 4 fabric →
//   5 purchase → 6 quotation → 7 deposit → (8–15 production) → 16 review
// ============================================================

// The first seven steps happen in the customer app, one screen each
const FLOW = [
  { screen: "design", label: "Design" },
  { screen: "concept", label: "Concept" },
  { screen: "measurements", label: "Measure" },
  { screen: "fabric", label: "Fabric" },
  { screen: "fabricPurchase", label: "Buy" },
  { screen: "quote", label: "Quote" },
  { screen: "payment", label: "Deposit" }
];

// What must be done before each screen can open, and where to send the customer if it isn't
const FLOW_REQUIRES = {
  concept: ["designDone"],
  measurements: ["designDone", "conceptApproved"],
  fabric: ["designDone", "conceptApproved", "profileId"],
  fabricPurchase: ["designDone", "conceptApproved", "profileId", "purchased"],
  quote: ["designDone", "conceptApproved", "profileId", "purchased"],
  payment: ["designDone", "conceptApproved", "profileId", "purchased", "quoteReady"]
};
const FLAG_SCREEN = { designDone: "design", conceptApproved: "concept", profileId: "measurements", purchased: "fabric", quoteReady: "quote" };

let balanceMethod = "Card";
let reviewStars = 5;
let flashMessage = "";

function newDraft() {
  return {
    outfit: "Agbada", colour: "#1e2a44", embroidery: "Gold", sleeve: "Wide", neck: "Round",
    variation: 1, designDone: false, conceptApproved: false, profileId: null,
    fabricId: null, metres: 7, purchased: false, quoteReady: false,
    payMethod: "Card", fabricFilter: "All", inspiration: null
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
  const item = (screen, icon, label) =>
    `<button class="item ${active === screen ? "on" : ""}" onclick="go('${screen}')"><span aria-hidden="true">${icon}</span>${label}</button>`;
  return `<nav class="bottomnav" aria-label="Customer menu">
    ${item("home", "🏠", "Home")}
    ${item("orders", "📦", "Orders")}
    <button class="plus" onclick="go('outfit')" aria-label="Start an order">+</button>
    ${item("market", "🧶", "Fabrics")}
    ${item("designers", "🧵", "Shop")}
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

// Puts purchased fabric back in stock if the customer changes their mind
function returnDraftFabric() {
  const d = draft();
  if (!d.purchased) return;
  const fabric = findFabric(d.fabricId);
  if (fabric) {
    fabric.metres_available = Math.round((fabric.metres_available + d.metres) * 10) / 10;
    toast(`${d.metres} m of ${fabric.name} returned to stock.`);
  }
  d.purchased = false;
  d.quoteReady = false;
}

function resetAfterDesign() {
  const d = draft();
  returnDraftFabric();
  d.conceptApproved = false;
  d.profileId = null;
  d.quoteReady = false;
}

function setDesign(key, value) {
  const d = draft();
  if (d[key] === value) return;
  d[key] = value;
  if (key === "outfit") d.metres = findOutfit(value).metres;
  if (d.conceptApproved) resetAfterDesign();
  saveData();
  renderAll();
}

function startOver() {
  if (!confirm("Start a new order? Your current choices will be cleared.")) return;
  returnDraftFabric();
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
      <div class="brand">WEARVIA</div>
      <div class="tag">Bespoke · Ready to Wear · African Luxury</div>
      <div class="featured">Now on Wearvia: <b>${escapeHtml(SHOP_NAME)}</b> · ${escapeHtml(designer().location)}</div>
      <h2>Your Style.<br>Our Craft.<br>Timeless You.</h2>
      ${resume ? `<button class="btn" onclick="go('${resume.screen}')">Continue your ${escapeHtml(d.outfit)} order</button>` : ""}
      <button class="${resume ? "btn2" : "btn"}" onclick="go('outfit')">Start an Order</button>
      <button class="btn2" onclick="go('market')">Fabric Marketplace</button>
      <button class="btn2" onclick="go('designers')">Explore Designers</button>
      <button class="btn2" onclick="go('biz/dashboard')">Business Dashboard</button>
      <button class="linkish on-navy" onclick="go('seller')">Sell your fabric on ${APP_NAME} →</button>
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
          ${o.name}<span class="chip-sub">from ${money(o.tailoring)}</span></button>`).join("")}
      </div>
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

function measurementRows(values) {
  return MEASUREMENT_FIELDS.map(f => `
    <label class="mrow"><span>${f.label}${f.required ? "" : ' <small class="fl">(optional)</small>'}</span>
      <span><input name="${f.key}" type="number" inputmode="decimal" min="1" max="120" step="0.25" value="${values && values[f.key] != null ? values[f.key] : ""}" ${f.required ? "required" : ""}> in</span>
    </label>`).join("");
}

function screenMeasurements() {
  const customer = currentCustomer();
  const latest = latestProfile(customer);
  const older = customer ? customer.measurement_profiles.filter(p => p.label !== thisYear()) : [];
  return `
    ${cTop("My Measurements", "concept")}
    <div class="content">
      ${flowBar("measurements")}
      <form id="flow-measure-form" class="stack" onsubmit="return saveFlowMeasurements(event)">
        ${customer ? `<div class="meta">Saving to <b>${escapeHtml(customer.name)}</b>'s ${thisYear()} measurement profile.</div>` : `
          <div class="meta">Your measurements are saved to your profile so you only enter them once a year.</div>
          <label class="field">Your name<input name="name" required autocomplete="name"></label>
          <label class="field">Email<input name="email" type="email" autocomplete="email"></label>
          <label class="field">Phone<input name="phone" type="tel" autocomplete="tel"></label>`}
        ${older.length ? `<div class="optbtns">${older.map(p => `<button type="button" class="optbtn" onclick="copyProfile('${p.id}')">Copy from ${p.label}</button>`).join("")}</div>` : ""}
        <div>${measurementRows(latest && latest.label === thisYear() ? latest : null)}</div>
        <button class="cta" type="submit">Save &amp; Choose Fabric →</button>
      </form>
    </div>`;
}

function copyProfile(profileId) {
  const profile = findProfile(profileId);
  const form = document.querySelector("form[id$=measure-form]");
  MEASUREMENT_FIELDS.forEach(f => { if (profile[f.key] != null) form[f.key].value = profile[f.key]; });
}

function readMeasurements(form) {
  const values = {};
  MEASUREMENT_FIELDS.forEach(f => { values[f.key] = form[f.key].value; });
  return values;
}

function saveFlowMeasurements(event) {
  event.preventDefault();
  const form = event.target;
  let customer = currentCustomer();
  if (!customer) {
    customer = findOrCreateCustomer(form.name.value.trim(), form.phone.value.trim(), form.email.value.trim());
    db.session.customerId = customer.id;
  }
  const profile = saveMeasurementProfile(customer, readMeasurements(form));
  draft().profileId = profile.id;
  saveData();
  go("fabric");
  return false;
}

// ---- Screen 6: Fabric marketplace (step 4) ----
// The photo grid and filters are in marketplace.js

function screenFabric() {
  const d = draft();
  if (d.purchased) {
    const fabric = findFabric(d.fabricId);
    return `
      ${cTop("Fabric Marketplace", "measurements")}
      <div class="content">
        ${flowBar("fabric")}
        <div class="notice">You've already bought ${d.metres} m of ${escapeHtml(fabric.name)} for this order.</div>
        <button class="cta" onclick="go('fabricPurchase')">View purchase →</button>
        <button class="linkish" onclick="changeFabric()">Change fabric (returns ${d.metres} m to stock)</button>
      </div>`;
  }
  marketMode = "flow";
  let selected = findFabric(d.fabricId);
  let gone = "";
  if (selected && !isBuyable(selected)) {
    gone = `<div class="notice">${escapeHtml(selected.name)} is no longer available. Please choose another fabric.</div>`;
    d.fabricId = null;
    selected = null;
  }
  const seller = selected ? findSupplier(selected.supplier_id) : null;
  const enough = selected && d.metres <= selected.metres_available && d.metres >= selected.min_order_metres;

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
              <div class="meta">${escapeHtml(seller ? seller.name : "")} · ${money(selected.price_per_metre)} / m · ${selected.metres_available} m left</div></div>
          </div>
          <div class="qty">
            <span>Metres</span>
            <span class="stepper">
              <button type="button" onclick="changeMetres(-0.5)" aria-label="Less">−</button>
              <b>${d.metres}</b>
              <button type="button" onclick="changeMetres(0.5)" aria-label="More">+</button>
            </span>
            <b>${money(d.metres * selected.price_per_metre)}</b>
          </div>
          ${enough ? "" : `<div class="meta low">Only ${selected.metres_available} m in stock.</div>`}
          <button class="cta" onclick="buyFabric()" ${enough ? "" : "disabled"}>Buy Fabric →</button>
        </div>` : `<div class="pick-bar"><button class="cta" disabled>Tap a fabric to choose it</button></div>`}
    </div>`;
}

function changeMetres(delta) {
  const d = draft();
  const fabric = findFabric(d.fabricId);
  d.metres = Math.min(Math.max(d.metres + delta, fabric.min_order_metres), Math.max(fabric.metres_available, fabric.min_order_metres));
  saveData();
  renderAll();
}

function changeFabric() {
  returnDraftFabric();
  saveData();
  renderAll();
}

// Step 5: buying the fabric takes it out of stock straight away
function buyFabric() {
  const d = draft();
  const fabric = findFabric(d.fabricId);
  if (!fabric || !isBuyable(fabric) || d.metres > fabric.metres_available || d.metres < fabric.min_order_metres) {
    toast("That fabric isn't available in that amount any more.");
    renderAll();
    return;
  }
  fabric.metres_available = Math.round((fabric.metres_available - d.metres) * 10) / 10;
  d.purchased = true;
  d.quoteReady = false;
  saveData();
  go("fabricPurchase");
}

// ---- Screen 7: Fabric purchase confirmation (step 5) ----

function screenFabricPurchase() {
  const d = draft();
  const fabric = findFabric(d.fabricId);
  const supplier = findSupplier(fabric.supplier_id);
  return `
    ${cTop("Fabric Purchased", "fabric")}
    <div class="content">
      ${flowBar("fabricPurchase")}
      <div class="stat centre">
        <div class="l">✓ Purchase confirmed</div>
        <div class="n">${escapeHtml(fabric.name)}</div>
        <div class="l">from ${escapeHtml(supplier.name)}, ${escapeHtml(supplier.location)}</div>
      </div>
      <div class="qline"><span>${d.metres} metres × ${money(fabric.price_per_metre)}</span><span>${money(d.metres * fabric.price_per_metre)}</span></div>
      <div class="mrow"><span>Supplier delivery</span><span>${escapeHtml(supplier.delivery_estimate)} to ${escapeHtml(SHOP_NAME)}</span></div>
      <div class="meta">Remaining stock: ${fabric.metres_available} m</div>
      <button class="cta" onclick="continueToQuote()">Continue to Quotation →</button>
    </div>`;
}

// Step 6: the quotation is generated instantly
function continueToQuote() {
  draft().quoteReady = true;
  saveData();
  go("quote");
}

function draftQuote() {
  const d = draft();
  return computeQuote(d.outfit, d.embroidery, findFabric(d.fabricId), d.metres);
}

// ---- Screen 8: Quotation (step 6) ----

function screenQuote() {
  const quote = draftQuote();
  const deposit = depositFor(quote.total);
  return `
    ${cTop("Quotation", "fabricPurchase")}
    <div class="content">
      ${flowBar("quote")}
      ${quote.lines.map(l => `<div class="qline"><span>${escapeHtml(l.label)}</span><span>${money(l.amount)}</span></div>`).join("")}
      <div class="qtotal"><span>Total</span><span>${money(quote.total)}</span></div>
      <div class="meta">Deposit today ${money(deposit)} · balance ${money(quote.total - deposit)} after quality control.</div>
      <button class="cta" onclick="go('payment')">Proceed to Payment →</button>
    </div>`;
}

// ---- Screen 9: Payment (step 7) ----

function screenPayment() {
  const d = draft();
  const quote = draftQuote();
  const deposit = depositFor(quote.total);
  return `
    ${cTop("Payment", "quote")}
    <div class="content">
      ${flowBar("payment")}
      <div class="qline"><span>Order Total</span><span>${money(quote.total)}</span></div>
      <div class="qline"><span>Deposit Required (${Math.round(DEPOSIT_RATE * 100)}%)</span><span>${money(deposit)}</span></div>
      <div class="qline"><span>Balance (after quality control)</span><span>${money(quote.total - deposit)}</span></div>
      <div class="selopt"><span class="fl">Method</span>
        <span class="optbtns">${["Card", "Apple Pay", "Bank transfer"].map(m =>
          `<button class="optbtn ${d.payMethod === m ? "sel" : ""}" onclick="setPayMethod('${m}')">${m}</button>`).join("")}</span>
      </div>
      <div class="meta">Demo checkout — no real money is taken. Stripe connects here in the full version.</div>
      <button class="cta" onclick="payDeposit()">Pay ${money(deposit)} Deposit</button>
    </div>`;
}

function setPayMethod(method) {
  draft().payMethod = method;
  saveData();
  renderAll();
}

// Step 7 → 8: the deposit creates the order and a tailor is assigned
function payDeposit() {
  const d = draft();
  const quote = draftQuote();
  // The order belongs to whoever the measurements were saved for
  const owner = db.customers.find(c => c.measurement_profiles.some(p => p.id === d.profileId));
  const order = createPaidOrder({
    customerId: owner.id,
    outfit: d.outfit, colour: d.colour, embroidery: d.embroidery, sleeve: d.sleeve, neck: d.neck,
    variation: d.variation, profileId: d.profileId,
    fabric: findFabric(d.fabricId), metres: d.metres, quote,
    deposit: depositFor(quote.total), method: d.payMethod,
    inspiration: hasInspiration(d.inspiration)
      ? { photos: d.inspiration.photos.slice(), link: cleanStyleLink(d.inspiration.link) || "", note: d.inspiration.note || "" }
      : null
  });
  db.draft = null;
  saveData();
  flashMessage = `Deposit paid — thank you! Order ${order.id} is with ${SHOP_NAME}.`;
  go("tracking/" + order.id);
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
        <span><b>${escapeHtml(o.outfit_type)}</b> · ${o.id}<br><span class="fl">${escapeHtml(currentStepLabel(o) === "Complete" ? "Complete" : "Now: " + currentStepLabel(o))}</span></span><span>›</span></button>`).join("")}
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
    if (i === done && label === "Delivery" && findDelivery(order.id)) extra = ` <span class="fl">· ${escapeHtml(findDelivery(order.id).status)}</span>`;
    return `<li><span class="tdot ${state}"></span><span class="${state}-t">${i + 1}. ${label}</span>${extra}</li>`;
  }).join("")}</ul>`;
}

function screenTracking(orderId) {
  const order = findOrder(orderId);
  if (!order) return screenNotFound();
  const balance = balanceOwed(order);
  const delivery = findDelivery(order.id);
  const qcPassed = stageIndex(order) >= STAGES.findIndex(s => s.key === "quality_control");
  let action = "";
  if (order.stage === "delivered" && !order.review_rating) {
    action = `<button class="cta" onclick="go('review/${order.id}')">Leave a Review →</button>`;
  } else if (balance > 0 && qcPassed) {
    action = `
      <div class="selopt"><span class="fl">Pay by</span><span class="optbtns">${["Card", "Apple Pay", "Bank transfer"].map(m =>
        `<button class="optbtn ${balanceMethod === m ? "sel" : ""}" onclick="balanceMethod='${m}';renderAll()">${m}</button>`).join("")}</span></div>
      <button class="cta" onclick="payBalance('${order.id}')">Pay ${money(balance)} Balance</button>`;
  }
  return `
    ${cTop("Order #" + order.id, "orders")}
    <div class="content">
      ${flash()}
      <div class="order-head">
        <div class="thumb">${conceptSVG({ outfit: order.outfit_type, colour: order.colour, embroidery: order.embroidery, sleeve: order.sleeve_style, neck: order.neck_style }, order.concept_variation)}</div>
        <div>
          <div class="name">${escapeHtml(order.outfit_type)} by ${escapeHtml(SHOP_NAME)}</div>
          <div class="meta">Total ${money(order.quote_total)} · Paid ${money(amountPaid(order.id))}</div>
          <div class="meta">${balance > 0 ? `Balance ${money(balance)}${qcPassed ? " — due now" : " after quality control"}` : "Paid in full"}</div>
          <div class="meta">Due ${formatDate(order.due_date)}</div>
        </div>
      </div>
      ${action}
      ${inspirationBlock(order.id, order.inspiration)}
      ${lifecycleList(order)}
      ${order.review_rating ? `<div class="meta">Your review: ${"★".repeat(order.review_rating)} ${escapeHtml(order.review_text)}</div>` : ""}
      <div class="optbtns">
        <button class="optbtn" onclick="go('invoice/${order.id}')">Invoice</button>
        ${delivery ? `<button class="optbtn" onclick="go('delivery/${order.id}')">Track delivery</button>` : ""}
      </div>
      <div class="meta">${escapeHtml(SHOP_NAME)} updates each stage as your outfit is made.</div>
    </div>
    ${cNav("orders")}`;
}

// Step 14: the customer pays the balance after quality control
function payBalance(orderId) {
  const order = findOrder(orderId);
  const balance = balanceOwed(order);
  if (balance <= 0) return;
  recordOrderPayment(order, balance, balanceMethod);
  saveData();
  flashMessage = `Balance of ${money(balance)} paid. Your outfit is ready for delivery.`;
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
        ${deliveryTimeline(delivery)}` : `<div class="empty">Not dispatched yet. You'll get a tracking number when ${escapeHtml(SHOP_NAME)} sends your order.</div>`}
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
  order.review_text = event.target.text.value.trim();
  order.updated_at = today();
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
  return `
    <div class="invoice">
      <div class="row-between"><b class="serif">${escapeHtml(SHOP_NAME)}</b><span class="fl">via ${APP_NAME}</span></div>
      <div class="meta">Invoice ${escapeHtml(invoice ? invoice.id : "—")} · ${formatDate(invoice ? invoice.created_at : order.created_at)}</div>
      <div class="meta">Billed to ${escapeHtml(customer ? customer.name : "Customer")}${customer && customer.email ? " · " + escapeHtml(customer.email) : ""}</div>
      ${order.line_items.map(l => `<div class="qline"><span>${escapeHtml(l.label)}</span><span>${money(l.amount)}</span></div>`).join("")}
      <div class="qtotal"><span>Total</span><span>${money(order.quote_total)}</span></div>
      <div class="qline"><span>Paid</span><span>${money(paid)}</span></div>
      <div class="qline"><b>Balance</b><b>${money(Math.max(order.quote_total - paid, 0))}</b></div>
    </div>`;
}

function screenInvoice(orderId) {
  const order = findOrder(orderId);
  if (!order) return screenNotFound();
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
  const text = `${SHOP_NAME} invoice for order ${order.id}: ${order.outfit_type}, total ${money(order.quote_total)}, balance ${money(Math.max(balanceOwed(order), 0))}.`;
  if (navigator.share) {
    navigator.share({ title: `Invoice ${order.id}`, text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast("Invoice summary copied to clipboard."), () => toast(text));
  } else {
    toast(text);
  }
}

// ---- Screens 21–22: Browse designers and designer profile ----

function screenDesigners() {
  const d = designer();
  const r = designerRating();
  return `
    ${cTop("Designers Near You")}
    <div class="content">
      <button class="fab-card" onclick="go('designer')">
        <div class="name">${escapeHtml(d.business_name)}</div>
        <div class="meta">${escapeHtml(d.location)} · ⭐ ${r.rating} (${r.count} reviews)</div>
        <div class="meta">${escapeHtml(d.speciality_tags.join(", "))}</div>
      </button>
      <div class="empty">${escapeHtml(SHOP_NAME)} is the first designer on ${APP_NAME}. More designers are joining soon.</div>
      <button class="fab-card" onclick="go('market')">
        <div class="name">Fabric Marketplace</div>
        <div class="meta">${activeFabrics().filter(isOnMarket).length} fabrics from ${new Set(activeFabrics().filter(isOnMarket).map(f => f.supplier_id)).size} independent sellers</div>
      </button>
    </div>
    ${cNav("designers")}`;
}

function screenDesigner() {
  const d = designer();
  const r = designerRating();
  const reviews = db.orders.filter(o => o.review_rating).slice(-3).reverse();
  return `
    ${cTop(escapeHtml(d.business_name), "designers")}
    <div class="content">
      <div class="stat"><div class="l">Rating</div><div class="n">⭐ ${r.rating} (${r.count} reviews)</div></div>
      <div class="mrow"><span>Location</span><span>${escapeHtml(d.location)}</span></div>
      <div class="mrow"><span>Delivery time</span><span>${escapeHtml(d.delivery_time)}</span></div>
      <div class="mrow"><span>Speciality</span><span>${escapeHtml(d.speciality_tags.join(", "))}</span></div>
      ${reviews.map(o => `<div class="review"><span class="gold">${"★".repeat(o.review_rating)}</span> ${escapeHtml(o.review_text || o.outfit_type)}<div class="fl">${escapeHtml(customerName(o.customer_id).split(" ")[0])} · ${escapeHtml(o.outfit_type)}</div></div>`).join("")}
      <button class="cta" onclick="go('outfit')">Request Custom Outfit</button>
      <button class="btn-outline" onclick="go('rtw')">View Ready to Wear</button>
    </div>
    ${cNav("designers")}`;
}

// ---- Screen 18: Ready-to-wear shop (customer side) ----

function screenRtw() {
  return `
    ${cTop("Ready to Wear", "designer")}
    <div class="content">
      ${flash()}
      <div class="chip-grid">
        ${db.ready_to_wear.map(item => `<div class="chip rtw">
          <div class="rtw-swatch" style="background:${item.color}"></div>
          ${escapeHtml(item.name)}<span class="chip-sub gold">${money(item.price)}</span>
          <span class="chip-sub">${item.stock > 0 ? item.stock + " in stock" : "Sold out"}</span>
          <button class="optbtn sel" onclick="buyRtw('${item.id}')" ${item.stock > 0 ? "" : "disabled"}>Buy</button>
        </div>`).join("")}
      </div>
    </div>
    ${cNav("designers")}`;
}

function buyRtw(itemId) {
  const item = db.ready_to_wear.find(i => i.id === itemId);
  if (!item || item.stock <= 0) return;
  if (!confirm(`Buy ${item.name} for ${money(item.price)}? (Demo checkout — no real money is taken.)`)) return;
  item.stock -= 1;
  const highest = db.rtw_sales.reduce((max, s) => Math.max(max, Number(s.id.slice(2))), 0);
  db.rtw_sales.push({ id: "RS" + (highest + 1), item_id: item.id, customer_id: db.session.customerId, price: item.price, cost: item.cost, date: today() });
  saveData();
  flashMessage = `${item.name} bought — ${SHOP_NAME} will post it to you.`;
  renderAll();
}

// ---- Profile ----

function screenProfile() {
  const customer = currentCustomer();
  const signIn = `
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
      <div class="mrow"><span>Total spent</span><span>${money(customerSpend(customer.id))}</span></div>
      <div class="mrow"><span>Favourite colour</span><span>${escapeHtml(favouriteColour(customer.id))}</span></div>
      <div class="mrow"><span>Measurement profiles</span><span>${customer.measurement_profiles.map(p => p.label).sort().join(", ") || "None yet"}</span></div>
      <button class="cta" onclick="go('myMeasurements')">Edit Measurements</button>
      ${signIn}
      <button class="linkish" onclick="signInAs('')">Sign out</button>
    </div>
    ${cNav("profile")}`;
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
      <form id="my-measure-form" class="stack" onsubmit="return saveMyMeasurements(event)">
        <div class="meta">Saving to your ${thisYear()} profile. Earlier years are kept.</div>
        ${older.length ? `<div class="optbtns">${older.map(p => `<button type="button" class="optbtn" onclick="copyProfile('${p.id}')">Copy from ${p.label}</button>`).join("")}</div>` : ""}
        <div>${measurementRows(latest)}</div>
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
  fabricPurchase: screenFabricPurchase,
  quote: screenQuote,
  payment: screenPayment,
  orders: screenOrders,
  tracking: screenTracking,
  delivery: screenDelivery,
  review: screenReview,
  invoice: screenInvoice,
  designers: screenDesigners,
  designer: screenDesigner,
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
}
