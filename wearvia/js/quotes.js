// ============================================================
// quotes.js — Business → Quote requests
//
// Customers send their design, style photos, measurements and chosen
// fabric to the tailor. The tailor opens the request, chats with the
// customer, enters the yards needed (and another fabric if they agreed one)
// and presses "Send quote". The fabric cost is calculated from the seller's
// price. The tailor enters their own tailoring, embroidery, delivery and
// optional extra charges for this specific order. The database records the
// quote so the customer and tailor see the same amount.
// ============================================================

const quoteForms = {};  // orderId -> values typed into the quote form, kept across redraws

// Requests that need the team: waiting for a quote, or a new message from the customer
function quotesNeedingTeam() {
  return quoteRequests().filter(o => quoteStatus(o) === "requested" || unreadCount(o.id, "team") > 0);
}

function quoteStatusBadge(order) {
  if (order.fabric_problem && quoteStatus(order) === "requested") return `<span class="badge stage-late">Fabric sold out</span>`;
  if (quoteStatus(order) === "quoted") return `<span class="badge status-pending">Quote sent</span>`;
  return `<span class="badge stage-quote">Waiting for your quote</span>`;
}

function renderQuotes(orderId) {
  if (orderId) return renderQuoteDetail(orderId);
  const requests = quoteRequests().slice().sort((a, b) =>
    (quoteStatus(a) === "quoted") - (quoteStatus(b) === "quoted") || !!b.fabric_problem - !!a.fabric_problem || b.created_at.localeCompare(a.created_at));
  const rows = requests.map(o => {
    const fabric = findFabric(o.fabric_id);
    const unread = unreadCount(o.id, "team");
    return `<tr class="clickable" onclick="go('quotes/${o.id}')">
      <td><a href="#/quotes/${o.id}">${o.id}</a></td>
      <td>${escapeHtml(customerName(o.customer_id))}</td>
      <td>${escapeHtml(o.outfit_type)}${hasInspiration(o.inspiration) ? ` <span title="Customer uploaded style photos" aria-label="has style photos">📷</span>` : ""}</td>
      <td>${escapeHtml(fabric ? fabric.name : "—")}${fabric ? ` <span class="muted">${escapeHtml(fabricPriceText(fabric, designerFabricUnit(bizDesigner())))}</span>` : ""}
        ${o.fabric_problem ? `<div class="owed small-text">⚠ ${escapeHtml(o.fabric_problem)}</div>` : ""}</td>
      <td>${formatDate(o.created_at)}</td>
      <td>${quoteStatusBadge(o)}${quoteStatus(o) === "quoted" ? `<div class="small-text">${money(o.quote_total, orderCurrency(o))} · ${lengthText(o.fabric_yards, orderFabricUnit(o))}</div>` : ""}</td>
      <td>${unread ? unreadBadge(unread) + " new" : `<span class="muted">${orderMessages(o.id).length} msg</span>`}</td>
      <td><a class="button small" href="#/quotes/${o.id}">Open</a></td>
    </tr>`;
  }).join("");
  const accepted = placedOrders().filter(o => o.accepted_at && o.quoted_at && o.accepted_at >= addDays(-14))
    .sort((a, b) => b.accepted_at.localeCompare(a.accepted_at)).slice(0, 5);

  return `
    ${bizHeader("Quote requests", `Customers who sent their order to you. Chat with them to agree the ${unitWord(designerFabricUnit(bizDesigner()), true)}, then enter your own price for this job and send the quote. Fabric cost is calculated from the seller's price. Your service charges are entered by you, in ${escapeHtml(currencyInfo(bizCurrency()).name)}. Fabric from another currency is converted at the day's exchange rate when you send the quote.`)}
    <div class="card">
      <h2>Waiting for you or the customer <span class="total">${requests.length}</span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Outfit</th><th>Fabric</th><th>Sent</th><th>Status</th><th>Chat</th><th></th></tr></thead>
        <tbody>${rows || "<tr><td colspan='8' class='empty'>No quote requests right now.</td></tr>"}</tbody>
      </table></div>
    </div>
    ${accepted.length ? `<div class="card">
      <h2>Recently accepted</h2>
      <p class="hint">These are now orders: confirm the deposit under Payments, then make them.</p>
      <ul class="plain-list">${accepted.map(o => `<li><a href="#/orders/${o.id}">${o.id}</a> · ${escapeHtml(customerName(o.customer_id))} · ${escapeHtml(o.outfit_type)} · ${money(o.quote_total, orderCurrency(o))} · accepted ${formatDate(o.accepted_at)}</li>`).join("")}</ul>
    </div>` : ""}`;
}

// Fabrics the tailor can quote: on sale and in stock
function quotableFabrics(order) {
  return activeFabrics().filter(f => isBuyable(f) || f.id === order.fabric_id)
    .sort((a, b) => (b.id === order.fabric_id) - (a.id === order.fabric_id) || a.name.localeCompare(b.name));
}

// In the customer's own unit first, and the other one too
function measurementsCard(order) {
  const profile = findProfile(order.measurement_profile_id);
  const unit = customerBodyUnit(findCustomer(order.customer_id));
  return `<div class="card">
    <h2>Measurements ${profile ? `<small class="muted">${escapeHtml(profile.label)} profile · the customer measures in ${unit === "cm" ? "centimetres" : "inches"}</small>` : ""}</h2>
    ${profile ? `<div class="measure-list">${MEASUREMENT_FIELDS.map(f => `<div><span>${f.label}</span><strong>${bodyBoth(profile[f.key], unit)}</strong></div>`).join("")}</div>`
      : `<p class="empty">No measurements yet. <a href="#/measurements">Add them</a>.</p>`}
  </div>`;
}

function designCard(order, extraRows) {
  return `<div class="card">
    <h2>Design</h2>
    <div class="design-row">
      <div class="thumb big">${conceptSVG({ outfit: order.outfit_type, colour: order.colour, embroidery: order.embroidery, sleeve: order.sleeve_style, neck: order.neck_style }, order.concept_variation)}</div>
      <div>
        <div class="kv"><span>Outfit</span><b>${escapeHtml(order.outfit_type)}</b></div>
        ${hasInspiration(order.inspiration) ? `<div class="kv"><span>Style</span><b>Copy the customer's photos</b></div>` : ""}
        <div class="kv"><span>Colour</span><b>${escapeHtml(colourName(order.colour))}</b></div>
        <div class="kv"><span>Embroidery</span><b>${escapeHtml(order.embroidery)}</b></div>
        <div class="kv"><span>Sleeve</span><b>${escapeHtml(order.sleeve_style)}</b></div>
        <div class="kv"><span>Neck</span><b>${escapeHtml(order.neck_style)}</b></div>
        ${extraRows || ""}
      </div>
    </div>
  </div>`;
}

function fabricRecommendationCard(order) {
  const current = fabricRecommendations(order, ["pending"]);
  const selected = fabricRecommendations(order, ["selected"])[0] || null;
  const selectedFabric = selected ? findFabric(selected.fabric_id) : null;
  const fabrics = quotableFabrics(order);
  const currentIds = new Set(current.map(r => r.fabric_id));
  const currentNote = current.length ? current[0].note || "" : "";
  const unit = designerFabricUnit(designerById(order.designer_id));

  if (!fabrics.length) {
    return `<div class="card">
      <h2>Recommend marketplace fabric</h2>
      <p class="empty">There are no approved marketplace fabrics in stock yet. You can still chat with the customer and arrange fabric later.</p>
    </div>`;
  }

  return `<div class="card fabric-recommend-card">
    <div class="row-between">
      <h2>Recommend marketplace fabric</h2>
      <span class="meta">Choose up to 3</span>
    </div>
    <p class="hint">${order.fabric_plan === "recommend" ? "<b>The customer asked you to help choose fabric.</b> " : ""}Send suitable NebedaHub marketplace fabrics to the customer. They choose one before you prepare the fabric-inclusive quote.</p>
    ${selectedFabric ? `<div class="notice"><b>Customer selected:</b> ${escapeHtml(selectedFabric.name)}. You can use it in the quote below.</div>` : ""}
    ${current.length ? `<div class="notice soft"><b>Waiting for customer:</b> ${current.length} recommendation${current.length === 1 ? "" : "s"} sent.</div>` : ""}
    <form id="fabric-rec-form-${order.id}" class="stack" onsubmit="return sendFabricRecommendations(event, '${order.id}')">
      <div class="recommend-grid">
        ${fabrics.map(f => {
          const seller = findSupplier(f.supplier_id);
          const checked = currentIds.has(f.id);
          return `<label class="recommend-fabric ${checked ? "selected" : ""}">
            <input type="checkbox" name="fabricRecommendation" value="${f.id}" ${checked ? "checked" : ""}
              onchange="limitFabricRecommendations(this, '${order.id}')">
            <img src="${fabricCoverUrl(f)}" alt="">
            <span class="recommend-info">
              <b>${escapeHtml(f.name)}</b>
              <small>${escapeHtml(seller ? seller.name : "Seller")}</small>
              <small>${escapeHtml(fabricPriceText(f, unit))} · ${lengthText(f.yards_available, unit)} left</small>
            </span>
          </label>`;
        }).join("")}
      </div>
      <label>Recommendation note <small class="muted">(optional)</small>
        <textarea name="recommendationNote" rows="2" maxlength="500" placeholder="e.g. These two fabrics will hold the embroidery well.">${escapeHtml(currentNote)}</textarea>
      </label>
      <div class="form-actions"><button type="submit">${current.length ? "Update recommendations" : "Recommend selected fabrics"}</button></div>
    </form>
  </div>`;
}

function limitFabricRecommendations(input, orderId) {
  const form = document.getElementById("fabric-rec-form-" + orderId);
  if (!form) return;
  const checked = Array.from(form.querySelectorAll('input[name="fabricRecommendation"]:checked'));
  if (checked.length > 3) {
    input.checked = false;
    toast("Choose up to 3 fabrics.");
  }
  input.closest(".recommend-fabric").classList.toggle("selected", input.checked);
}

let sendingFabricRecommendations = false;
function sendFabricRecommendations(event, orderId) {
  event.preventDefault();
  if (sendingFabricRecommendations) return false;
  const form = event.target;
  const order = findOrder(orderId);
  const ids = Array.from(form.querySelectorAll('input[name="fabricRecommendation"]:checked')).map(x => x.value);
  if (!ids.length) { toast("Choose at least one fabric to recommend."); return false; }
  if (ids.length > 3) { toast("Choose no more than 3 fabrics."); return false; }
  const button = form.querySelector('button[type="submit"]');
  sendingFabricRecommendations = true;
  if (button) { button.disabled = true; button.textContent = "Sending…"; }
  let result;
  try {
    result = recommendFabricsForOrder(order, ids, form.recommendationNote.value);
  } catch (error) {
    result = Promise.reject(error);
  }
  Promise.resolve(result)
    .then(() => {
      if (!Cloud.live) saveData();
      toast("Fabric recommendations sent to the customer.");
      renderAll();
    })
    .catch(error => {
      alert(error.message || "Could not send the recommendations.");
      if (button) { button.disabled = false; button.textContent = "Recommend selected fabrics"; }
    })
    .finally(() => { sendingFabricRecommendations = false; });
  return false;
}

function renderQuoteDetail(orderId) {
  const order = findOrder(orderId);
  if (!order) return `${bizHeader("Quote request not found")}<p><a href="#/quotes">← Quote requests</a></p>`;
  if (isPlaced(order)) {
    return `<p><a href="#/quotes">← Quote requests</a></p>
      ${bizHeader(`Order ${order.id} ${stageBadge(order)}`)}
      <div class="card"><p>The customer accepted this quote${order.accepted_at ? " on " + formatDate(order.accepted_at) : ""}. It's an order now.</p>
      <a class="button" href="#/orders/${order.id}">Open order ${order.id} →</a></div>`;
  }
  const customer = findCustomer(order.customer_id);
  const fabric = findFabric(order.fabric_id);
  const quoted = quoteStatus(order) === "quoted";
  const fabrics = quotableFabrics(order);
  const typed = quoteForms[order.id] || {};
  // The tailor's unit (yards or metres) and currency
  const unit = designerFabricUnit(designerById(order.designer_id));
  const currency = designerCurrency(designerById(order.designer_id));
  const startYards = typed.yards != null ? typed.yards : quoted ? lengthIn(order.fabric_yards, unit) : "";
  const startFabric = typed.fabric || (fabric && isBuyable(fabric) ? fabric.id : "");
  const startTailoring = typed.tailoring != null ? typed.tailoring : quoted ? Number(order.tailoring_cost || 0) : "";
  const startEmbroidery = typed.embroidery != null ? typed.embroidery : quoted ? Number(order.embroidery_cost || 0) : 0;
  const startDelivery = typed.delivery != null ? typed.delivery : quoted ? Number(order.delivery_cost || 0) : 0;
  const quotedExtra = quoted ? (order.line_items || []).find(l => l.kind === "extra") : null;
  const startExtra = typed.extra != null ? typed.extra : quotedExtra ? Number(quotedExtra.amount || 0) : 0;
  const startExtraLabel = typed.extraLabel != null ? typed.extraLabel : quotedExtra ? String(quotedExtra.label || "Extra charge") : "";
  const options = fabrics.map(f => {
    const seller = findSupplier(f.supplier_id);
    const out = !isBuyable(f);
    return `<option value="${f.id}" ${f.id === startFabric && !out ? "selected" : ""} ${out ? "disabled" : ""}>${escapeHtml(f.name)} — ${escapeHtml(fabricPriceText(f, unit))} · ${out ? "sold out" : `${lengthText(f.yards_available, unit)} left`}${seller ? " · " + escapeHtml(seller.name) : ""}${f.id === order.fabric_id ? " (customer's choice)" : ""}</option>`;
  }).join("");

  return `
    <p><a href="#/quotes">← Quote requests</a></p>
    ${bizHeader(`Quote request ${order.id} ${quoteStatusBadge(order)}`, `${escapeHtml(order.outfit_type)} for <a href="#/customers/${order.customer_id}">${escapeHtml(customer ? customer.name : "Unknown")}</a> · sent ${formatDate(order.created_at)} · chat below — contact details stay on ${APP_NAME}`)}
    ${order.fabric_problem ? `<div class="card attention"><b>⚠ ${escapeHtml(order.fabric_problem)}.</b> The customer has been told in the chat. Suggest another fabric, then choose it below and send a new quote.</div>` : ""}

    <div class="quote-layout">
      <div class="card chat-card">
        <h2>Chat with ${escapeHtml(customer ? customer.name.split(" ")[0] : "the customer")}</h2>
        ${chatPanel(order, "team")}
      </div>

      <div class="stack">
        ${fabricRecommendationCard(order)}
        <div class="card quote-form-card">
          <h2>${quoted ? "Quote sent" : "Send the quote"}</h2>
          ${quoted ? `<p class="hint">Sent ${formatDate(order.quoted_at)}: <b>${lengthText(order.fabric_yards, orderFabricUnit(order))}</b> · total <b>${money(order.quote_total, orderCurrency(order))}</b> — waiting for the customer to accept. You can send a new one until they do.</p>` : ""}
          <form id="quote-form" class="stack" onsubmit="return sendQuoteFromForm(event, '${order.id}')" oninput="updateQuotePreview(this, '${order.id}')">
            <label>Fabric<select name="fabric">${options || "<option value=''>No fabrics in stock</option>"}</select></label>
            <label>${capitalize(unitWord(unit, true))} needed<input name="yards" type="number" inputmode="decimal" min="0.25" max="100" step="0.25" value="${startYards}" required placeholder="e.g. 5.5"></label>
            <div class="card soft">
              <b>Your charges for this order (${escapeHtml(currency)})</b>
              <p class="hint">You decide these amounts. NebedaHub does not set your tailoring price.</p>
              <label>Tailoring price<input name="tailoring" type="number" inputmode="decimal" min="0" step="0.01" value="${startTailoring}" required placeholder="Enter your making price"></label>
              <label>Embroidery charge<input name="embroidery" type="number" inputmode="decimal" min="0" step="0.01" value="${startEmbroidery}"></label>
              <label>Delivery charge<input name="delivery" type="number" inputmode="decimal" min="0" step="0.01" value="${startDelivery}"></label>
              <label>Extra charge <small class="muted">(optional)</small><input name="extra" type="number" inputmode="decimal" min="0" step="0.01" value="${startExtra}"></label>
              <label>Extra charge description <small class="muted">(optional)</small><input name="extraLabel" maxlength="80" value="${escapeHtml(startExtraLabel)}" placeholder="e.g. Rush order"></label>
            </div>
            <div id="quote-preview" class="quote-preview">${quotePreviewHtml(order, startFabric, startYards, { tailoring: startTailoring, embroidery: startEmbroidery, delivery: startDelivery, extra: startExtra, extraLabel: startExtraLabel })}</div>
            <label>Message with the quote <small class="muted">(optional)</small><textarea name="note" rows="2" maxlength="${CHAT_TEXT_MAX}" placeholder="e.g. I have reviewed your design and this is my quote.">${escapeHtml(typed.note || "")}</textarea></label>
            <div class="form-actions"><button type="submit" id="send-quote">${quoted ? "Send new quote" : "Send quote"}</button></div>
          </form>
          <p class="hint">The customer sees the quote in their order and in the chat, and taps <b>Accept quote</b>. Only then is the fabric taken out of stock and ordered from the seller.</p>
        </div>
        ${styleBriefCompact(order)}
        ${measurementsCard(order)}
        ${designCard(order)}
      </div>
    </div>`;
}

// The customer's style photos, note and link — smaller than on the order page
function styleBriefCompact(order) {
  const insp = order.inspiration;
  if (!hasInspiration(insp)) return "";
  return `<div class="card style-brief">
    <h2>📷 Customer's style</h2>
    <div class="style-mini">${styleThumbs(order.id, insp)}</div>
    ${insp.note ? `<blockquote class="style-note small">${escapeHtml(insp.note)}</blockquote>` : ""}
    ${styleLinkHtml(insp.link)}
  </div>`;
}

// What the quote comes to, worked out the same way as the database does it — in the
// tailor's currency, with a seller's fabric converted at today's rate. (The database
// uses the rate at the moment you press Send quote, and saves it on the order.)
function quotePreviewHtml(order, fabricId, yardsText, prices) {
  const fabric = findFabric(fabricId);
  const tailor = designerById(order.designer_id);
  const unit = designerFabricUnit(tailor);
  const currency = designerCurrency(tailor);
  const length = Number(yardsText);
  const yards = yardsFrom(length, unit);
  const own = prices || {};
  const tailoring = Number(own.tailoring);
  const embroidery = Number(own.embroidery || 0);
  const delivery = Number(own.delivery || 0);
  const extra = Number(own.extra || 0);
  const extraLabel = String(own.extraLabel || "Extra charge").trim() || "Extra charge";
  if (!fabric) return `<p class="muted">Choose a fabric.</p>`;
  if (!yardsText || !(length > 0)) return `<p class="muted">Enter the ${unitWord(unit, true)} to see the fabric cost and quote total.</p>`;
  if (!(tailoring >= 0)) return `<p class="muted">Enter your tailoring price for this order.</p>`;
  let problem = "";
  if (Math.round(length * 4) !== length * 4) problem = `Use quarter ${unitWord(unit, true)} (for example 4.5 or 5.25).`;
  else if (yards < fabric.min_order_yards - 0.005) problem = `The smallest order for ${fabric.name} is ${lengthText(fabric.min_order_yards, unit)}.`;
  else if (yards > fabric.yards_available) problem = `Only ${lengthText(fabric.yards_available, unit)} of ${fabric.name} is left.`;
  const quote = computeQuote(order.outfit_type, order.embroidery, fabric, length, { tailoring, embroidery, delivery }, { currency, unit });
  if (quote.noRate) return `<p class="owed">There is no exchange rate for ${escapeHtml(quote.fabricCurrency)} yet, so this fabric cannot be priced in ${escapeHtml(currency)}. Try again later, or choose a fabric priced in ${escapeHtml(currency)}.</p>`;
  const lines = quote.lines.slice();
  if (extra > 0) lines.push({ label: extraLabel, amount: roundMoney(extra, currency), kind: "extra" });
  const total = roundMoney(quote.total + Math.max(0, extra), currency);
  return `${lines.map(l => `<div class="qline"><span>${escapeHtml(l.label)}</span><span>${money(l.amount, currency)}</span></div>`).join("")}
    <div class="qtotal"><span>Total</span><span>${money(total, currency)}</span></div>
    <div class="muted small-text">Deposit ${money(depositFor(total), currency)} (${Math.round(DEPOSIT_RATE * 100)}%)</div>
    ${quote.rate ? `<p class="hint">The seller charges ${money(quote.fabricAmount, quote.fabricCurrency)}. Today ${escapeHtml(rateText(quote.rate, quote.fabricCurrency, currency))}. The rate used when you send the quote is saved on the order.</p>` : ""}
    ${problem ? `<p class="owed">${escapeHtml(problem)}</p>` : ""}`;
}

function quoteFormPrices(form) {
  return {
    tailoring: form.tailoring.value,
    embroidery: form.embroidery.value || 0,
    delivery: form.delivery.value || 0,
    extra: form.extra.value || 0,
    extraLabel: form.extraLabel.value || ""
  };
}

function updateQuotePreview(form, orderId) {
  const prices = quoteFormPrices(form);
  quoteForms[orderId] = {
    fabric: form.fabric.value, yards: form.yards.value, note: form.note.value,
    tailoring: prices.tailoring, embroidery: prices.embroidery, delivery: prices.delivery,
    extra: prices.extra, extraLabel: prices.extraLabel
  };
  const el = document.getElementById("quote-preview");
  if (el) el.innerHTML = quotePreviewHtml(findOrder(orderId), form.fabric.value, form.yards.value, prices);
}

let sendingQuote = false;
function sendQuoteFromForm(event, orderId) {
  event.preventDefault();
  if (sendingQuote) return false;
  const form = event.target;
  const order = findOrder(orderId);
  const waitingRecommendations = fabricRecommendations(order, ["pending"]);
  if (waitingRecommendations.length) {
    alert("The customer still needs to choose one of your recommended fabrics before you send the quote.");
    return false;
  }
  const fabric = findFabric(form.fabric.value);
  const tailor = designerById(order.designer_id);
  const unit = designerFabricUnit(tailor);
  const currency = designerCurrency(tailor);
  const length = Number(form.yards.value);
  if (!fabric || !(length > 0)) { alert(`Choose a fabric and enter the ${unitWord(unit, true)} needed.`); return false; }
  const prices = quoteFormPrices(form);
  const tailoring = Number(prices.tailoring);
  const embroidery = Number(prices.embroidery || 0);
  const delivery = Number(prices.delivery || 0);
  const extra = Number(prices.extra || 0);
  if (!(tailoring >= 0) || !(embroidery >= 0) || !(delivery >= 0) || !(extra >= 0)) {
    alert("Enter valid charges. Each amount must be 0 or more.");
    return false;
  }
  const quote = computeQuote(order.outfit_type, order.embroidery, fabric, length, { tailoring, embroidery, delivery }, { currency, unit });
  if (quote.noRate) { alert(`There is no exchange rate for ${quote.fabricCurrency} yet. Try again later.`); return false; }
  const total = roundMoney(quote.total + extra, currency);
  if (!confirm(`Send ${customerName(order.customer_id).split(" ")[0]} your quote of ${money(total, currency)} for this order?${quote.rate ? ` The fabric is converted from ${quote.fabricCurrency} at the exchange rate when you send.` : ""}`)) return false;
  sendingQuote = true;
  const button = document.getElementById("send-quote");
  if (button) { button.disabled = true; button.textContent = "Sending…"; }
  let sent;
  try {
    sent = sendQuote(order, fabric.id, length, form.note.value, unit, prices);
  } catch (error) {
    sent = Promise.reject(error);
  }
  Promise.resolve(sent)
    .then(() => {
      if (!Cloud.live) saveData();
      delete quoteForms[orderId];
      chatPinned[orderId] = true;
      toast(`Quote sent to ${customerName(order.customer_id)}.`);
      renderAll();
    })
    .catch(error => {
      alert(error.message || "Could not send the quote.");
      if (button) { button.disabled = false; button.textContent = "Send quote"; }
    })
    .finally(() => { sendingQuote = false; });
  return false;
}
