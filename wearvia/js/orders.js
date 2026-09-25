// ============================================================
// orders.js — screen 13: every order (live), walk-in orders,
// and the full detail page for one order
// ============================================================

let pendingFabricId = null; // set when "Use in an order" is clicked in Fabric Inventory
let orderFilter = "All";

function renderOrdersTab(orderId) {
  if (orderId) return renderOrderDetail(orderId);

  const filters = ["All", "In progress", "Late", "Delivered"];
  const waiting = quoteRequests();
  const shown = placedOrders().slice().reverse().filter(o =>
    orderFilter === "All" || (orderFilter === "In progress" && isOpen(o)) ||
    (orderFilter === "Late" && isLate(o)) || (orderFilter === "Delivered" && !isOpen(o)));

  const rows = shown.map(o => {
    const fabric = findFabric(o.fabric_id);
    const balance = balanceOwed(o);
    const unread = unreadCount(o.id, "team");
    return `<tr>
      <td><a href="#/biz/orders/${o.id}">${o.id}</a>${unread ? ` <span title="New messages from the customer">💬${unreadBadge(unread)}</span>` : ""}</td>
      <td>${escapeHtml(customerName(o.customer_id))}</td>
      <td>${escapeHtml(o.outfit_type)}${hasInspiration(o.inspiration) ? ` <span title="Customer uploaded style photos" aria-label="has style photos">📷</span>` : ""}</td>
      <td>${escapeHtml(fabric ? fabric.name : "—")} (${o.fabric_yards} yd)</td>
      <td class="${isLate(o) ? "owed" : ""}">${formatDate(o.due_date)}</td>
      <td>${stageBadge(o)}</td>
      <td>${money(o.quote_total)}</td>
      <td class="${balance > 0 ? "owed" : "paid"}">${balance > 0 ? money(balance) : "Paid"}</td>
      <td class="nowrap"><a class="button small" href="#/biz/orders/${o.id}">Open</a>
        <button class="small danger" onclick="deleteOrder('${o.id}')">Delete</button></td>
    </tr>`;
  }).join("");

  const fabricOptions = activeFabrics().filter(f => !isSoldOut(f) || f.id === pendingFabricId).map(f =>
    `<option value="${f.id}" ${f.id === pendingFabricId ? "selected" : ""}>${escapeHtml(f.name)} — ${money(f.price_per_yard)}/yd (${f.yards_available} yd left)</option>`).join("");
  const select = (name, items) => `<select name="${name}">${items.map(i => `<option value="${escapeHtml(i.value)}">${escapeHtml(i.label)}</option>`).join("")}</select>`;

  return `
    ${bizHeader("All Orders — Live", "Every order across every customer, with the step it's on now.")}
    ${waiting.length ? `<a class="alert quote-alert" href="#/biz/quotes">📝 ${waiting.length} quote request${waiting.length === 1 ? "" : "s"} — customers waiting for you or deciding on a quote →</a>` : ""}

    <div class="card">
      <h2>New walk-in order</h2>
      <p class="hint">For orders taken in the shop or by phone: you enter the yards directly. (Online customers send their order to you as a <a href="#/biz/quotes">quote request</a> instead, and you agree the yards with them in the chat.) The price is worked out the same way (fabric + tailoring + embroidery + delivery) and the order starts once a deposit is paid. Leave the tailoring, embroidery and delivery prices blank to use the <a href="#/biz/prices">price list</a>, or type your own price for this order.</p>
      <form id="order-form" class="form-grid" onsubmit="return createWalkInOrder(event)">
        <label>Customer name
          <input name="customer" list="customer-list" required placeholder="Type a name">
          <datalist id="customer-list">${bizCustomers().map(c => `<option value="${escapeHtml(c.name)}"></option>`).join("")}</datalist>
        </label>
        <label>Phone (for new customers)<input name="phone" placeholder="Optional"></label>
        <label>Outfit<select name="outfit" onchange="this.form.yards.value = findOutfit(this.value).yards; showListPrices(this.form)">${OUTFITS.map(o =>
          `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`).join("")}</select></label>
        <label>Colour${select("colour", COLOURS.map(c => ({ value: c.hex, label: c.name })))}</label>
        <label>Embroidery<select name="embroidery" onchange="showListPrices(this.form)">${EMBROIDERY.map(e =>
          `<option value="${escapeHtml(e.name)}">${escapeHtml(`${e.name} (${money(e.price)})`)}</option>`).join("")}</select></label>
        <label>Sleeve${select("sleeve", SLEEVES.map(s => ({ value: s, label: s })))}</label>
        <label>Neck${select("neck", NECKS.map(s => ({ value: s, label: s })))}</label>
        <label>Fabric<select name="fabric" id="order-fabric" required>${fabricOptions}</select></label>
        <label>Yards needed<input name="yards" type="number" min="0.5" step="0.5" value="${OUTFITS[0].yards}" required></label>
        <label>Tailoring price (${CURRENCY})<input name="ownTailoring" type="number" min="0" step="0.01" placeholder="Price list: ${money(OUTFITS[0].tailoring)}"></label>
        <label>Embroidery price (${CURRENCY})<input name="ownEmbroidery" type="number" min="0" step="0.01" placeholder="Price list: ${money(EMBROIDERY[0].price)}"></label>
        <label>Delivery price (${CURRENCY})<input name="ownDelivery" type="number" min="0" step="0.01" placeholder="Price list: ${money(DELIVERY_FEE)}"></label>
        <label>Due date<input name="dueDate" type="date" value="${addDays(14)}" required></label>
        <label>Deposit paid now (${CURRENCY})<input name="deposit" type="number" min="0.01" step="0.01" placeholder="Blank = ${Math.round(DEPOSIT_RATE * 100)}% of quote"></label>
        <label>Paid by${select("method", PAYMENT_METHODS.map(m => ({ value: m, label: m })))}</label>
        <div class="form-actions"><button type="submit">Create order</button></div>
      </form>
    </div>

    <div class="card">
      <h2>All orders</h2>
      <div class="chips">${filters.map(f => `<button class="chip ${f === orderFilter ? "active" : ""}" onclick="orderFilter='${f}';renderAll()">${f}</button>`).join("")}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Outfit</th><th>Fabric</th><th>Due</th><th>Now</th><th>Total</th><th>Balance</th><th></th></tr></thead>
        <tbody>${rows || "<tr><td colspan='9' class='empty'>No orders here.</td></tr>"}</tbody>
      </table></div>
    </div>
  `;
}

function createWalkInOrder(event) {
  event.preventDefault();
  const form = event.target;
  const fabric = findFabric(form.fabric.value);
  const yards = Number(form.yards.value);

  if (isSoldOut(fabric)) {
    alert(`${fabric.name} is sold out.`);
    return false;
  }
  if (yards > fabric.yards_available) {
    alert(`Only ${fabric.yards_available} yd of ${fabric.name} left in stock.`);
    return false;
  }

  const quote = computeQuote(form.outfit.value, form.embroidery.value, fabric, yards, {
    tailoring: form.ownTailoring.value, embroidery: form.ownEmbroidery.value, delivery: form.ownDelivery.value
  });
  const deposit = form.deposit.value ? Number(form.deposit.value) : depositFor(quote.total);
  if (deposit > quote.total) {
    alert(`The deposit can't be more than the quote of ${money(quote.total)}.`);
    return false;
  }

  const customer = findOrCreateCustomer(form.customer.value.trim(), form.phone.value.trim());
  const profile = latestProfile(customer);
  // Fabric purchased: stock goes down (in live mode the database does this)
  if (!Cloud.live) fabric.yards_available = Math.round((fabric.yards_available - yards) * 10) / 10;

  const button = form.querySelector("button[type=submit]");
  if (button) { button.disabled = true; button.textContent = "Creating…"; }
  // The shop took this deposit itself, so it counts straight away
  Promise.resolve(createPaidOrder({
    customerId: customer.id, outfit: form.outfit.value, colour: form.colour.value, embroidery: form.embroidery.value,
    sleeve: form.sleeve.value, neck: form.neck.value, profileId: profile ? profile.id : null,
    fabric, yards, quote, deposit, method: form.method.value, dueDate: form.dueDate.value, confirmed: true
  }))
    .then(order => {
      pendingFabricId = null;
      saveData();
      toast(`Order ${order.id} created — quote ${money(quote.total)}, deposit ${money(deposit)}.${profile ? "" : " Add measurements for this customer."}`);
      go("biz/orders/" + order.id);
    })
    .catch(error => {
      alert(error.message || "Couldn't create the order.");
      if (button) { button.disabled = false; button.textContent = "Create order"; }
    });
  return false;
}

// The walk-in form shows the price-list prices for the outfit and embroidery chosen
function showListPrices(form) {
  form.ownTailoring.placeholder = "Price list: " + money(findOutfit(form.outfit.value).tailoring);
  form.ownEmbroidery.placeholder = "Price list: " + money(embroideryPrice(form.embroidery.value));
}

function deleteOrder(orderId) {
  if (!confirm(`Delete order ${orderId} and its payments? Its fabric goes back into stock.`)) return;
  const order = findOrder(orderId);
  if (!isPlaced(order) && !confirm(`${orderId} is still a quote request, so no fabric was bought. Delete it and its chat?`)) return;
  if (Cloud.live) {
    // The database puts the fabric back and tidies up the order's records
    Cloud.deleteOrder(order).then(() => { toast(`Order ${orderId} deleted.`); go("biz/orders"); }, error => alert(error.message));
    return;
  }
  const fabric = findFabric(order.fabric_id);
  // Only an accepted order took fabric out of stock
  if (fabric && isPlaced(order)) fabric.yards_available = Math.round((fabric.yards_available + order.fabric_yards) * 100) / 100;
  if (order.inspiration) order.inspiration.photos.forEach(ref => PhotoStore.remove(ref));
  db.messages = (db.messages || []).filter(m => m.order_id !== orderId);
  db.chat_reads = (db.chat_reads || []).filter(r => r.order_id !== orderId);
  db.orders = db.orders.filter(o => o.id !== orderId);
  db.payments = db.payments.filter(p => p.order_id !== orderId);
  db.invoices = db.invoices.filter(i => i.order_id !== orderId);
  db.deliveries = db.deliveries.filter(d => d.order_id !== orderId);
  db.wedding_orders.forEach(w => w.members.forEach(m => { if (m.order_id === orderId) m.order_id = ""; }));
  cancelFabricOrder(orderId); // the fabric seller sees it as cancelled
  saveData();
  go(isPlaced(order) ? "biz/orders" : "biz/quotes");
}

// ---- One order, in full ----

function renderOrderDetail(orderId) {
  const order = findOrder(orderId);
  if (!order) return `${bizHeader("Order not found")}<p><a href="#/biz/orders">← All orders</a></p>`;
  if (!isPlaced(order)) return renderQuoteDetail(orderId); // still a quote request

  const customer = findCustomer(order.customer_id);
  const fabric = findFabric(order.fabric_id);
  const supplier = findSupplier(order.fabric_supplier_id);
  const fabricOrderRow = db.fabric_orders.find(o => o.order_id === order.id);
  const delivery = findDelivery(order.id);
  const balance = balanceOwed(order);
  const index = stageIndex(order);
  const next = STAGES[index + 1];

  // What the "next" button does depends on the step
  let nextAction = "";
  if (depositAwaiting(order) && !depositStarted(order)) {
    nextAction = `<span class="owed">Waiting for the customer to pay the deposit of ${money(order.deposit_amount)}.</span> You can record it below if they paid in the shop.`;
  } else if (depositAwaiting(order)) {
    nextAction = `<span class="owed">Deposit awaiting confirmation.</span> Confirm it under Payments below to start production.`;
  } else if (!next) {
    nextAction = `<span class="paid">✓ Delivered${order.review_rating ? " and reviewed" : " — waiting for the customer's review"}</span>`;
  } else if (next.key === "balance_paid" && balance > 0) {
    nextAction = `<span class="owed">Waiting for the balance of ${money(balance)}.</span> Record it under Payments below.`;
  } else if (next.key === "delivered" && !delivery) {
    nextAction = `<form class="inline-form" onsubmit="return dispatchFromDetail(event, '${order.id}')">
      <select name="courier"><option>DHL</option><option>Royal Mail</option></select>
      <button type="submit">Dispatch order</button></form>`;
  } else if (next.key === "delivered") {
    nextAction = `<button onclick="advanceDeliveryFor('${order.id}')">Parcel: ${escapeHtml(delivery.status)} → ${escapeHtml(DELIVERY_STATUSES[DELIVERY_STATUSES.indexOf(delivery.status) + 1])} ▶</button>`;
  } else {
    nextAction = `<button onclick="advanceFromDetail('${order.id}')">Mark ${escapeHtml(next.label.toLowerCase())} done ▶</button>`;
  }

  const staffSelects = STAFF_ROLES.map(role => `
    <label>${role.label}
      <select onchange="assignStaff('${order.id}', '${role.key}', this.value)">
        <option value="">— unassigned —</option>
        ${bizStaff().filter(s => s.role === role.key).map(s => `<option value="${s.id}" ${order.assigned_staff[role.key] === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </label>`).join("");

  const payments = db.payments.filter(p => p.order_id === order.id).map(p =>
    `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.kind)}</td><td>${escapeHtml(p.method)}</td><td>${money(p.amount)}</td>
      <td>${paymentStatusCell(p)}</td></tr>`).join("");

  return `
    <p><a href="#/biz/orders">← All orders</a></p>
    ${bizHeader(`Order ${order.id} ${stageBadge(order)}`, `${escapeHtml(order.outfit_type)} for <a href="#/biz/customers/${order.customer_id}">${escapeHtml(customer ? customer.name : "Unknown")}</a> · placed ${formatDate(order.created_at)} · due ${formatDate(order.due_date)}`)}
    ${styleBriefCard(order)}

    <div class="two-col">
      <div class="card chat-card">
        <h2>Chat with ${escapeHtml(customer ? customer.name.split(" ")[0] : "the customer")} <small class="muted">questions, fittings, updates</small></h2>
        ${chatPanel(order, "team")}
      </div>
      <div class="stack">
        ${designCard(order, `
          <div class="kv"><span>Fabric</span><b>${escapeHtml(fabric ? fabric.name : "—")}, ${order.fabric_yards} yd</b></div>
          <div class="kv"><span>Supplier</span><b>${escapeHtml(supplier ? supplier.name : "—")}</b></div>
          ${fabricOrderRow ? `<div class="kv"><span>Fabric from seller</span><b>${fabricOrderRow.status === "sent" ? "Sent " + formatDate(fabricOrderRow.sent_at) : fabricOrderRow.status === "new" ? "Not sent yet" : "Cancelled"}</b></div>` : ""}
          ${order.quoted_at ? `<div class="kv"><span>Quote</span><b>Accepted ${formatDate(order.accepted_at)}</b></div>` : ""}`)}
        ${measurementsCard(order)}
        <div class="card">${deliveryBoxHtml(order, "team")}</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>Progress — step ${Math.min(stepsDone(order) + 1, LIFECYCLE.length)} of ${LIFECYCLE.length}</h2>
        ${lifecycleList(order)}
        <div class="job-buttons">
          <button class="small" onclick="backFromDetail('${order.id}')" ${canMoveBack(order) ? "" : "disabled"}>◀ Back a step</button>
          ${nextAction}
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <h2>Payments <span class="total">${balance > 0 ? `Balance ${money(balance)}` : "Paid in full"}</span></h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>${payments || "<tr><td colspan='5' class='empty'>No payments yet — the customer pays the deposit in the app.</td></tr>"}</tbody>
          </table></div>
          ${balance > 0 ? `<form class="inline-form" onsubmit="return payFromDetail(event, '${order.id}')">
            <input name="amount" type="number" min="0.01" max="${balance}" step="0.01" value="${balance}" aria-label="Amount">
            <select name="method">${PAYMENT_METHODS.map(m => `<option>${m}</option>`).join("")}</select>
            <button type="submit">Record payment</button>
          </form>` : ""}
          <p><a href="#/biz/invoices/${order.id}">View invoice →</a>${delivery ? ` · Tracking ${escapeHtml(delivery.courier)} ${escapeHtml(delivery.tracking_number)}` : ""}</p>
          ${order.review_rating ? `<p class="review"><span class="gold">${"★".repeat(order.review_rating)}</span> ${escapeHtml(order.review_text)}</p>` : ""}
        </div>
        <div class="card">
          <h2>Production team</h2>
          <div class="form-grid">${staffSelects}</div>
        </div>
      </div>
    </div>
  `;
}

function advanceFromDetail(orderId) {
  const problem = advanceOrder(findOrder(orderId));
  if (problem) { alert(problem); return; }
  saveData();
  renderAll();
}

function backFromDetail(orderId) {
  moveOrderBack(findOrder(orderId));
  saveData();
  renderAll();
}

function assignStaff(orderId, role, staffId) {
  const order = findOrder(orderId);
  order.assigned_staff[role] = staffId;
  order.updated_at = today();
  saveData();
  toast("Assignment saved.");
  renderAll();
}

function payFromDetail(event, orderId) {
  event.preventDefault();
  const order = findOrder(orderId);
  const amount = Number(event.target.amount.value);
  if (amount > balanceOwed(order)) {
    alert(`That is more than the ${money(balanceOwed(order))} still owed.`);
    return false;
  }
  recordOrderPayment(order, amount, event.target.method.value, today(), true);
  saveData();
  renderAll();
  return false;
}

function dispatchFromDetail(event, orderId) {
  event.preventDefault();
  const delivery = dispatchOrder(findOrder(orderId), event.target.courier.value);
  saveData();
  toast(`Dispatched with ${delivery.courier}: ${delivery.tracking_number}`);
  renderAll();
  return false;
}

function advanceDeliveryFor(orderId) {
  advanceDelivery(findDelivery(orderId));
  saveData();
  renderAll();
}
