// ============================================================
// fabrics.js — screen 15: fabric inventory and the supplier marketplace
// Live stock per fabric, low-stock warnings, restocking
// ============================================================

// Which fabric category is currently selected in the filter ("All" shows everything)
let fabricFilter = "All";

function renderFabrics() {
  const categories = ["All"];
  activeFabrics().forEach(f => { if (!categories.includes(f.category)) categories.push(f.category); });
  const visible = activeFabrics().filter(f => fabricFilter === "All" || f.category === fabricFilter);
  const low = activeFabrics().filter(f => f.status === "approved" && f.metres_available < LOW_STOCK_METRES);

  const cards = visible.map(fabric => {
    const supplier = findSupplier(fabric.supplier_id);
    const isLow = fabric.metres_available < LOW_STOCK_METRES;
    return `
      <div class="fabric-card">
        <img class="swatch photo" src="${fabricCoverUrl(fabric)}" alt="" loading="lazy">
        <div class="fabric-info">
          <h3>${escapeHtml(fabric.name)} ${fabric.status !== "approved" || isSoldOut(fabric) ? sellerStatusBadge(fabric) : ""}</h3>
          <p>${escapeHtml(fabric.category)} · ${escapeHtml(supplier ? supplier.name + ", " + supplier.location : "—")}</p>
          <p><strong class="gold">${money(fabric.price_per_metre)}</strong> per metre · min ${fabric.min_order_metres} m · ${escapeHtml(supplier ? supplier.delivery_estimate : "")}</p>
          <p class="${isLow ? "owed" : ""}"><b>${fabric.metres_available} m</b> in stock${isLow ? " — low stock!" : ""}</p>
          <div class="job-buttons">
            <button class="small" onclick="restockFabric('${fabric.id}', 10)">Restock +10 m</button>
            <button class="small" onclick="chooseFabric('${fabric.id}')" ${isSoldOut(fabric) ? "disabled" : ""}>Use in an order</button>
          </div>
        </div>
      </div>`;
  }).join("");

  const supplierRows = db.suppliers.map(s => `<tr>
    <td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.location)}</td><td>${escapeHtml(s.delivery_estimate)}</td><td>⭐ ${s.rating}</td>
    <td>${sellerFabrics(s.id).map(f => escapeHtml(f.name)).join(", ") || "—"}</td></tr>`).join("");

  return `
    ${bizHeader("Fabric Inventory — Live", "Stock goes down automatically when a customer buys fabric for an order. Fabrics from independent sellers are checked in the Fabric Sellers tab.")}
    ${low.length ? `<div class="alerts"><span class="alert">⚠ Low stock (under ${LOW_STOCK_METRES} m): ${low.map(f => `${escapeHtml(f.name)} (${f.metres_available} m)`).join(", ")}</span></div>` : ""}
    <div class="chips">${categories.map(c => `<button class="chip ${c === fabricFilter ? "active" : ""}" onclick="setFabricFilter('${escapeHtml(c)}')">${escapeHtml(c)}</button>`).join("")}</div>
    <div class="fabric-grid">${cards}</div>

    <div class="two-col">
      <div class="card">
        <h2>Add a fabric</h2>
        <form class="form-grid" onsubmit="return addFabric(event)">
          <label>Name<input name="name" required></label>
          <label>Category<input name="category" list="fabric-categories" required>
            <datalist id="fabric-categories">${categories.slice(1).map(c => `<option value="${escapeHtml(c)}"></option>`).join("")}</datalist></label>
          <label>Supplier<select name="supplier">${db.suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
          <label>Price per metre (${CURRENCY})<input name="price" type="number" min="0.5" step="0.5" required></label>
          <label>Metres in stock<input name="stock" type="number" min="0" step="0.5" required></label>
          <label>Minimum order (m)<input name="min" type="number" min="0.5" step="0.5" value="2" required></label>
          <label>Colour<input name="color" type="color" value="#1e2a44"></label>
          <div class="form-actions"><button type="submit">Add fabric</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Suppliers <a class="total" href="#/biz/sellers">Seller approvals →</a></h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Supplier</th><th>Location</th><th>Delivery</th><th>Rating</th><th>Fabrics</th></tr></thead>
          <tbody>${supplierRows}</tbody>
        </table></div>
      </div>
    </div>
  `;
}

function setFabricFilter(category) {
  fabricFilter = category;
  renderAll();
}

function restockFabric(fabricId, metres) {
  const fabric = findFabric(fabricId);
  fabric.metres_available = Math.round((fabric.metres_available + metres) * 10) / 10;
  fabric.updated_at = today();
  saveData();
  toast(`${fabric.name}: ${fabric.metres_available} m in stock.`);
  renderAll();
}

function addFabric(event) {
  event.preventDefault();
  const form = event.target;
  db.fabrics.push({
    id: nextFabricId(), name: form.name.value.trim(), category: form.category.value.trim(), color: form.color.value,
    price_per_metre: Number(form.price.value), supplier_id: form.supplier.value,
    metres_available: Number(form.stock.value), min_order_metres: Number(form.min.value),
    // Added by the shop itself, so it's live straight away
    colour_name: nearestColourName(form.color.value), description: "", photos: [],
    status: "approved", sold_out: false, deleted_at: null, created_at: today(), review_note: ""
  });
  saveData();
  renderAll();
  return false;
}

// Jump to the Orders tab with this fabric already picked
function chooseFabric(fabricId) {
  pendingFabricId = fabricId;
  go("biz/orders");
  setTimeout(() => {
    const input = document.querySelector("#order-form [name=customer]");
    if (input) input.focus();
  }, 0);
}
