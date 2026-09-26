// ============================================================
// seller.js — the Fabric Seller area
// Sellers create a shop profile, put fabrics on their "market stall"
// (up to 5 photos each), edit them, mark them sold out or delete them,
// and see the orders that used their fabric.
//
// Addresses (NebedaHub Seller, /sell/): #/welcome (sign in or join), #/fabrics, #/new,
// #/edit/F12, #/orders, #/profile
// ============================================================

const SELLER_TABS = [
  { key: "fabrics", label: "My fabrics" },
  { key: "new", label: "Add a fabric" },
  { key: "orders", label: "Orders" },
  { key: "profile", label: "Shop profile" }
];

let stallFilter = "All";
let sellerForm = null;   // photos (or logo) being edited, kept while the form is open
let sellerSaving = false;

function renderSellerArea(screen, id) {
  const seller = currentSeller();
  const tabs = document.getElementById("seller-tabs");
  const content = document.getElementById("seller-content");
  let html, title;

  if (!seller) {
    tabs.innerHTML = `<a class="tab ${screen !== "profile" ? "active" : ""}" href="#/welcome">Sell on ${APP_NAME}</a>
      ${Cloud.isGuest() ? "" : `<a class="tab ${screen === "profile" ? "active" : ""}" href="#/profile">Create your shop</a>`}`;
    html = screen === "profile" ? sellerProfileScreen(null) : sellerWelcome();
    title = "Sell fabric";
  } else {
    const activeTab = screen === "edit" ? "new" : screen;
    tabs.innerHTML = SELLER_TABS.map(t =>
      `<a class="tab ${t.key === activeTab ? "active" : ""}" href="#/${t.key}">${t.key === "new" && screen === "edit" ? "Edit fabric" : t.label}</a>`).join("");
    const screens = {
      fabrics: () => sellerStall(seller),
      new: () => sellerFabricForm(seller, null),
      edit: () => sellerFabricForm(seller, id),
      orders: () => sellerOrdersScreen(seller),
      profile: () => sellerProfileScreen(seller)
    };
    html = sellerShopStrip(seller) + (screens[screen] || screens.fabrics)();
    title = seller.name;
  }
  content.innerHTML = html;
  document.title = `${title} · ${APP.name}`;
}

function sellerStatusBadge(fabric) {
  if (isSoldOut(fabric) && fabric.status === "approved") return `<span class="badge status-soldout">Sold out</span>`;
  return `<span class="badge status-${fabric.status}">${FABRIC_STATUS_LABELS[fabric.status]}</span>`;
}

// ---- Not signed in: explain, join or sign in ----

function sellerWelcome() {
  const shops = db.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `
    ${bizHeader(`Sell your fabric on ${APP_NAME}`, `Put your fabrics in front of customers and tailors on ${APP_NAME}, like a stall at the market.`)}
    ${Cloud.live && Cloud.me ? `<div class="notice no-shop">This account (${escapeHtml(Cloud.me.email)}) isn't a fabric seller yet. <b>Create your shop</b> below to start selling — or <a href="${escapeHtml(appUrl("customer", ""))}">open the customer app</a>.</div>` : ""}
    <ol class="how-steps">
      <li><b>Create your shop</b><span>Shop name, where you are, your phone number, delivery time and logo.</span></li>
      <li><b>Add your fabrics</b><span>Up to 5 photos each, with the type, colour, price per yard and how many yards you have.</span></li>
      <li><b>Get approved and sell</b><span>The ${APP_NAME} team checks each fabric, then customers can choose it for their outfit. Orders appear in your Orders tab.</span></li>
    </ol>
    <div class="two-col">
      <div class="card">
        <h2>New seller</h2>
        <p class="hint">It takes about two minutes.</p>
        ${Cloud.isGuest() ? `<button class="gold" onclick="Auth.startSignUp()">Create your seller account</button>` : `<a class="button" href="#/profile">Create your seller profile</a>`}
      </div>
      <div class="card">
        <h2>Already selling?</h2>
        ${Cloud.isGuest() ? `<p class="hint">Sign in to ${APP.name} to see your fabrics and orders.</p><button class="ghost" onclick="Auth.show('signIn')">Sign in</button>`
          : Cloud.live ? `<p class="hint">Your shop opens here once you've created it. Signed in with a different email? <button class="linkish strong" onclick="Auth.signOut()">Sign out</button> and sign in with the one your shop uses.</p>` : `
        <p class="hint">Choose your shop to sign in. (Demo: there are no passwords yet.)</p>
        <div class="shop-list">${shops.map(s => `
          <button class="shop-pick" onclick="sellerSignIn('${s.id}')">
            <img class="logo" src="${sellerLogoUrl(s)}" alt="">
            <span><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.location)} · ${sellerFabrics(s.id).length} fabric${sellerFabrics(s.id).length === 1 ? "" : "s"}</small></span>
          </button>`).join("")}</div>`}
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
          <p><strong class="gold">${money(f.price_per_yard)}</strong> per yard</p>
          <p class="${soldOut ? "owed" : f.yards_available < LOW_STOCK_YARDS ? "owed" : ""}">${f.yards_available} yd in stock${f.sold_out ? " · marked sold out" : ""}</p>
          ${f.status === "hidden" ? `<p class="review-note">Hidden by ${escapeHtml(SHOP_NAME)}${f.review_note ? `: “${escapeHtml(f.review_note)}”` : ""}. Edit it and it goes back for checking.</p>` : ""}
          ${f.status === "pending" ? `<p class="muted small-text">${escapeHtml(SHOP_NAME)} will check it soon.</p>` : ""}
          <div class="job-buttons">
            <a class="button small" href="#/edit/${f.id}">Edit</a>
            ${f.sold_out
              ? `<button class="small ghost" onclick="stallBackInStock('${f.id}')">Back in stock</button>`
              : `<button class="small ghost" onclick="stallSoldOut('${f.id}')">Mark sold out</button>`}
            <button class="small danger" onclick="stallDelete('${f.id}')">Delete</button>
          </div>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="biz-head row-between wrap">
      <div><h1>My fabrics</h1><p class="muted">Your market stall. Customers see fabrics once ${escapeHtml(SHOP_NAME)} approves them.</p></div>
      <a class="button gold" href="#/new">+ Add a fabric</a>
    </div>
    ${newOrders ? `<div class="alerts"><a class="alert" href="#/orders">📦 ${newOrders} new order${newOrders > 1 ? "s" : ""} to send</a></div>` : ""}
    <div class="chips">${["All", "Live", "Waiting", "Hidden", "Sold out"].map(k =>
      `<button class="chip ${k === stallFilter ? "active" : ""}" onclick="stallFilter='${k}';renderAll()">${k}${k === "All" ? ` (${fabrics.length})` : ` (${counts[k]})`}</button>`).join("")}</div>
    ${shown.length ? `<div class="stall-grid">${cards}</div>`
      : `<div class="card empty-card"><p class="empty">${fabrics.length ? "Nothing here." : "Your stall is empty."}</p>
        ${fabrics.length ? "" : `<a class="button gold" href="#/new">Add your first fabric</a>`}</div>`}`;
}

function stallSoldOut(fabricId) {
  const fabric = setFabricSoldOut(fabricId, true);
  saveData();
  toast(`${fabric.name} is marked sold out. Customers can't buy it until you put it back in stock.`);
  renderAll();
}

function stallBackInStock(fabricId) {
  const fabric = findFabric(fabricId);
  if (fabric.yards_available < fabric.min_order_yards) {
    toast("Add how many yards you have first.");
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
  return `
    <div class="biz-head"><h1>${fabric ? "Edit " + escapeHtml(fabric.name) : "Add a fabric"}</h1>
      <p class="muted">${fabric ? `${sellerStatusBadge(fabric)} ` : ""}${fabric && fabric.status === "approved"
        ? `Price and stock changes go live straight away. New photos, name, type, colour or description go to ${escapeHtml(SHOP_NAME)} for a quick check first.`
        : `${escapeHtml(SHOP_NAME)} checks every new fabric before customers see it.`}</p></div>
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
        <label>Price per yard (${CURRENCY})<input name="price" type="number" inputmode="decimal" min="0.5" max="1000" step="0.01" required value="${v.price_per_yard}" placeholder="e.g. 12.50"></label>
        <label>Yards in stock<input name="stock" type="number" inputmode="decimal" min="0" max="10000" step="0.1" required value="${v.yards_available}" placeholder="e.g. 40"></label>
        <label>Smallest order (yards)<input name="min" type="number" inputmode="decimal" min="0.5" max="50" step="0.5" required value="${v.min_order_yards}"></label>
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
  const values = {
    name: form.name.value.trim(),
    category: form.category.value,
    colour_name: form.colour.value,
    price_per_yard: Math.round(Number(form.price.value) * 100) / 100,
    yards_available: Math.round(Number(form.stock.value) * 10) / 10,
    min_order_yards: Number(form.min.value),
    description: form.description.value.trim()
  };
  if (!sellerForm.photos.length) return formError("fabric-form-error", "Add at least one photo of the fabric.");
  if (!values.name) return formError("fabric-form-error", "Give the fabric a name.");
  if (!form.price.value || !(values.price_per_yard >= 0.5)) return formError("fabric-form-error", `Enter a price per yard of at least ${money(0.5)}.`);
  if (form.stock.value === "" || !(values.yards_available >= 0)) return formError("fabric-form-error", "Enter how many yards you have (0 or more).");
  if (!(values.min_order_yards >= 0.5)) return formError("fabric-form-error", "The smallest order must be at least 0.5 yd.");

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
      toast(result.isNew ? `${values.name} sent to ${SHOP_NAME} for approval.`
        : result.needsReview ? `Saved. ${SHOP_NAME} will check your changes before customers see them.` : `${values.name} saved.`);
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

// ---- Orders for this seller's fabric ----

function sellerOrdersScreen(seller) {
  const rows = sellerOrders(seller.id);
  const live = rows.filter(o => o.status !== "cancelled");
  const toSend = rows.filter(o => o.status === "new");
  const earned = live.reduce((total, o) => total + o.total, 0);
  const yards = live.reduce((total, o) => total + o.yards, 0);
  const cards = rows.map(o => {
    const fabric = findFabric(o.fabric_id);
    const first = o.customer_first_name || customerName(o.customer_id).split(" ")[0];
    const statusLabel = { new: "To send", sent: `Sent ${formatDate(o.sent_at)}`, cancelled: "Cancelled" }[o.status];
    return `
      <div class="sorder ${o.status}">
        <img src="${fabric ? fabricCoverUrl(fabric) : ""}" alt="">
        <div class="sorder-main">
          <div class="row-between"><b>${escapeHtml(o.fabric_name)}</b><span class="badge sstatus-${o.status}">${statusLabel}</span></div>
          <div class="muted small-text">${escapeHtml(o.ref || o.id)} · ordered ${formatDate(o.created_at)} · for ${escapeHtml(first)}'s outfit</div>
          <div>${o.yards} yd × ${money(o.price_per_yard)} = <b>${money(o.total)}</b></div>
          <div class="muted small-text">Send to: ${escapeHtml(o.deliver_to)}</div>
          ${o.status === "new" ? `<div class="job-buttons"><button class="small gold" onclick="sellerMarkSent('${o.id}')">Mark as sent</button></div>` : ""}
        </div>
      </div>`;
  }).join("");
  return `
    <div class="biz-head"><h1>Orders</h1><p class="muted">When a customer pays their deposit, the fabric they chose is ordered from you. Send it to ${escapeHtml(SHOP_NAME)} to be made up.</p></div>
    <div class="statgrid">
      <div class="stat"><div class="l">To send</div><div class="n">${toSend.length}</div></div>
      <div class="stat"><div class="l">Orders</div><div class="n">${live.length}</div></div>
      <div class="stat"><div class="l">Yards sold</div><div class="n">${Math.round(yards * 10) / 10} yd</div></div>
      <div class="stat"><div class="l">Sales</div><div class="n">${money(earned)}</div></div>
    </div>
    ${rows.length ? `<div class="sorders">${cards}</div>` : `<div class="card"><p class="empty">No orders yet. They'll appear here when a customer chooses your fabric.</p></div>`}`;
}

function sellerMarkSent(fabricOrderId) {
  const row = markFabricOrderSent(fabricOrderId);
  if (!row) return;
  saveData();
  toast(`${row.ref || row.id} marked as sent to ${SHOP_NAME}.`);
  renderAll();
}

// ---- Shop profile (create or edit) ----

function sellerProfileScreen(seller) {
  const key = "profile:" + (seller ? seller.id : "new");
  if (!sellerForm || sellerForm.key !== key) {
    sellerForm = { key, logo: seller && seller.logo ? { ref: seller.logo, url: photoUrl(seller.logo) } : null };
  }
  const v = seller || { name: "", location: "", phone: "", delivery_estimate: "1–3 days" };
  const times = DELIVERY_TIMES.includes(v.delivery_estimate) ? DELIVERY_TIMES : DELIVERY_TIMES.concat(v.delivery_estimate);
  return `
    <div class="biz-head"><h1>${seller ? "Shop profile" : "Create your seller profile"}</h1>
      <p class="muted">Customers see this next to your fabrics.</p></div>
    <form class="card seller-profile" onsubmit="return saveSellerProfileForm(event)" novalidate>
      <div id="logo-row" class="logo-row">${logoRow(v.name)}</div>
      <div class="form-grid">
        <label>Shop name<input name="name" required maxlength="50" value="${escapeHtml(v.name)}" placeholder="e.g. Mama Titi Wax Prints" oninput="refreshLogoInitials(this.value)"></label>
        <label>Location<input name="location" required maxlength="60" value="${escapeHtml(v.location)}" placeholder="e.g. Peckham, London"></label>
        <label>Phone<input name="phone" type="tel" required maxlength="20" autocomplete="tel" value="${escapeHtml(v.phone)}" placeholder="e.g. 07700 900123"></label>
        <label>Delivery time to ${escapeHtml(SHOP_NAME)}<select name="delivery">${times.map(t => `<option ${t === v.delivery_estimate ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
      </div>
      <p id="profile-form-error" class="form-error" role="alert"></p>
      <div class="job-buttons">
        <button type="submit" class="gold">${seller ? "Save profile" : "Create my shop"}</button>
        ${seller ? "" : `<a class="button ghost" href="#/welcome">Cancel</a>`}
      </div>
    </form>`;
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
    location: form.location.value.trim(),
    phone: form.phone.value.trim(),
    delivery_estimate: form.delivery.value
  };
  if (!values.name) return formError("profile-form-error", "Enter your shop name.");
  if (db.suppliers.some(s => s.name.toLowerCase() === values.name.toLowerCase() && (!seller || s.id !== seller.id))) {
    return formError("profile-form-error", "Another seller already uses that shop name.");
  }
  if (!values.location) return formError("profile-form-error", "Enter where your shop is.");
  if (!/^\+?[0-9 ()-]{7,20}$/.test(values.phone) || values.phone.replace(/\D/g, "").length < 7) {
    return formError("profile-form-error", "Enter a phone number customers and Nebeda Threads can call, e.g. 07700 900123.");
  }
  const oldLogo = seller ? seller.logo : null;
  const logo = sellerForm.logo;
  sellerSaving = true;
  Promise.resolve(logo ? (logo.ref || PhotoStore.put(logo.url, "logo")) : null)
    .then(ref => {
      values.logo = ref;
      const saved = saveSellerProfile(seller ? seller.id : null, values);
      if (oldLogo && oldLogo !== ref) PhotoStore.remove(oldLogo);
      db.session.sellerId = saved.id;
      saveData();
      sellerForm = null;
      if (seller) {
        toast("Shop profile saved.");
        renderAll();
      } else {
        toast(`Welcome to ${APP_NAME}, ${saved.name}! Now add your first fabric.`);
        go("new");
      }
    })
    .catch(error => {
      console.warn(error);
      formError("profile-form-error", Cloud.live ? "Couldn't upload the logo: " + (error.message || "please try again.") : "Couldn't save the logo — this browser's storage may be full.");
    })
    .finally(() => { sellerSaving = false; });
  return false;
}
