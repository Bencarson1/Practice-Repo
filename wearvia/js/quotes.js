// ============================================================
// quotes.js — Business → Quote requests
//
// Customers send their design, style photos, measurements and chosen
// fabric to the tailor. The tailor opens the request, chats with the
// customer, enters the yards needed (and another fabric if they agreed one)
// and presses "Send quote". The price is worked out from the fabric
// seller's price per yard and the price list — in live mode by the
// database (wearvia_send_quote), so it's always the same everywhere.
// ============================================================

const quoteForms = {};  // orderId → { fabric, yards, note } typed into the quote form, kept across redraws

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
    return `<tr class="clickable" onclick="go('biz/quotes/${o.id}')">
      <td><a href="#/biz/quotes/${o.id}">${o.id}</a></td>
      <td>${escapeHtml(customerName(o.customer_id))}</td>
      <td>${escapeHtml(o.outfit_type)}${hasInspiration(o.inspiration) ? ` <span title="Customer uploaded style photos" aria-label="has style photos">📷</span>` : ""}</td>
      <td>${escapeHtml(fabric ? fabric.name : "—")}${fabric ? ` <span class="muted">${money(fabric.price_per_yard)}/yd</span>` : ""}
        ${o.fabric_problem ? `<div class="owed small-text">⚠ ${escapeHtml(o.fabric_problem)}</div>` : ""}</td>
      <td>${formatDate(o.created_at)}</td>
      <td>${quoteStatusBadge(o)}${quoteStatus(o) === "quoted" ? `<div class="small-text">${money(o.quote_total)} · ${o.fabric_yards} yd</div>` : ""}</td>
      <td>${unread ? unreadBadge(unread) + " new" : `<span class="muted">${orderMessages(o.id).length} msg</span>`}</td>
      <td><a class="button small" href="#/biz/quotes/${o.id}">Open</a></td>
    </tr>`;
  }).join("");
  const accepted = placedOrders().filter(o => o.accepted_at && o.quoted_at && o.accepted_at >= addDays(-14))
    .sort((a, b) => b.accepted_at.localeCompare(a.accepted_at)).slice(0, 5);

  return `
    ${bizHeader("Quote requests", "Customers who sent their order to you. Chat with them to agree the yards, then send the quote. The price is the fabric seller's price per yard × the yards, plus tailoring, embroidery and delivery from your price list.")}
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
      <ul class="plain-list">${accepted.map(o => `<li><a href="#/biz/orders/${o.id}">${o.id}</a> · ${escapeHtml(customerName(o.customer_id))} · ${escapeHtml(o.outfit_type)} · ${money(o.quote_total)} · accepted ${formatDate(o.accepted_at)}</li>`).join("")}</ul>
    </div>` : ""}`;
}

// Fabrics the tailor can quote: on sale and in stock
function quotableFabrics(order) {
  return activeFabrics().filter(f => isBuyable(f) || f.id === order.fabric_id)
    .sort((a, b) => (b.id === order.fabric_id) - (a.id === order.fabric_id) || a.name.localeCompare(b.name));
}

function measurementsCard(order) {
  const profile = findProfile(order.measurement_profile_id);
  return `<div class="card">
    <h2>Measurements ${profile ? `<small class="muted">${escapeHtml(profile.label)} profile</small>` : ""}</h2>
    ${profile ? `<div class="measure-list">${MEASUREMENT_FIELDS.map(f => `<div><span>${f.label}</span><strong>${profile[f.key] != null ? profile[f.key] + '"' : "—"}</strong></div>`).join("")}</div>`
      : `<p class="empty">No measurements yet. <a href="#/biz/measurements">Add them</a>.</p>`}
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

function renderQuoteDetail(orderId) {
  const order = findOrder(orderId);
  if (!order) return `${bizHeader("Quote request not found")}<p><a href="#/biz/quotes">← Quote requests</a></p>`;
  if (isPlaced(order)) {
    return `<p><a href="#/biz/quotes">← Quote requests</a></p>
      ${bizHeader(`Order ${order.id} ${stageBadge(order)}`)}
      <div class="card"><p>The customer accepted this quote${order.accepted_at ? " on " + formatDate(order.accepted_at) : ""}. It's an order now.</p>
      <a class="button" href="#/biz/orders/${order.id}">Open order ${order.id} →</a></div>`;
  }
  const customer = findCustomer(order.customer_id);
  const fabric = findFabric(order.fabric_id);
  const quoted = quoteStatus(order) === "quoted";
  const fabrics = quotableFabrics(order);
  const typed = quoteForms[order.id] || {};
  const startYards = typed.yards != null ? typed.yards : quoted ? order.fabric_yards : "";
  const startFabric = typed.fabric || (fabric && isBuyable(fabric) ? fabric.id : "");
  const options = fabrics.map(f => {
    const seller = findSupplier(f.supplier_id);
    const out = !isBuyable(f);
    return `<option value="${f.id}" ${f.id === startFabric && !out ? "selected" : ""} ${out ? "disabled" : ""}>${escapeHtml(f.name)} — ${money(f.price_per_yard)}/yd · ${out ? "sold out" : `${f.yards_available} yd left`}${seller ? " · " + escapeHtml(seller.name) : ""}${f.id === order.fabric_id ? " (customer's choice)" : ""}</option>`;
  }).join("");

  return `
    <p><a href="#/biz/quotes">← Quote requests</a></p>
    ${bizHeader(`Quote request ${order.id} ${quoteStatusBadge(order)}`, `${escapeHtml(order.outfit_type)} for <a href="#/biz/customers/${order.customer_id}">${escapeHtml(customer ? customer.name : "Unknown")}</a> · sent ${formatDate(order.created_at)} · chat below — contact details stay on ${APP_NAME}`)}
    ${order.fabric_problem ? `<div class="card attention"><b>⚠ ${escapeHtml(order.fabric_problem)}.</b> The customer has been told in the chat. Suggest another fabric, then choose it below and send a new quote.</div>` : ""}

    <div class="quote-layout">
      <div class="card chat-card">
        <h2>Chat with ${escapeHtml(customer ? customer.name.split(" ")[0] : "the customer")}</h2>
        ${chatPanel(order, "team")}
      </div>

      <div class="stack">
        <div class="card quote-form-card">
          <h2>${quoted ? "Quote sent" : "Send the quote"}</h2>
          ${quoted ? `<p class="hint">Sent ${formatDate(order.quoted_at)}: <b>${order.fabric_yards} yd</b> · total <b>${money(order.quote_total)}</b> — waiting for the customer to accept. You can send a new one until they do.</p>` : ""}
          <form id="quote-form" class="stack" onsubmit="return sendQuoteFromForm(event, '${order.id}')" oninput="updateQuotePreview(this, '${order.id}')">
            <label>Fabric<select name="fabric">${options || "<option value=''>No fabrics in stock</option>"}</select></label>
            <label>Yards needed<input name="yards" type="number" inputmode="decimal" min="0.25" max="100" step="0.25" value="${startYards}" required placeholder="e.g. 5.5"></label>
            <div id="quote-preview" class="quote-preview">${quotePreviewHtml(order, startFabric, startYards)}</div>
            <label>Message with the quote <small class="muted">(optional)</small><textarea name="note" rows="2" maxlength="${CHAT_TEXT_MAX}" placeholder="e.g. As we agreed: 5.5 yd so the robe reaches your ankles.">${escapeHtml(typed.note || "")}</textarea></label>
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

// What the quote comes to, worked out the same way as the database does it
function quotePreviewHtml(order, fabricId, yardsText) {
  const fabric = findFabric(fabricId);
  const yards = Number(yardsText);
  if (!fabric) return `<p class="muted">Choose a fabric.</p>`;
  if (!yardsText || !(yards > 0)) return `<p class="muted">Enter the yards to see the quote. ${escapeHtml(fabric.name)} is ${money(fabric.price_per_yard)}/yd${fabric.min_order_yards > 0 ? `, smallest order ${fabric.min_order_yards} yd` : ""}.</p>`;
  let problem = "";
  if (Math.round(yards * 4) !== yards * 4) problem = "Use quarter yards (for example 4.5 or 5.25).";
  else if (yards < fabric.min_order_yards) problem = `The smallest order for ${fabric.name} is ${fabric.min_order_yards} yd.`;
  else if (yards > fabric.yards_available) problem = `Only ${fabric.yards_available} yd of ${fabric.name} is left.`;
  const quote = computeQuote(order.outfit_type, order.embroidery, fabric, yards);
  return `${quote.lines.map(l => `<div class="qline"><span>${escapeHtml(l.label)}</span><span>${money(l.amount)}</span></div>`).join("")}
    <div class="qtotal"><span>Total</span><span>${money(quote.total)}</span></div>
    <div class="muted small-text">Deposit ${money(depositFor(quote.total))} (${Math.round(DEPOSIT_RATE * 100)}%)</div>
    ${problem ? `<p class="owed">${escapeHtml(problem)}</p>` : ""}`;
}

function updateQuotePreview(form, orderId) {
  quoteForms[orderId] = { fabric: form.fabric.value, yards: form.yards.value, note: form.note.value };
  const el = document.getElementById("quote-preview");
  if (el) el.innerHTML = quotePreviewHtml(findOrder(orderId), form.fabric.value, form.yards.value);
}

let sendingQuote = false;
function sendQuoteFromForm(event, orderId) {
  event.preventDefault();
  if (sendingQuote) return false;
  const form = event.target;
  const order = findOrder(orderId);
  const fabric = findFabric(form.fabric.value);
  const yards = Number(form.yards.value);
  if (!fabric || !(yards > 0)) { alert("Choose a fabric and enter the yards needed."); return false; }
  const quote = computeQuote(order.outfit_type, order.embroidery, fabric, yards);
  if (!confirm(`Send ${customerName(order.customer_id).split(" ")[0]} a quote of ${money(quote.total)} for ${yards} yd of ${fabric.name}?`)) return false;
  sendingQuote = true;
  const button = document.getElementById("send-quote");
  if (button) { button.disabled = true; button.textContent = "Sending…"; }
  let sent;
  try {
    sent = sendQuote(order, fabric.id, yards, form.note.value);
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
      alert(error.message || "Couldn't send the quote.");
      if (button) { button.disabled = false; button.textContent = "Send quote"; }
    })
    .finally(() => { sendingQuote = false; });
  return false;
}
