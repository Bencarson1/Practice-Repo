// ============================================================
// seller.js — NebedaHub Sellers (/sellers/), the fabric seller app
// A fabric seller applies (shop, contact details, what they sell, sample
// photos), waits while the NebedaHub team reviews the application, and
// once approved their fabrics go on the marketplace. They add and edit
// fabrics (up to 5 photos each), mark them in or out of stock, and move
// each order along: confirm the stock, then dispatch it to the customer's
// tailor with the courier and tracking number (and a photo if they like).
//
// Addresses: #/welcome (how it works, apply or sign in), #/apply, #/fabrics,
// #/new, #/edit/F12, #/orders, #/profile
// ============================================================

const SELLER_TABS = [
  { key: "fabrics", label: "My fabrics" },
  { key: "new", label: "Add a fabric" },
  { key: "orders", label: "Orders", badge: seller => sellerOrders(seller.id).filter(o => o.status === "new" || (o.status === "confirmed" && fabricOrderUnlocked(o))).length },
  { key: "profile", label: "Shop & application" }
];

let stallFilter = "All";
let sellerForm = null;   // photos (or logo) being edited, kept while the form is open
let sellerSaving = false;
let dispatchOpen = null; // the order whose "Dispatch" form is open

function renderSellerArea(screen, id) {
  const seller = currentSeller();
  const tabs = document.getElementById("seller-tabs");
  const content = document.getElementById("seller-content");
  let html, title;

  if (!seller) {
    const applying = (screen === "apply" || screen === "profile") && !Cloud.isGuest();
    tabs.innerHTML = `<a class="tab ${applying ? "" : "active"}" href="#/welcome">Sell on ${APP_NAME}</a>
      ${Cloud.isGuest() ? "" : `<a class="tab ${applying ? "active" : ""}" href="#/apply">Apply to sell</a>`}`;
    html = applying ? sellerProfileScreen(null) : sellerWelcome();
    title = applying ? "Apply to sell" : "Sell fabric";
  } else {
    const activeTab = screen === "edit" ? "new" : screen === "apply" ? "profile" : screen;
    tabs.innerHTML = SELLER_TABS.map(t => {
      const badge = t.badge ? t.badge(seller) : 0;
      return `<a class="tab ${t.key === activeTab ? "active" : ""}" href="#/${t.key}">${t.key === "new" && screen === "edit" ? "Edit fabric" : t.label}${badge ? `<span class="tab-badge" aria-label="${badge} to do">${badge}</span>` : ""}</a>`;
    }).join("");
    const screens = {
      fabrics: () => sellerStall(seller),
      new: () => sellerFabricForm(seller, null),
      edit: () => sellerFabricForm(seller, id),
      orders: () => sellerOrdersScreen(seller),
      profile: () => sellerProfileScreen(seller),
      apply: () => sellerProfileScreen(seller)
    };
    html = sellerShopStrip(seller) + sellerStatusPanel(seller) + (screens[screen] || screens.fabrics)();
    title = seller.name;
  }
  content.innerHTML = html;
  document.title = `${title} · ${APP.name}`;
}

function sellerStatusBadge(fabric) {
  if (isSoldOut(fabric) && fabric.status === "approved") return `<span class="badge status-soldout">Out of stock</span>`;
  return `<span class="badge status-${fabric.status}">${FABRIC_STATUS_LABELS[fabric.status]}</span>`;
}

// ---- Onboarding: how it works, apply or sign in ----

function sellerWelcome() {
  return `
    ${bizHeader(`Sell your fabric on ${APP_NAME}`, `Put your fabrics in front of customers and tailors on ${APP_NAME}, like a stall at the market. You're paid in your own currency, and every order goes straight to the customer's tailor.`)}
    ${Cloud.me ? `<div class="notice no-shop">This account (${escapeHtml(Cloud.me.email)}) isn't a fabric seller yet. <a href="#/apply"><b>Apply to sell</b></a>. Being a tailor and a fabric seller are separate approvals. Or <a href="${escapeHtml(appUrl("customer", ""))}">open the customer app</a>.</div>` : ""}
    <ol class="how-steps">
      <li><b>Apply</b><span>Your business, contact details, where you are, what you sell and a few sample photos.</span></li>
      <li><b>${APP_NAME} reviews it</b><span>We check every new seller. You can add your fabrics while you wait. Customers can't see them yet.</span></li>
      <li><b>Approved: start selling</b><span>Your fabrics go on the marketplace. Confirm each order, then send it to the customer's tailor with a tracking number.</span></li>
    </ol>
    <div class="card">
      <h2>Why sell on ${APP_NAME}</h2>
      <ul class="benefit-list">
        <li>Customers and tailors choosing fabric for their outfits</li>
        <li>Prices in your own currency, by the yard or the metre</li>
        <li>Secure payments through ${APP_NAME}</li>
        <li>Orders go straight to the tailor who's making the outfit</li>
      </ul>
    </div>
    <div class="two-col">
      <div class="card">
        <h2>New seller</h2>
        <p class="hint">The application takes about five minutes.</p>
        ${Cloud.isGuest() ? `<button class="gold" onclick="Auth.startSignUp()">Create your seller account</button>` : `<a class="button gold" href="#/apply">Start your application</a>`}
      </div>
      <div class="card">
        <h2>Already selling?</h2>
        ${Cloud.isGuest()
          ? `<p class="hint">Sign in to ${APP.name} to see your fabrics and orders.</p><button class="ghost" onclick="Auth.show('signIn')">Sign in</button>`
          : `<p class="hint">Your shop opens here once you've applied. Signed in with a different email? <button class="linkish strong" onclick="Auth.signOut()">Sign out</button> and sign in with the one your shop uses.</p>`}
      </div>
    </div>`;
}

function sellerSignIn(sellerId) {
  if (Cloud.live && !sellerId) { Auth.signOut(); return; }
  db.session.sellerId = sellerId || null;
  sellerForm = null;
  saveData();
  go(sellerId ? "fabrics" : "welcome");
}

function sellerShopStrip(seller) {
  return `
    <div class="shop-strip">
      <img class="logo" src="${sellerLogoUrl(seller)}" alt="${escapeHtml(seller.name)} logo">
      <div class="shop-strip-text">
        <b>${escapeHtml(seller.name)}</b>
        <small>${escapeHtml(seller.location)} · ${escapeHtml(seller.phone)} · delivers in ${escapeHtml(seller.delivery_estimate)}</small>
      </div>
      <button class="small ghost" onclick="sellerSignIn('')">Sign out</button>
    </div>`;
}

// ---- The application's progress: submitted → review → approved ----

function sellerStatusPanel(seller) {
  const status = seller.admin_status || "approved";
  if (status === "approved") return "";
  const step = (label, state) => `<li class="${state}"><span></span>${label}</li>`;
  if (status === "declined" || status === "hidden") {
    return `<div class="card attention seller-status">
      <h2>${status === "declined" ? "Your application needs a change" : "Your shop is hidden"}</h2>
      ${seller.admin_note ? `<p>The ${APP_NAME} team says: “${escapeHtml(seller.admin_note)}”</p>` : ""}
      ${status === "declined"
        ? `<p class="hint">Update your details in <a href="#/profile">Shop &amp; application</a>, then send it again.</p>
           <button class="gold" onclick="sellerResubmit()">Send my application again</button>`
        : `<p class="hint">Customers can't see your fabrics. Update your shop, then contact ${APP_NAME} to be shown again.</p>`}
    </div>`;
  }
  return `<div class="card attention seller-status">
    <ol class="status-steps" aria-label="Your application">
      ${step("Application submitted", "done")}${step(`${APP_NAME} review`, "now")}${step("Approved", "")}
    </ol>
    <p><b>Thanks for applying!</b> The ${APP_NAME} team is reviewing ${escapeHtml(seller.name)}${seller.submitted_at ? ` (sent ${formatDate(String(seller.submitted_at).slice(0, 10))})` : ""}. You can add your fabrics now — customers will see them once you're approved.</p>
  </div>`;
}

function sellerResubmit() {
  const seller = currentSeller();
  if (!seller) return;
  if (Cloud.live) {
    Cloud.resubmitSeller(seller.id).then(() => { toast("Application sent again. We'll review it soon."); renderAll(); }, error => toast(error.message));
    return;
  }
  resubmitSellerApplication(seller.id);
  saveData();
  toast("Application sent again. We'll review it soon.");
  renderAll();
}

// ---- My fabrics: the market stall ----

function sellerStall(seller) {
  const fabrics = sellerFabrics(seller.id).slice().sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")) || (Number(b.id.slice(1)) || 0) - (Number(a.id.slice(1)) || 0));
  const counts = {
    Live: fabrics.filter(f => f.status === "approved" && !isSoldOut(f)).length,
    Waiting: fabrics.filter(f => f.status === "pending").length,
    Hidden: fabrics.filter(f => f.status === "hidden").length,
    "Sold out": fabrics.filter(f => isSoldOut(f)).length
  };
  const tests = {
    All: () => true,
    Live: f => f.status === "approved" && !isSoldOut(f),
    Waiting: f => f.status === "pending",
    Hidden: f => f.status === "hidden",
    "Sold out": f => isSoldOut(f)
  };
  if (!tests[stallFilter]) stallFilter = "All";
  const shown = fabrics.filter(tests[stallFilter]);
  const newOrders = sellerOrders(seller.id).filter(o => o.status === "new").length;
  const unit = sellerFabricUnit(seller);

  const cards = shown.map(f => {
    const photos = fabricPhotoRefs(f);
    const soldOut = isSoldOut(f);
    return `
      <div class="stall-card">
        <div class="stall-photo">
          <img src="${photoUrl(photos[0])}" alt="${escapeHtml(f.name)}" loading="lazy">
          ${f.photos && f.photos.length > 1 ? `<span class="pcount">▣ ${f.photos.length}</span>` : ""}
          ${sellerStatusBadge(f)}
        </div>
        <div class="stall-info">
          <h3>${escapeHtml(f.name)}</h3>
          <p class="muted">${escapeHtml(f.category)} · ${escapeHtml(f.colour_name)}</p>
          <p><strong class="gold">${money(pricePerUnit(f.price_per_yard, unit), fabricCurrency(f))}</strong> per ${unitWord(unit)}</p>
          <p class="${soldOut ? "owed" : f.yards_available < LOW_STOCK_YARDS ? "owed" : ""}">${lengthText(f.yards_available, unit)} in stock${f.sold_out ? " · marked out of stock" : ""}</p>
          ${f.status === "hidden" ? `<p class="review-note">Hidden by ${APP_NAME}${f.review_note ? `: “${escapeHtml(f.review_note)}”` : ""}. Edit it and it goes back for checking.</p>` : ""}
          ${f.status === "pending" ? `<p class="muted small-text">The ${APP_NAME} team will check it soon.</p>` : ""}
          <div class="job-buttons">
            <a class="button small" href="#/edit/${f.id}">Edit</a>
            ${f.sold_out
              ? `<button class="small ghost" onclick="stallBackInStock('${f.id}')">Back in stock</button>`
              : `<button class="small ghost" onclick="stallSoldOut('${f.id}')">Mark out of stock</button>`}
            <button class="small danger" onclick="stallDelete('${f.id}')">Delete</button>
          </div>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="biz-head row-between wrap">
      <div><h1>My fabrics</h1><p class="muted">Your market stall. Customers see a fabric once the ${APP_NAME} team has approved it${isSellerLive(seller) ? "" : " and your shop"}.</p></div>
      <a class="button gold" href="#/new">+ Add a fabric</a>
    </div>
    ${newOrders ? `<div class="alerts"><a class="alert" href="#/orders">📦 ${newOrders} new order${newOrders > 1 ? "s" : ""} — confirm the stock</a></div>` : ""}
    <div class="chips">${["All", "Live", "Waiting", "Hidden", "Sold out"].map(k =>
      `<button class="chip ${k === stallFilter ? "active" : ""}" onclick="stallFilter='${k}';renderAll()">${k}${k === "All" ? ` (${fabrics.length})` : ` (${counts[k]})`}</button>`).join("")}</div>
    ${shown.length ? `<div class="stall-grid">${cards}</div>`
      : `<div class="card empty-card"><p class="empty">${fabrics.length ? "Nothing here." : "Your stall is empty."}</p>
        ${fabrics.length ? "" : `<a class="button gold" href="#/new">Add your first fabric</a>`}</div>`}`;
}

function stallSoldOut(fabricId) {
  const fabric = setFabricSoldOut(fabricId, true);
  saveData();
  toast(`${fabric.name} is marked out of stock. Customers can't buy it until you put it back in stock.`);
  renderAll();
}

function stallBackInStock(fabricId) {
  const fabric = findFabric(fabricId);
  if (fabric.yards_available < fabric.min_order_yards) {
    toast(`Add how many ${unitWord(sellerFabricUnit(currentSeller()), true)} you have first.`);
    go("edit/" + fabricId);
    return;
  }
  setFabricSoldOut(fabricId, false);
  saveData();
  toast(`${fabric.name} is back in stock.`);
  renderAll();
}

function stallDelete(fabricId) {
  const fabric = findFabric(fabricId);
  if (!confirm(`Delete ${fabric.name}? It comes off the marketplace and its photos are removed. Orders already placed stay in your Orders tab.`)) return;
  deleteSellerFabric(fabricId);
  saveData();
  toast(`${fabric.name} deleted.`);
  renderAll();
}

// ---- Add or edit a fabric ----

function sellerFabricForm(seller, fabricId) {
  const fabric = fabricId ? findFabric(fabricId) : null;
  if (fabricId && (!fabric || fabric.deleted_at || fabric.supplier_id !== seller.id)) {
    return `<div class="card"><p class="empty">We couldn't find that fabric on your stall.</p><a class="button" href="#/fabrics">Back to my fabrics</a></div>`;
  }
  const key = "fabric:" + (fabricId || "new");
  if (!sellerForm || sellerForm.key !== key) {
    sellerForm = { key, photos: fabric ? (fabric.photos || []).map(ref => ({ ref, url: photoUrl(ref) })) : [] };
  }
  const v = fabric || { name: "", category: "Ankara", colour_name: "Blue", price_per_yard: "", yards_available: "", min_order_yards: 1, description: "" };
  const option = (value, current) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`;
  // The seller's own currency, and yards or metres as their country sells fabric (stock is kept in yards)
  const unit = sellerFabricUnit(seller);
  const currency = sellerCurrency(seller);
  const places = currencyInfo(currency).decimals;
  const shownPrice = v.price_per_yard === "" ? "" : roundMoney(pricePerUnit(v.price_per_yard, unit), currency);
  const shownStock = v.yards_available === "" ? "" : lengthIn(v.yards_available, unit);
  const shownMin = lengthIn(v.min_order_yards, unit);
  return `
    <div class="biz-head"><h1>${fabric ? "Edit " + escapeHtml(fabric.name) : "Add a fabric"}</h1>
      <p class="muted">${fabric ? `${sellerStatusBadge(fabric)} ` : ""}${fabric && fabric.status === "approved"
        ? `Price and stock changes go live straight away. New photos, name, type, colour or description go to the ${APP_NAME} team for a quick check first.`
        : `The ${APP_NAME} team checks every new fabric before customers see it.`}</p></div>
    <form class="card fabric-form" onsubmit="return saveStallFabric(event, '${fabricId || ""}')" novalidate>
      <fieldset class="photo-field">
        <legend>Photos <small class="muted">(up to ${MAX_PHOTOS_PER_FABRIC} — the first one is the cover)</small></legend>
        <div id="photo-slots" class="photo-slots">${photoSlots()}</div>
        <p class="hint">Good light, the whole pattern, and a close-up. Photos are resized automatically.</p>
      </fieldset>
      <div class="form-grid">
        <label class="wide">Fabric name<input name="name" required maxlength="60" value="${escapeHtml(v.name)}" placeholder="e.g. Blue Harvest Ankara"></label>
        <label>Type<select name="category">${FABRIC_TYPES.map(t => option(t, v.category)).join("")}</select></label>
        <label>Main colour<select name="colour">${FABRIC_COLOURS.map(c => option(c.name, v.colour_name)).join("")}</select></label>
        <label>Price per ${unitWord(unit)} (${escapeHtml(currencyInfo(currency).symbol)} ${escapeHtml(currency)})<input name="price" type="number" inputmode="decimal" min="0" max="100000000" step="${places ? "0.01" : "1"}" required value="${shownPrice}" placeholder="e.g. ${escapeHtml(formatMoney(nicePrice((convertMoney(12.5, "GBP", currency) ?? 12.5), currency), currency).replace(/[^\d.,]/g, ""))}" data-original="${shownPrice}"></label>
        <label>${capitalize(unitWord(unit, true))} in stock<input name="stock" type="number" inputmode="decimal" min="0" max="10000" step="0.1" required value="${shownStock}" placeholder="e.g. 40" data-original="${shownStock}"></label>
        <label>Smallest order (${unitWord(unit, true)})<input name="min" type="number" inputmode="decimal" min="0.5" max="50" step="0.5" required value="${shownMin}" data-original="${shownMin}"></label>
        <p class="hint wide">Prices in ${escapeHtml(currencyInfo(currency).name)}, lengths in ${unitWord(unit, true)} — as set in your <a href="#/profile">shop profile</a>. Customers see an approximate price in their own currency, and each tailor's quote converts yours at the day's exchange rate. You're always paid in ${escapeHtml(currency)}.</p>
        <label class="wide">Description<textarea name="description" rows="4" maxlength="600" placeholder="What is it made of? How wide is it? What is it good for?">${escapeHtml(v.description || "")}</textarea></label>
      </div>
      <p id="fabric-form-error" class="form-error" role="alert"></p>
      <div class="job-buttons">
        <button type="submit" class="gold">${fabric ? "Save changes" : "Send for approval"}</button>
        <a class="button ghost" href="#/fabrics" onclick="sellerForm=null">Cancel</a>
      </div>
    </form>`;
}

function photoSlots() {
  const photos = sellerForm.photos;
  const tiles = photos.map((p, i) => `
    <div class="photo-slot">
      <img src="${p.url}" alt="Photo ${i + 1}">
      ${i === 0 ? `<span class="cover-tag">Cover</span>` : `<button type="button" class="slot-btn left" onclick="makeCoverPhoto(${i})" aria-label="Make photo ${i + 1} the cover">★</button>`}
      <button type="button" class="slot-btn" onclick="removeFormPhoto(${i})" aria-label="Remove photo ${i + 1}">×</button>
    </div>`).join("");
  const add = photos.length < MAX_PHOTOS_PER_FABRIC ? `
    <label class="photo-slot add">
      <input type="file" accept="image/*" multiple onchange="addFormPhotos(this)">
      <span>＋</span><small>Add photo${photos.length ? "" : "s"}<br>${photos.length}/${MAX_PHOTOS_PER_FABRIC}</small>
    </label>` : "";
  return tiles + add;
}

function redrawPhotoSlots() {
  const el = document.getElementById("photo-slots");
  if (el) el.innerHTML = photoSlots();
}

function addFormPhotos(input) {
  const room = MAX_PHOTOS_PER_FABRIC - sellerForm.photos.length;
  const files = Array.from(input.files || []);
  input.value = "";
  if (files.length > room) toast(`Only ${room} more photo${room === 1 ? "" : "s"} added — a fabric can have up to ${MAX_PHOTOS_PER_FABRIC}.`);
  formError("fabric-form-error", "");
  const form = sellerForm;
  files.slice(0, room).reduce((chain, file) => chain.then(() =>
    resizeImage(file, PHOTO_MAX_SIZE, 0.82)
      .then(url => {
        if (sellerForm !== form || form.photos.length >= MAX_PHOTOS_PER_FABRIC) return;
        form.photos.push({ ref: null, url });
        redrawPhotoSlots();
      })
      .catch(error => toast(error.message))
  ), Promise.resolve());
}

function removeFormPhoto(index) {
  sellerForm.photos.splice(index, 1);
  redrawPhotoSlots();
}

function makeCoverPhoto(index) {
  const [photo] = sellerForm.photos.splice(index, 1);
  sellerForm.photos.unshift(photo);
  redrawPhotoSlots();
}

function formError(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message;
  if (message) toast(message);
  return false;
}

function saveStallFabric(event, fabricId) {
  event.preventDefault();
  if (sellerSaving) return false;
  const form = event.target;
  const seller = currentSeller();
  const unit = sellerFabricUnit(seller);
  const currency = sellerCurrency(seller);
  const existing = fabricId ? findFabric(fabricId) : null;
  // Typed in the seller's unit; kept in yards. A number that wasn't changed keeps its exact stored value.
  const kept = (input, stored, convert) => existing && input.value === input.dataset.original ? stored : convert(Number(input.value));
  const values = {
    name: form.name.value.trim(),
    category: form.category.value,
    colour_name: form.colour.value,
    price_per_yard: kept(form.price, existing && existing.price_per_yard, x => pricePerYardFrom(roundMoney(x, currency), unit)),
    yards_available: kept(form.stock, existing && existing.yards_available, x => Math.round(yardsFrom(x, unit) * 100) / 100),
    min_order_yards: kept(form.min, existing && existing.min_order_yards, x => Math.round(yardsFrom(x, unit) * 100) / 100),
    description: form.description.value.trim()
  };
  if (!sellerForm.photos.length) return formError("fabric-form-error", "Add at least one photo of the fabric.");
  if (!values.name) return formError("fabric-form-error", "Give the fabric a name.");
  if (!form.price.value || !(values.price_per_yard > 0)) return formError("fabric-form-error", `Enter a price per ${unitWord(unit)} in ${currency}.`);
  if (form.stock.value === "" || !(values.yards_available >= 0)) return formError("fabric-form-error", `Enter how many ${unitWord(unit, true)} you have (0 or more).`);
  if (!(Number(form.min.value) >= 0.5)) return formError("fabric-form-error", `The smallest order must be at least 0.5 ${unit}.`);

  const before = fabricId ? (findFabric(fabricId).photos || []) : [];
  const photos = sellerForm.photos;
  sellerSaving = true;
  const button = form.querySelector("button[type=submit]");
  if (button) { button.disabled = true; button.textContent = "Saving…"; }

  Promise.all(photos.map(p => p.ref ? p.ref : PhotoStore.put(p.url)))
    .then(refs => {
      values.photos = refs;
      const result = saveSellerFabric(seller.id, fabricId || null, values);
      before.filter(ref => !refs.includes(ref)).forEach(ref => PhotoStore.remove(ref));
      saveData();
      sellerForm = null;
      toast(result.isNew ? `${values.name} sent to the ${APP_NAME} team for approval.`
        : result.needsReview ? `Saved. The ${APP_NAME} team will check your changes before customers see them.` : `${values.name} saved.`);
      stallFilter = "All";
      go("fabrics");
    })
    .catch(error => {
      console.warn(error);
      formError("fabric-form-error", Cloud.live ? "Couldn't upload the photos: " + (error.message || "please try again.") : "Couldn't save the photos — this browser's storage may be full. Try fewer or smaller photos.");
      if (button) { button.disabled = false; button.textContent = fabricId ? "Save changes" : "Send for approval"; }
    })
    .finally(() => { sellerSaving = false; });
  return false;
}

// ---- Orders for this seller's fabric: confirm the stock, then dispatch ----

function sellerOrdersScreen(seller) {
  const rows = sellerOrders(seller.id);
  const live = rows.filter(o => o.status !== "cancelled");
  const toConfirm = rows.filter(o => o.status === "new");
  const toSend = rows.filter(o => (o.status === "new" || o.status === "confirmed") && fabricOrderUnlocked(o));
  // Each currency on its own (a seller who changed currency keeps older sales in the old one)
  const earned = sumByCurrency(live, o => o.total, o => o.currency_code || sellerCurrency(seller));
  const unit = sellerFabricUnit(seller);
  const cards = rows.map(o => {
    const fabric = findFabric(o.fabric_id);
    const first = o.customer_first_name || customerName(o.customer_id).split(" ")[0];
    const sendTo = fabricOrderSendTo(o);
    const unlocked = fabricOrderUnlocked(o);
    const open = o.status !== "sent" && o.status !== "cancelled";
    const statusText = o.status === "sent" ? `Dispatched ${formatDate(o.sent_at)}` : FABRIC_ORDER_LABELS[o.status];
    return `
      <div class="sorder ${o.status}">
        <img src="${fabric ? fabricCoverUrl(fabric) : ""}" alt="">
        <div class="sorder-main">
          <div class="row-between"><b>${escapeHtml(o.fabric_name)}</b><span class="badge sstatus-${o.status}">${escapeHtml(statusText)}</span></div>
          <div class="muted small-text">${escapeHtml(o.ref || o.id)} · ordered ${formatDate(o.created_at)}${first ? ` · for ${escapeHtml(first)}'s outfit` : ""}</div>
          <div>${lengthText(o.yards, unit)} × ${money(pricePerUnit(o.price_per_yard, unit), o.currency_code || sellerCurrency(seller))} = <b>${money(o.total, o.currency_code || sellerCurrency(seller))}</b></div>
          <div class="small-text"><span class="muted">Send to the tailor:</span> <b>${escapeHtml(sendTo.name || "—")}</b>${sendTo.address ? ` — ${escapeHtml(sendTo.address)}`
            : open ? ` <span class="muted">(their address appears once the customer's deposit is confirmed)</span>` : ""}</div>
          ${o.status === "sent" ? `<div class="small-text">🚚 ${escapeHtml(o.courier || "Courier")} · tracking <b>${escapeHtml(o.tracking_number)}</b>${o.dispatch_note ? ` · ${escapeHtml(o.dispatch_note)}` : ""}</div>
            ${o.dispatch_photo ? `<img class="dispatch-photo" src="${photoUrl(o.dispatch_photo)}" alt="Dispatch photo">` : ""}` : ""}
          ${open ? `<div class="job-buttons">
            ${o.status === "new" ? `<button class="small gold" onclick="sellerConfirmStock('${o.id}')">Confirm stock</button>` : ""}
            ${unlocked ? `<button class="small ${o.status === "confirmed" ? "gold" : "ghost"}" onclick="toggleDispatch('${o.id}')">${dispatchOpen === o.id ? "Close" : "Dispatch…"}</button>`
              : `<span class="muted small-text">You can dispatch it once the customer's deposit is confirmed.</span>`}
          </div>` : ""}
          ${open && unlocked && dispatchOpen === o.id ? dispatchForm(o) : ""}
        </div>
      </div>`;
  }).join("");
  return `
    <div class="biz-head"><h1>Orders</h1><p class="muted">When a customer accepts their tailor's quote, the fabric they chose is ordered from you. Confirm you have it, then send it to their tailor once the deposit is confirmed.</p></div>
    <div class="statgrid">
      <div class="stat"><div class="l">To confirm</div><div class="n">${toConfirm.length}</div></div>
      <div class="stat"><div class="l">Ready to send</div><div class="n">${toSend.length}</div></div>
      <div class="stat"><div class="l">Dispatched</div><div class="n">${rows.filter(o => o.status === "sent").length}</div></div>
      <div class="stat"><div class="l">Sales</div><div class="n">${totalsHtml(earned, sellerCurrency(seller))}</div></div>
    </div>
    ${rows.length ? `<div class="sorders">${cards}</div>` : `<div class="card"><p class="empty">No orders yet. They'll appear here when a customer chooses your fabric.</p></div>`}`;
}

function dispatchForm(o) {
  if (!sellerForm || sellerForm.key !== "dispatch:" + o.id) sellerForm = { key: "dispatch:" + o.id, photo: null };
  return `<form class="dispatch-form" onsubmit="return sellerDispatch(event, '${o.id}')" novalidate>
    <fieldset class="ship-to"><legend>Where is it going?</legend>
      ${SHIP_TO_OPTIONS.map(x => `<label class="check"><input type="radio" name="ship_to" value="${x.key}" ${x.key === "tailor" ? "checked" : ""} ${x.ready ? "" : "disabled"}>
        ${escapeHtml(x.label)}${x.ready ? "" : ` <small class="muted">(coming soon)</small>`}</label>`).join("")}
    </fieldset>
    <div class="form-grid">
      <label>Courier<input name="courier" maxlength="80" placeholder="e.g. GIG Logistics, DHL, Royal Mail"></label>
      <label>Tracking number<input name="tracking" required maxlength="80" placeholder="e.g. GIG-48213377"></label>
      <label class="wide">Note for the tailor <small>(optional)</small><input name="note" maxlength="300" placeholder="e.g. Two parcels, 3 yd each"></label>
    </div>
    <div id="dispatch-photo-row" class="logo-row">${dispatchPhotoRow()}</div>
    <p id="dispatch-error" class="form-error" role="alert"></p>
    <button type="submit" class="gold">Mark as dispatched</button>
  </form>`;
}

function dispatchPhotoRow() {
  return `${sellerForm && sellerForm.photo ? `<img class="dispatch-photo" src="${sellerForm.photo.url}" alt="Parcel photo">` : ""}
    <label class="button small file-button">${sellerForm && sellerForm.photo ? "Change photo" : "Add a photo of the parcel or receipt"}<input type="file" accept="image/*" onchange="setDispatchPhoto(this)"></label>
    <small class="muted">Optional. Only you, the tailor and ${APP_NAME} can see it.</small>`;
}

function setDispatchPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const form = sellerForm;
  resizeImage(file, PHOTO_MAX_SIZE, 0.8)
    .then(url => {
      if (sellerForm !== form) return;
      form.photo = { url };
      const row = document.getElementById("dispatch-photo-row");
      if (row) row.innerHTML = dispatchPhotoRow();
    })
    .catch(error => toast(error.message));
}

function toggleDispatch(lineId) {
  dispatchOpen = dispatchOpen === lineId ? null : lineId;
  sellerForm = null;
  renderAll();
}

function sellerConfirmStock(lineId) {
  const row = confirmFabricOrder(lineId);
  if (!row) return;
  saveData();
  toast(`${row.ref || row.id}: stock confirmed. The tailor can see it's on its way.`);
  renderAll();
}

function sellerDispatch(event, lineId) {
  event.preventDefault();
  if (sellerSaving) return false;
  const form = event.target;
  const details = { courier: form.courier.value.trim(), tracking_number: form.tracking.value.trim(), dispatch_note: form.note.value.trim(),
                    ship_to: (form.querySelector("[name=ship_to]:checked") || {}).value || "tailor" };
  if (!details.tracking_number) return formError("dispatch-error", "Add the tracking number so the tailor can follow the parcel.");
  if (hideContactDetails(details.dispatch_note).hidden) return formError("dispatch-error", "The note can't include a phone number, email, website or social handle.");
  const photo = sellerForm && sellerForm.photo;
  sellerSaving = true;
  const button = form.querySelector("button[type=submit]");
  if (button) { button.disabled = true; button.textContent = "Saving…"; }
  Promise.resolve(photo ? PhotoStore.put(photo.url, "seller-file") : null)
    .then(ref => {
      details.dispatch_photo = ref;
      const row = dispatchFabricOrder(lineId, details);
      if (!row) throw new Error("That order can't be dispatched.");
      saveData();
      dispatchOpen = null;
      sellerForm = null;
      toast(`${row.ref || row.id} dispatched. The tailor can see the tracking number.`);
      renderAll();
    })
    .catch(error => {
      formError("dispatch-error", error.message || "Couldn't save. Please try again.");
      if (button) { button.disabled = false; button.textContent = "Mark as dispatched"; }
    })
    .finally(() => { sellerSaving = false; });
  return false;
}

// ---- Shop & application (apply, or edit it later) ----

function sellerProfileScreen(seller) {
  const key = "profile:" + (seller ? seller.id : "new");
  if (!sellerForm || sellerForm.key !== key) {
    sellerForm = { key, logo: seller && seller.logo ? { ref: seller.logo, url: photoUrl(seller.logo) } : null,
      samples: (seller && seller.sample_photos || []).map(ref => ({ ref, url: photoUrl(ref) })) };
  }
  const me = Cloud.live && Cloud.me ? Cloud.me : {};
  const v = seller || { name: "", location: "", city: "", phone: "", delivery_estimate: "1–3 days", country_code: browserCountry() || "",
    contact_name: me.name || "", email: me.email || "", address_line: "", postcode: "", sells: "" };
  const currency = (seller && seller.currency_code) || countryCurrency(v.country_code) || "GBP";
  const times = DELIVERY_TIMES.includes(v.delivery_estimate) ? DELIVERY_TIMES : DELIVERY_TIMES.concat(v.delivery_estimate);
  const field = (label, name, value, attrs) => `<label>${label}<input name="${name}" value="${escapeHtml(value || "")}" ${attrs || ""}></label>`;
  const approved = seller && isSellerLive(seller);
  return `
    <div class="biz-head"><h1>${seller ? "Shop & application" : "Apply to sell on " + APP_NAME}</h1>
      <p class="muted">${seller ? `Status: <b>${escapeHtml(SELLER_STATUS_LABELS[seller.admin_status || "approved"])}</b>. ` : ""}Customers and tailors only see your shop name, area, logo and fabrics. Your contact details, address and application are private: only you and the ${APP_NAME} team see them.</p></div>
    ${seller ? sellerPaymentsCard() : ""}
    <form class="card seller-profile" onsubmit="return saveSellerProfileForm(event)" novalidate>
      <h2>Your business</h2>
      <div id="logo-row" class="logo-row">${logoRow(v.name)}</div>
      <div class="form-grid">
        <label>Business name<input name="name" required maxlength="50" value="${escapeHtml(v.name)}" placeholder="e.g. Lagos Wax Prints" oninput="refreshLogoInitials(this.value)"></label>
        ${field("Contact name", "contact", v.contact_name, 'required maxlength="80" autocomplete="name"')}
        <label>Phone${phoneFieldHtml("phone", v.phone, v.country_code, 'required placeholder="e.g. 803 555 0199"')}</label>
        ${field("Email", "email", v.email, 'type="email" required maxlength="120" autocomplete="email"')}
      </div>
      <h2>Where you are</h2>
      <div class="form-grid">
        <label>Country<select name="country" required onchange="suggestCurrency(this.form, this.value)">${countryOptions(v.country_code || "", "Choose your country")}</select></label>
        ${field("City or town", "city", v.city, 'required maxlength="60" placeholder="e.g. Lagos"')}
        ${field("Address", "address", v.address_line, 'required maxlength="120" placeholder="Shop or warehouse address" autocomplete="street-address"')}
        ${field("Postcode <small>(if you have one)</small>", "postcode", v.postcode, 'maxlength="20" autocomplete="postal-code"')}
        ${field("Area customers see", "location", v.location, 'required maxlength="60" placeholder="e.g. Idumota Market, Lagos"')}
        <label>Delivery time to a tailor<select name="delivery">${times.map(t => `<option ${t === v.delivery_estimate ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
      </div>
      <h2>What you sell</h2>
      <div class="form-grid">
        <label class="wide">Tell us about your fabrics<textarea name="sells" rows="3" maxlength="500" required placeholder="e.g. Dutch wax and Ankara prints, George and lace for aso ebi">${escapeHtml(v.sells || "")}</textarea></label>
        <label>Your prices are in<select name="currency">${currencyOptions(currency)}</select></label>
        <p class="hint">You set your prices in this currency, by the yard or the metre as fabric is sold in your country. Tailors in other countries see your prices converted at the day's exchange rate; you're always paid in your currency.${seller ? " Changing your currency converts your fabric prices at today's rate." : ""}</p>
      </div>
      <fieldset class="photo-field">
        <legend>Sample photos <small class="muted">(up to ${MAX_SAMPLE_PHOTOS} — your shop, stall or fabrics. Only the ${APP_NAME} team sees these)</small></legend>
        <div id="sample-slots" class="photo-slots">${sampleSlots()}</div>
      </fieldset>
      ${seller && seller.seller_terms_accepted_at ? `<p class="hint paid">✓ You agreed to the ${APP_NAME} seller terms.</p>` : `
      <details class="terms-box" open><summary>${APP_NAME} seller terms</summary><ol>${SELLER_TERMS.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ol></details>
      <label class="check terms-check"><input type="checkbox" name="acceptTerms" value="yes" required> I agree to the ${APP_NAME} seller terms.</label>`}
      <p id="profile-form-error" class="form-error" role="alert"></p>
      <div class="job-buttons">
        <button type="submit" class="gold">${seller ? "Save" : "Send my application"}</button>
        ${seller ? "" : `<a class="button ghost" href="#/welcome">Cancel</a>`}
      </div>
      ${approved ? "" : `<p class="hint">${seller ? "Changes are saved to your application." : `The ${APP_NAME} team reviews every new seller, usually within two working days.`}</p>`}
    </form>`;
}

function sellerPaymentsCard() {
  return `<div class="card"><h2>Payments & payouts</h2>
    <p><b>Not open yet.</b> NebedaHub is completing its protected payment and payout setup before fabric sellers can receive customer money.</p>
    <p class="hint">Do not ask customers or tailors to pay you directly. Payout setup will be enabled here when it is ready.</p></div>`;
}

function sampleSlots() {
  const photos = sellerForm.samples || [];
  const tiles = photos.map((p, i) => `
    <div class="photo-slot">
      <img src="${p.url}" alt="Sample photo ${i + 1}">
      <button type="button" class="slot-btn" onclick="removeSamplePhoto(${i})" aria-label="Remove sample photo ${i + 1}">×</button>
    </div>`).join("");
  const add = photos.length < MAX_SAMPLE_PHOTOS ? `
    <label class="photo-slot add">
      <input type="file" accept="image/*" multiple onchange="addSamplePhotos(this)">
      <span>＋</span><small>Add photo${photos.length ? "" : "s"}<br>${photos.length}/${MAX_SAMPLE_PHOTOS}</small>
    </label>` : "";
  return tiles + add;
}

function redrawSampleSlots() {
  const el = document.getElementById("sample-slots");
  if (el) el.innerHTML = sampleSlots();
}

function addSamplePhotos(input) {
  const form = sellerForm;
  const room = MAX_SAMPLE_PHOTOS - form.samples.length;
  const files = Array.from(input.files || []);
  input.value = "";
  if (files.length > room) toast(`Only ${room} more photo${room === 1 ? "" : "s"} added — up to ${MAX_SAMPLE_PHOTOS}.`);
  files.slice(0, room).reduce((chain, file) => chain.then(() =>
    resizeImage(file, PHOTO_MAX_SIZE, 0.8)
      .then(url => {
        if (sellerForm !== form || form.samples.length >= MAX_SAMPLE_PHOTOS) return;
        form.samples.push({ ref: null, url });
        redrawSampleSlots();
      })
      .catch(error => toast(error.message))
  ), Promise.resolve());
}

function removeSamplePhoto(index) {
  sellerForm.samples.splice(index, 1);
  redrawSampleSlots();
}

// The logo and its buttons redraw on their own so typed details aren't lost
function logoRow(name) {
  const fallback = photoUrl(`logo:${initialsOf(name || "?")}:1e2a44`);
  return `
    <img class="logo big" src="${sellerForm.logo ? sellerForm.logo.url : fallback}" alt="Shop logo">
    <div class="stack">
      <label class="button small file-button">${sellerForm.logo ? "Change logo" : "Upload logo"}<input type="file" accept="image/*" onchange="setFormLogo(this)"></label>
      ${sellerForm.logo ? `<button type="button" class="small ghost" onclick="removeFormLogo()">Remove logo</button>` : `<small class="muted">Optional — we'll use your initials until you add one.</small>`}
    </div>`;
}

function redrawLogoRow() {
  const row = document.getElementById("logo-row");
  const nameInput = document.querySelector(".seller-profile [name=name]");
  if (row) row.innerHTML = logoRow(nameInput ? nameInput.value : "");
}

function refreshLogoInitials() {
  if (sellerForm && !sellerForm.logo) redrawLogoRow();
}

function removeFormLogo() {
  sellerForm.logo = null;
  redrawLogoRow();
}

function setFormLogo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const form = sellerForm;
  resizeImage(file, LOGO_MAX_SIZE, 0.85)
    .then(url => {
      if (sellerForm !== form) return;
      form.logo = { ref: null, url };
      redrawLogoRow();
    })
    .catch(error => toast(error.message));
}

function saveSellerProfileForm(event) {
  event.preventDefault();
  if (sellerSaving) return false;
  const form = event.target;
  const seller = currentSeller();
  const values = {
    name: form.name.value.trim(),
    contact_name: form.contact.value.trim(),
    phone: readPhone(form, "phone"),
    email: form.email.value.trim(),
    country_code: form.country.value || null,
    city: form.city.value.trim(),
    address_line: form.address.value.trim(),
    postcode: form.postcode.value.trim(),
    location: form.location.value.trim(),
    delivery_estimate: form.delivery.value,
    sells: form.sells.value.trim(),
    currency_code: form.currency.value || countryCurrency(form.country.value) || "GBP",
    accept_terms: form.acceptTerms ? form.acceptTerms.checked : true
  };
  if (!values.name) return formError("profile-form-error", "Enter your business name.");
  if (db.suppliers.some(s => s.name.toLowerCase() === values.name.toLowerCase() && (!seller || s.id !== seller.id))) {
    return formError("profile-form-error", "Another seller already uses that name.");
  }
  if (hideContactDetails([values.name, values.location, values.city].join(" ")).hidden) {
    return formError("profile-form-error", "Your business name and area can't include a phone number, email, website or social handle.");
  }
  if (!values.contact_name) return formError("profile-form-error", "Enter the name of the person we should talk to.");
  if (!/^\+?[0-9 ()-]{7,24}$/.test(values.phone) || !phoneLooksRight(values.phone)) {
    return formError("profile-form-error", "Enter a phone number NebedaHub can call: choose the country code, then the number, e.g. 803 555 0199.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return formError("profile-form-error", "Enter your email address.");
  if (!values.country_code) return formError("profile-form-error", "Choose your country.");
  if (!values.city) return formError("profile-form-error", "Enter your city or town.");
  if (!values.address_line) return formError("profile-form-error", "Enter your shop or warehouse address.");
  if (!values.location) return formError("profile-form-error", "Enter the area customers will see, e.g. the market and city.");
  if (!values.sells) return formError("profile-form-error", "Tell us what fabrics you sell.");
  if (!seller && !(sellerForm.samples || []).length) return formError("profile-form-error", "Add at least one sample photo of your fabrics or shop.");
  if (!values.accept_terms) return formError("profile-form-error", "Please tick the box to agree to the seller terms.");
  if (seller && seller.currency_code && seller.currency_code !== values.currency_code) {
    const rate = fxRate(seller.currency_code, values.currency_code);
    if (rate == null) return formError("profile-form-error", `There's no exchange rate for ${values.currency_code} yet. Try again tomorrow.`);
    if (!confirm(`Change your currency from ${seller.currency_code} to ${values.currency_code}? Your fabric prices are converted at today's rate (${rateText(rate, seller.currency_code, values.currency_code)}). Orders already placed keep their currency.`)) return false;
  }
  const oldLogo = seller ? seller.logo : null;
  const logo = sellerForm.logo;
  const samples = sellerForm.samples || [];
  const oldSamples = seller ? (seller.sample_photos || []) : [];
  sellerSaving = true;
  const button = form.querySelector("button[type=submit]");
  if (button) { button.disabled = true; button.textContent = "Saving…"; }
  Promise.all([logo ? (logo.ref || PhotoStore.put(logo.url, "logo")) : null]
      .concat(samples.map(p => p.ref || PhotoStore.put(p.url, "seller-file"))))
    .then(([ref, ...sampleRefs]) => {
      values.logo = ref;
      values.sample_photos = sampleRefs;
      const saved = saveSellerProfile(seller ? seller.id : null, values);
      if (oldLogo && oldLogo !== ref) PhotoStore.remove(oldLogo);
      oldSamples.filter(x => !sampleRefs.includes(x)).forEach(x => PhotoStore.remove(x));
      db.session.sellerId = saved.id;
      saveData();
      sellerForm = null;
      if (seller) {
        toast("Saved.");
        renderAll();
      } else {
        toast(`Thanks, ${saved.name}! Your application is with the ${APP_NAME} team. Add your fabrics while you wait.`);
        go("fabrics");
      }
    })
    .catch(error => {
      console.warn(error);
      formError("profile-form-error", Cloud.live ? "Couldn't upload the photos: " + (error.message || "please try again.") : "Couldn't save the photos — this browser's storage may be full.");
      if (button) { button.disabled = false; button.textContent = seller ? "Save" : "Send my application"; }
    })
    .finally(() => { sellerSaving = false; });
  return false;
}
