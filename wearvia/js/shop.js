// ============================================================
// shop.js — screen 18: ready-to-wear items for direct sale
// (customers buy them from the customer app's designer page)
// ============================================================

function renderShop() {
  const rows = bizRtw().map(item => {
    const sold = db.rtw_sales.filter(s => s.item_id === item.id).length;
    return `<tr>
      <td><span class="dot" style="background:${escapeHtml(item.color)}"></span> ${escapeHtml(item.name)}</td>
      <td>${money(item.price, rtwCurrency(item))}</td>
      <td>${money(item.cost, rtwCurrency(item))}</td>
      <td class="nowrap">
        <button class="small" onclick="changeRtwStock('${item.id}', -1)" ${item.stock <= 0 ? "disabled" : ""} aria-label="One fewer">−</button>
        <b class="${item.stock <= 2 ? "owed" : ""}">${item.stock}</b>
        <button class="small" onclick="changeRtwStock('${item.id}', 1)" aria-label="One more">+</button>
      </td>
      <td>${sold}</td>
    </tr>`;
  }).join("");

  const sales = bizRtwSales().slice().reverse().map(s => {
    const item = db.ready_to_wear.find(i => i.id === s.item_id);
    return `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(item ? item.name : "Removed item")}</td><td>${escapeHtml(s.customer_id ? customerName(s.customer_id) : "Guest")}</td><td>${money(s.price, rtwSaleCurrency(s))}</td>
      <td>${s.status === "awaiting_confirmation" ? `<button class="small gold" onclick="confirmRtwSale('${s.id}')">✓ Confirm payment</button>` : escapeHtml(PAYMENT_STATUS_LABELS[s.status] || "Confirmed")}</td></tr>`;
  }).join("");
  const takings = sumByCurrency(bizRtwSales().filter(isConfirmed), s => s.price, rtwSaleCurrency);
  const currency = bizCurrency();

  return `
    ${bizHeader("Ready to Wear", "Non-bespoke pieces for direct sale. Customers see these on the shop page of the customer app.")}
    <div class="two-col">
      <div class="card">
        <h2>Items</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Item</th><th>Price</th><th>Cost</th><th>Stock</th><th>Sold</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='5' class='empty'>No items yet.</td></tr>"}</tbody>
        </table></div>
        <form class="inline-form" onsubmit="return addRtwItem(event)">
          <input name="name" placeholder="Item name" required aria-label="Item name">
          <input name="price" type="number" min="1" step="0.01" placeholder="Price ${escapeHtml(currencyInfo(currency).symbol)}" required aria-label="Price in ${escapeHtml(currency)}" class="narrow">
          <input name="cost" type="number" min="0" step="0.01" placeholder="Cost ${escapeHtml(currencyInfo(currency).symbol)}" required aria-label="Cost in ${escapeHtml(currency)}" class="narrow">
          <input name="stock" type="number" min="0" placeholder="Stock" required aria-label="Stock" class="narrow">
          <button type="submit">Add item</button>
        </form>
      </div>
      <div class="card">
        <h2>Sales <span class="total">${totalsHtml(takings, currency)}</span></h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Item</th><th>Customer</th><th>Price</th><th>Payment</th></tr></thead>
          <tbody>${sales || "<tr><td colspan='5' class='empty'>No sales yet.</td></tr>"}</tbody>
        </table></div>
        <p><a href="#/rtw">Open the customer shop →</a></p>
      </div>
    </div>
  `;
}

function confirmRtwSale(saleId) {
  const sale = db.rtw_sales.find(s => s.id === saleId);
  if (!sale) return;
  sale.status = "confirmed";
  saveData();
  toast("Payment confirmed — post it to the customer.");
  renderAll();
}

function changeRtwStock(itemId, delta) {
  const item = db.ready_to_wear.find(i => i.id === itemId);
  item.stock = Math.max(0, item.stock + delta);
  saveData();
  renderAll();
}

function addRtwItem(event) {
  event.preventDefault();
  const form = event.target;
  const palette = COLOURS.map(c => c.hex);
  const count = bizRtw().length;
  db.ready_to_wear.push({
    id: newId("R", db.ready_to_wear), designer_id: bizDesignerId(), currency_code: bizCurrency(), name: form.name.value.trim(), price: Number(form.price.value),
    cost: Number(form.cost.value), stock: Number(form.stock.value), color: palette[count % palette.length]
  });
  saveData();
  renderAll();
  return false;
}
