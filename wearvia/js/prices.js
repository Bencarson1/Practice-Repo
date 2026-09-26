// ============================================================
// prices.js — Business → Prices: the tailoring price and typical
// yards for each outfit, embroidery prices and the delivery price.
// In live mode this is the database's price list: the database
// charges these prices on every customer order, so the quote the
// customer sees always matches. Fabric prices are set by sellers.
// ============================================================

function renderPrices() {
  const currency = bizCurrency();
  const head = bizHeader(`Prices · ${escapeHtml(bizDesigner().business_name)}`, `Your own price list, in ${escapeHtml(currencyInfo(currency).name)} (${escapeHtml(currency)}): what your customers pay for tailoring, embroidery and delivery. Fabric is priced by each fabric seller in their own currency, and converted into yours when you send a quote. You can change your currency in <a href="#/biz/profile">My profile</a>.`);
  const list = bizPrices();
  // Prices still in another currency (a tailor who joined before exchange rates arrived)
  const foreign = list.filter(p => p.currency_code && p.currency_code !== currency);
  if (!list.length) {
    return `${head}
      <div class="card attention">
        <h2>The price list isn't in the database yet</h2>
        <p>Run <b>supabase/prices.sql</b> in Supabase → SQL Editor, then reload this page. Until then customers are quoted the starting prices.</p>
      </div>`;
  }
  const priceInput = p => `<span class="price-in"><span class="cur">${escapeHtml(currencySymbol(p.currency_code || currency))}</span><input name="price-${p.id}" type="number" inputmode="decimal" min="0" max="100000000" step="${currencyInfo(p.currency_code || currency).decimals ? "0.01" : "1"}" required
    value="${p.price}" aria-label="${escapeHtml(p.name)} price in ${escapeHtml(currencyInfo(p.currency_code || currency).name)}"></span>`;
  const unit = designerFabricUnit(bizDesigner());
  const outfits = list.filter(p => p.kind === "outfit");
  const embroidery = list.filter(p => p.kind === "embroidery");
  const delivery = list.filter(p => p.kind === "delivery");

  return `
    ${head}
    ${foreign.length ? `<div class="card attention"><b>${foreign.length} price${foreign.length === 1 ? " is" : "s are"} still in ${escapeHtml(Array.from(new Set(foreign.map(p => p.currency_code))).join(", "))}.</b>
      Quotes convert ${foreign.length === 1 ? "it" : "them"} into ${escapeHtml(currency)} at the day's rate. <button type="button" class="small gold" onclick="convertMyPrices()">Put all my prices in ${escapeHtml(currency)}</button></div>` : ""}
    <form id="prices-form" onsubmit="return savePrices(event)">
      <div class="two-col">
        <div class="card">
          <h2>Outfits</h2>
          <p class="hint">Tailoring is your making price. Typical ${unitWord(unit, true)} is only a starting point for walk-in orders — customers never see it: you agree the length with each customer in their order's chat.</p>
          <div class="table-wrap"><table class="price-table">
            <thead><tr><th>Outfit</th><th>Tailoring (${escapeHtml(currency)})</th><th>Typical ${unitWord(unit, true)}</th></tr></thead>
            <tbody>${outfits.map(p => `<tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${priceInput(p)}</td>
              <td><input name="yards-${p.id}" type="number" inputmode="decimal" min="0.5" max="50" step="0.25" required
                value="${lengthIn(p.yards, unit)}" data-original="${lengthIn(p.yards, unit)}" aria-label="${escapeHtml(p.name)} typical ${unitWord(unit, true)}"></td>
            </tr>`).join("")}</tbody>
          </table></div>
        </div>
        <div class="stack">
          <div class="card">
            <h2>Embroidery</h2>
            <div class="table-wrap"><table class="price-table">
              <thead><tr><th>Embroidery</th><th>Price (${escapeHtml(currency)})</th></tr></thead>
              <tbody>${embroidery.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${priceInput(p)}</td></tr>`).join("")}</tbody>
            </table></div>
          </div>
          <div class="card">
            <h2>Delivery</h2>
            <div class="table-wrap"><table class="price-table">
              <tbody>${delivery.map(p => `<tr><td>${escapeHtml(p.name)} (${escapeHtml(currency)})</td><td>${priceInput(p)}</td></tr>`).join("")}</tbody>
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
  const unit = designerFabricUnit(bizDesigner());
  for (const p of bizPrices()) {
    const price = roundMoney(Number(field("price-" + p.id).value), p.currency_code || bizCurrency());
    if (field("price-" + p.id).value === "" || !(price >= 0)) {
      alert(`Enter a price for ${p.name} (0 or more).`);
      return false;
    }
    let yards = p.yards;
    if (p.kind === "outfit") {
      const box = field("yards-" + p.id);
      yards = box.value === box.dataset.original ? p.yards : Math.round(yardsFrom(Number(box.value), unit) * 100) / 100;
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

// Puts any prices still in another currency into the tailor's own, at today's rate
function convertMyPrices() {
  const d = bizDesigner();
  const currency = designerCurrency(d);
  if (Cloud.live) {
    Cloud.convertPriceList(d.id).then(n => { toast(`${n} price${n === 1 ? "" : "s"} converted to ${currency}. Check them and change any you like.`); renderAll(); },
      error => alert(error.message));
    return;
  }
  let n = 0;
  bizPrices().forEach(p => {
    if (!p.currency_code || p.currency_code === currency) return;
    const converted = convertMoney(p.price, p.currency_code, currency);
    if (converted == null) return;
    p.price = nicePrice(converted, currency);
    p.currency_code = currency;
    n += 1;
  });
  usePricesOf(d.id);
  saveData();
  toast(`${n} price${n === 1 ? "" : "s"} converted to ${currency}.`);
  renderAll();
}
