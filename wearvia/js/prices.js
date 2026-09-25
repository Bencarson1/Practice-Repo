// ============================================================
// prices.js — Business → Prices: the tailoring price and typical
// yards for each outfit, embroidery prices and the delivery price.
// In live mode this is the database's price list: the database
// charges these prices on every customer order, so the quote the
// customer sees always matches. Fabric prices are set by sellers.
// ============================================================

function renderPrices() {
  const head = bizHeader(`Prices · ${escapeHtml(bizDesigner().business_name)}`, "Your own price list: what your customers pay for tailoring, embroidery and delivery. Fabric is priced per yard by each fabric seller.");
  const list = bizPrices();
  if (!list.length) {
    return `${head}
      <div class="card attention">
        <h2>The price list isn't in the database yet</h2>
        <p>Run <b>supabase/prices.sql</b> in Supabase → SQL Editor, then reload this page. Until then customers are quoted the starting prices.</p>
      </div>`;
  }
  const priceInput = p => `<input name="price-${p.id}" type="number" inputmode="decimal" min="0" max="100000" step="0.01" required
    value="${p.price}" aria-label="${escapeHtml(p.name)} price in pounds">`;
  const outfits = list.filter(p => p.kind === "outfit");
  const embroidery = list.filter(p => p.kind === "embroidery");
  const delivery = list.filter(p => p.kind === "delivery");

  return `
    ${head}
    <form id="prices-form" onsubmit="return savePrices(event)">
      <div class="two-col">
        <div class="card">
          <h2>Outfits</h2>
          <p class="hint">Tailoring is your making price. Typical yards is only a starting point for walk-in orders — customers never see it: you agree the yards with each customer in their order's chat.</p>
          <div class="table-wrap"><table class="price-table">
            <thead><tr><th>Outfit</th><th>Tailoring (${CURRENCY})</th><th>Typical yards</th></tr></thead>
            <tbody>${outfits.map(p => `<tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${priceInput(p)}</td>
              <td><input name="yards-${p.id}" type="number" inputmode="decimal" min="0.5" max="50" step="0.5" required
                value="${p.yards}" aria-label="${escapeHtml(p.name)} typical yards"></td>
            </tr>`).join("")}</tbody>
          </table></div>
        </div>
        <div class="stack">
          <div class="card">
            <h2>Embroidery</h2>
            <div class="table-wrap"><table class="price-table">
              <thead><tr><th>Embroidery</th><th>Price (${CURRENCY})</th></tr></thead>
              <tbody>${embroidery.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${priceInput(p)}</td></tr>`).join("")}</tbody>
            </table></div>
          </div>
          <div class="card">
            <h2>Delivery</h2>
            <div class="table-wrap"><table class="price-table">
              <tbody>${delivery.map(p => `<tr><td>${escapeHtml(p.name)} (${CURRENCY})</td><td>${priceInput(p)}</td></tr>`).join("")}</tbody>
            </table></div>
          </div>
          <div class="card">
            <p class="hint">New prices are used for new quotes straight away. Orders already placed keep the price they were placed at.</p>
            <div class="form-actions"><button type="submit">Save prices</button></div>
          </div>
        </div>
      </div>
    </form>`;
}

function savePrices(event) {
  event.preventDefault();
  const form = event.target;
  const field = name => form.elements.namedItem(name);
  const updates = [];
  for (const p of bizPrices()) {
    const price = Math.round(Number(field("price-" + p.id).value) * 100) / 100;
    if (field("price-" + p.id).value === "" || !(price >= 0)) {
      alert(`Enter a price for ${p.name} (0 or more).`);
      return false;
    }
    let yards = p.yards;
    if (p.kind === "outfit") {
      yards = Math.round(Number(field("yards-" + p.id).value) * 100) / 100;
      if (!(yards > 0)) {
        alert(`Enter the typical yards for ${p.name}.`);
        return false;
      }
    }
    if (price !== p.price || yards !== p.yards) updates.push({ p, price, yards });
  }
  if (!updates.length) {
    toast("No prices changed.");
    return false;
  }
  updates.forEach(u => { u.p.price = u.price; u.p.yards = u.yards; });
  usePricesOf(bizDesignerId());
  saveData();
  toast(`${updates.length} price${updates.length === 1 ? "" : "s"} saved. New quotes use them straight away.`);
  renderAll();
  return false;
}
