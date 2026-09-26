// ============================================================
// fabrics.js — NebedaHub Admin → Fabric inventory: every fabric in the
// marketplace, live stock, low-stock warnings, restocking, suppliers
// ============================================================

// Which fabric category is currently selected in the filter ("All" shows everything)
let fabricFilter = "All";

function renderFabrics() {
  const categories = ["All"];
  activeFabrics().forEach(f => { if (!categories.includes(f.category)) categories.push(f.category); });
  const visible = activeFabrics().filter(f => fabricFilter === "All" || f.category === fabricFilter);
  const low = activeFabrics().filter(f => f.status === "approved" && f.yards_available < LOW_STOCK_YARDS);
  const unit = screenFabricUnit();

  const cards = visible.map(fabric => {
    const supplier = findSupplier(fabric.supplier_id);
    const isLow = fabric.yards_available < LOW_STOCK_YARDS;
    return `
      <div class="fabric-card">
        <img class="swatch photo" src="${fabricCoverUrl(fabric)}" alt="" loading="lazy">
        <div class="fabric-info">
          <h3>${escapeHtml(fabric.name)} ${fabric.status !== "approved" || isSoldOut(fabric) ? sellerStatusBadge(fabric) : ""}</h3>
          <p>${escapeHtml(fabric.category)} · ${escapeHtml(supplier ? supplier.name + ", " + supplier.location : "—")}</p>
          <p><strong class="gold">${escapeHtml(fabricPriceText(fabric, unit))}</strong>${approxMoney(pricePerUnit(fabric.price_per_yard, unit), fabricCurrency(fabric))} · min ${lengthText(fabric.min_order_yards, unit)} · ${escapeHtml(supplier ? supplier.delivery_estimate : "")}</p>
          <p class="${isLow ? "owed" : ""}"><b>${lengthText(fabric.yards_available, unit)}</b> in stock${isLow ? " — low stock!" : ""}</p>
          <div class="job-buttons">
            <button class="small" onclick="restockFabric('${fabric.id}', ${unit === "m" ? yardsFrom(10, "m") : 10})">Restock +10 ${unit}</button>
          </div>
        </div>
      </div>`;
  }).join("");

  const supplierRows = db.suppliers.map(s => `<tr>
    <td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.location)}</td><td>${escapeHtml(sellerCurrency(s))}</td><td>${escapeHtml(s.delivery_estimate)}</td><td>⭐ ${s.rating}</td>
    <td>${sellerFabrics(s.id).map(f => escapeHtml(f.name)).join(", ") || "—"}</td></tr>`).join("");

  return `
    ${bizHeader("Fabric Inventory — Live", "Stock goes down automatically when a customer buys fabric for an order. Fabrics from independent sellers are checked in the Fabric sellers tab.")}
    ${low.length ? `<div class="alerts"><span class="alert">⚠ Low stock (under ${lengthText(LOW_STOCK_YARDS, unit)}): ${low.map(f => `${escapeHtml(f.name)} (${lengthText(f.yards_available, unit)})`).join(", ")}</span></div>` : ""}
    <div class="chips">${categories.map(c => `<button class="chip ${c === fabricFilter ? "active" : ""}" onclick="setFabricFilter('${escapeHtml(c)}')">${escapeHtml(c)}</button>`).join("")}</div>
    <div class="fabric-grid">${cards}</div>

    <div class="two-col">
      <div class="card">
        <h2>Add a fabric</h2>
        <form class="form-grid" onsubmit="return addFabric(event)">
          <label>Name<input name="name" required></label>
          <label>Category<input name="category" list="fabric-categories" required>
            <datalist id="fabric-categories">${categories.slice(1).map(c => `<option value="${escapeHtml(c)}"></option>`).join("")}</datalist></label>
          <label>Supplier<select name="supplier">${db.suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(sellerCurrency(s))})</option>`).join("")}</select></label>
          <label>Price per ${unitWord(unit)} <small class="muted">(in the supplier's currency)</small><input name="price" type="number" min="0.01" step="0.01" required></label>
          <label>${capitalize(unitWord(unit, true))} in stock<input name="stock" type="number" min="0" step="0.1" required></label>
          <label>Minimum order (${unit})<input name="min" type="number" min="0.5" step="0.5" value="2" required></label>
          <label>Colour<input name="color" type="color" value="#1e2a44"></label>
          <div class="form-actions"><button type="submit">Add fabric</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Suppliers <a class="total" href="#/sellers">Seller approvals →</a></h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Supplier</th><th>Location</th><th>Currency</th><th>Delivery</th><th>Rating</th><th>Fabrics</th></tr></thead>
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

function restockFabric(fabricId, yards) {
  const fabric = findFabric(fabricId);
  fabric.yards_available = Math.round((fabric.yards_available + yards) * 100) / 100;
  fabric.updated_at = today();
  saveData();
  toast(`${fabric.name}: ${lengthText(fabric.yards_available, screenFabricUnit())} in stock.`);
  renderAll();
}

function addFabric(event) {
  event.preventDefault();
  const form = event.target;
  const unit = screenFabricUnit();
  const supplier = findSupplier(form.supplier.value);
  db.fabrics.push({
    id: nextFabricId(), name: form.name.value.trim(), category: form.category.value.trim(), color: form.color.value,
    price_per_yard: pricePerYardFrom(Number(form.price.value), unit), supplier_id: form.supplier.value, currency_code: sellerCurrency(supplier),
    yards_available: Math.round(yardsFrom(Number(form.stock.value), unit) * 100) / 100, min_order_yards: Math.round(yardsFrom(Number(form.min.value), unit) * 100) / 100,
    // Added by the shop itself, so it's live straight away
    colour_name: nearestColourName(form.color.value), description: "", photos: [],
    status: "approved", sold_out: false, deleted_at: null, created_at: today(), review_note: ""
  });
  saveData();
  renderAll();
  return false;
}
