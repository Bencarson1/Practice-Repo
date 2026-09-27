// ============================================================
// shop.js — Ready-to-wear storefront management
// ============================================================

let rtwEditorId = null;
let rtwEditorPhoto = null;

function rtwBusinessItems() {
  const designerId = bizDesignerId();
  return (db.ready_to_wear || []).filter(i => i.designer_id === designerId)
    .slice().sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function renderShop() {
  const items = rtwBusinessItems();
  const sales = (db.rtw_sales || []).filter(s => items.some(i => i.id === s.item_id)).slice().reverse();
  const takings = sumByCurrency(sales.filter(isConfirmed), s => s.price, rtwSaleCurrency);
  const currency = bizCurrency();
  const liveCount = items.filter(i => i.active !== false).length;
  const stockCount = items.reduce((n, i) => n + Number(i.stock || 0), 0);

  const cards = items.map(item => {
    const sold = sales.filter(s => s.item_id === item.id && isConfirmed(s)).length;
    const image = item.photo ? photoUrl(item.photo) : "";
    return `<article class="rtw-admin-card">
      <div class="rtw-admin-photo">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}">` : `<div class="rtw-photo-empty">Add product photo</div>`}
        ${item.featured ? '<span class="rtw-featured-badge">Featured</span>' : ""}
        ${item.active === false ? '<span class="rtw-hidden-badge">Hidden</span>' : ""}
      </div>
      <div class="rtw-admin-body">
        <div class="row-between"><b>${escapeHtml(item.name)}</b><span class="price">${money(item.price, rtwCurrency(item))}</span></div>
        <div class="muted small-text">${escapeHtml(item.category || "Other")}${item.sku ? " · SKU " + escapeHtml(item.sku) : ""}</div>
        <div class="small-text">${escapeHtml((item.sizes || []).join(", ") || "One size / size not set")}</div>
        <div class="row-between rtw-stock-row"><span>Stock <b class="${item.stock <= 2 ? "owed" : ""}">${item.stock}</b></span><span>${sold} sold</span></div>
        <div class="job-buttons">
          <button class="small" onclick="changeRtwStock('${item.id}', -1)" ${item.stock <= 0 ? "disabled" : ""}>− Stock</button>
          <button class="small" onclick="changeRtwStock('${item.id}', 1)">+ Stock</button>
          <button class="small ghost" onclick="openRtwEditor('${item.id}')">Edit</button>
          <button class="small ${item.active === false ? "gold" : "ghost"}" onclick="toggleRtwActive('${item.id}')">${item.active === false ? "Publish" : "Hide"}</button>
        </div>
      </div>
    </article>`;
  }).join("");

  const saleRows = sales.map(s => {
    const item = db.ready_to_wear.find(i => i.id === s.item_id);
    return `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(item ? item.name : "Removed item")}</td><td>${escapeHtml(s.customer_id ? customerName(s.customer_id) : "Guest")}</td><td>${money(s.price, rtwSaleCurrency(s))}</td>
      <td>${s.status === "awaiting_confirmation" ? `<span class="badge">Awaiting protected payment</span>` : escapeHtml(PAYMENT_STATUS_LABELS[s.status] || "Confirmed")}</td></tr>`;
  }).join("");

  return `
    ${bizHeader("Ready to Wear Shop", "Build a real product shop with photos, descriptions, sizes, stock and published products. Customers can browse these pieces without requesting a tailoring quote.")}
    <div class="statgrid rtw-shop-stats">
      <div class="stat"><div class="l">Published products</div><div class="n">${liveCount}</div></div>
      <div class="stat"><div class="l">Units in stock</div><div class="n">${stockCount}</div></div>
      <div class="stat"><div class="l">Confirmed sales</div><div class="n">${sales.filter(isConfirmed).length}</div></div>
      <div class="stat"><div class="l">Takings</div><div class="n">${totalsHtml(takings, currency)}</div></div>
    </div>

    ${renderRtwEditor(currency)}

    <div class="card">
      <div class="row-between wrap">
        <div><h2>Your products</h2><p class="hint">Only published products appear in the customer shop.</p></div>
        <button class="gold" onclick="openRtwEditor()">+ Add product</button>
      </div>
      <div class="rtw-admin-grid">${cards || '<div class="empty">No ready-to-wear products yet. Add your first product with a clear fashion photo.</div>'}</div>
    </div>

    <div class="card">
      <div class="row-between wrap"><div><h2>Sales</h2><p class="hint">Ready-to-wear payment will use NebedaHub protected checkout when payments are switched on.</p></div>
        <a class="button ghost small" href="${escapeHtml(appUrl("customer", "rtw/" + bizDesignerId()))}" target="_blank" rel="noopener">Preview customer shop</a></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Product</th><th>Customer</th><th>Price</th><th>Payment</th></tr></thead>
        <tbody>${saleRows || "<tr><td colspan='5' class='empty'>No sales yet.</td></tr>"}</tbody>
      </table></div>
    </div>`;
}

function renderRtwEditor(currency) {
  if (rtwEditorId === null && !rtwEditorPhoto) return "";
  const item = rtwEditorId ? db.ready_to_wear.find(i => i.id === rtwEditorId) : null;
  const currentPhoto = rtwEditorPhoto || (item && item.photo ? { ref: item.photo, url: photoUrl(item.photo) } : null);
  const categories = ["Agbada", "Kaftan", "Senator", "Dress", "Bubu", "Two Piece", "Suit", "Wedding", "Aso Ebi", "Accessories", "Other"];
  return `<form class="card rtw-product-form" onsubmit="return saveRtwProduct(event)">
    <div class="row-between wrap"><div><h2>${item ? "Edit product" : "Add ready-to-wear product"}</h2><p class="hint">Use a clear product photo. Customers should be able to see exactly what they are buying.</p></div>
      <button type="button" class="small ghost" onclick="closeRtwEditor()">Close</button></div>
    <div class="rtw-product-editor">
      <div class="rtw-editor-photo">
        ${currentPhoto && currentPhoto.url ? `<img src="${escapeHtml(currentPhoto.url)}" alt="Product preview">` : '<div class="rtw-photo-empty">No photo yet</div>'}
        <label class="button small file-button">${currentPhoto ? "Change photo" : "Upload product photo"}<input type="file" accept="image/*" onchange="setRtwProductPhoto(this)"></label>
      </div>
      <div class="stack">
        <div class="form-grid">
          <label>Product name<input name="name" required maxlength="100" value="${escapeHtml(item && item.name || "")}" placeholder="e.g. Navy embroidered kaftan"></label>
          <label>Category<select name="category">${categories.map(x => `<option ${item && item.category === x ? "selected" : ""}>${escapeHtml(x)}</option>`).join("")}</select></label>
          <label>Price (${escapeHtml(currency)})<input name="price" type="number" min="0.01" step="0.01" required value="${item ? item.price : ""}"></label>
          <label>Internal cost (${escapeHtml(currency)})<input name="cost" type="number" min="0" step="0.01" required value="${item ? item.cost : 0}"></label>
          <label>Stock<input name="stock" type="number" min="0" step="1" required value="${item ? item.stock : 1}"></label>
          <label>SKU <small>(optional)</small><input name="sku" maxlength="40" value="${escapeHtml(item && item.sku || "")}" placeholder="e.g. NB-KAF-001"></label>
        </div>
        <label>Description<textarea name="description" rows="4" maxlength="1000" required placeholder="Material, fit, details and what is included.">${escapeHtml(item && item.description || "")}</textarea></label>
        <label>Available sizes <small>(comma separated, e.g. S, M, L, XL)</small><input name="sizes" maxlength="160" value="${escapeHtml((item && item.sizes || []).join(", "))}" placeholder="S, M, L, XL"></label>
        <label class="check"><input type="checkbox" name="featured" ${item && item.featured ? "checked" : ""}> Feature this product at the top of the shop</label>
        <label class="check"><input type="checkbox" name="active" ${!item || item.active !== false ? "checked" : ""}> Publish product to customers</label>
        <p id="rtw-product-error" class="form-error"></p>
        <button class="gold" type="submit">${item ? "Save product" : "Add product"}</button>
      </div>
    </div>
  </form>`;
}

function openRtwEditor(itemId) {
  rtwEditorId = itemId || "";
  const item = itemId ? db.ready_to_wear.find(i => i.id === itemId) : null;
  rtwEditorPhoto = item && item.photo ? { ref: item.photo, url: photoUrl(item.photo) } : null;
  renderAll();
}

function closeRtwEditor() {
  rtwEditorId = null;
  rtwEditorPhoto = null;
  renderAll();
}

function setRtwProductPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  resizeImage(file, PHOTO_MAX_SIZE, 0.84)
    .then(url => { rtwEditorPhoto = { ref: null, url }; renderAll(); })
    .catch(error => toast(error.message));
}

function saveRtwProduct(event) {
  event.preventDefault();
  const form = event.target;
  const existing = rtwEditorId ? db.ready_to_wear.find(i => i.id === rtwEditorId) : null;
  if (!rtwEditorPhoto || (!rtwEditorPhoto.ref && !rtwEditorPhoto.url)) {
    formError("rtw-product-error", "Add a clear product photo.");
    return false;
  }
  const values = {
    name: form.name.value.trim(),
    category: form.category.value,
    price: Number(form.price.value),
    cost: Number(form.cost.value),
    stock: Math.max(0, Number(form.stock.value) || 0),
    sku: form.sku.value.trim(),
    description: form.description.value.trim(),
    sizes: form.sizes.value.split(",").map(x => x.trim()).filter(Boolean).slice(0, 20),
    featured: form.featured.checked,
    active: form.active.checked
  };
  if (!values.name || !values.description) return formError("rtw-product-error", "Add the product name and description.");

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Saving…";
  Promise.resolve(rtwEditorPhoto.ref || PhotoStore.put(rtwEditorPhoto.url, "designer"))
    .then(ref => {
      if (existing) {
        const oldPhoto = existing.photo;
        Object.assign(existing, values, { photo: ref, currency_code: bizCurrency() });
        if (oldPhoto && oldPhoto !== ref) PhotoStore.remove(oldPhoto);
      } else {
        db.ready_to_wear.push(Object.assign({
          id: newId("R", db.ready_to_wear), designer_id: bizDesignerId(), currency_code: bizCurrency(), color: "#9B3A4A", photo: ref
        }, values));
      }
      saveData();
      rtwEditorId = null;
      rtwEditorPhoto = null;
      toast(existing ? "Product updated." : "Product added to your ready-to-wear shop.");
      renderAll();
    })
    .catch(error => {
      button.disabled = false;
      button.textContent = existing ? "Save product" : "Add product";
      formError("rtw-product-error", error.message || "Couldn't save the product.");
    });
  return false;
}

function toggleRtwActive(itemId) {
  const item = db.ready_to_wear.find(i => i.id === itemId);
  if (!item) return;
  item.active = item.active === false;
  saveData();
  toast(item.active ? "Product published." : "Product hidden from customers.");
  renderAll();
}

function changeRtwStock(itemId, delta) {
  const item = db.ready_to_wear.find(i => i.id === itemId);
  if (!item) return;
  item.stock = Math.max(0, Number(item.stock || 0) + delta);
  saveData();
  renderAll();
}
