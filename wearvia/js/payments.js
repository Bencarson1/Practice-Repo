// ============================================================
// payments.js — record payments and see balances owed
// Deposit (step 7) is taken when an order is placed; the balance
// (step 14) is due after quality control.
// ============================================================

// Status of a payment, with Confirm / Reject buttons while it's waiting
function paymentStatusCell(p) {
  if (p.status === "awaiting_confirmation") {
    return `<span class="badge status-pending">Awaiting confirmation</span>
      <span class="nowrap"><button class="small gold" onclick="confirmPaymentFromList('${p.id}', true)">✓ Confirm</button>
      <button class="small danger" onclick="confirmPaymentFromList('${p.id}', false)">Reject</button></span>`;
  }
  return `<span class="badge ${p.status === "rejected" ? "status-hidden" : "status-approved"}">${PAYMENT_STATUS_LABELS[p.status] || "Confirmed"}</span>`;
}

function confirmPaymentFromList(paymentId, accept) {
  const p = db.payments.find(x => x.id === paymentId);
  if (!p) return;
  if (!accept && !confirm(`Reject this ${money(p.amount)} payment for ${p.order_id}? Only do this if the money never arrived.`)) return;
  confirmPayment(paymentId, accept);
  saveData();
  toast(accept ? `${money(p.amount)} confirmed for ${p.order_id}.` : `Payment rejected for ${p.order_id}.`);
  renderAll();
}

function renderPayments() {
  // Only orders that still have money owed can take a payment
  const orderOptions = placedOrders().filter(o => balanceOwed(o) > 0).map(o =>
    `<option value="${o.id}">${o.id} — ${escapeHtml(customerName(o.customer_id))} (owes ${money(balanceOwed(o))})</option>`).join("");

  let totalOwed = 0;
  const balanceRows = placedOrders().map(order => {
    const paid = amountPaid(order.id);
    const balance = balanceOwed(order);
    if (balance > 0) totalOwed += balance;
    const due = stageIndex(order) >= STAGES.findIndex(s => s.key === "quality_control");
    return `<tr>
      <td><a href="#/orders/${order.id}">${order.id}</a></td>
      <td>${escapeHtml(customerName(order.customer_id))}</td>
      <td>${money(order.quote_total)}</td>
      <td>${money(order.deposit_amount)}</td>
      <td>${money(paid)}</td>
      <td class="${balance > 0 ? "owed" : "paid"}">${balance > 0 ? money(balance) + (due ? " — due now" : " — after QC") : "Paid in full"}</td>
    </tr>`;
  }).join("");

  const waiting = paymentsAwaiting();
  const waitingRows = waiting.map(p => {
    const order = findOrder(p.order_id);
    return `<tr>
      <td>${formatDate(p.date)}</td>
      <td><a href="#/orders/${p.order_id}">${escapeHtml(p.order_id)}</a></td>
      <td>${escapeHtml(order ? customerName(order.customer_id) : "Unknown")}</td>
      <td>${escapeHtml(p.kind)}</td><td>${escapeHtml(p.method)}</td><td>${money(p.amount)}</td>
      <td>${paymentStatusCell(p)}</td>
    </tr>`;
  }).join("");

  const historyRows = bizPayments().slice().reverse().map(p => {
    const order = findOrder(p.order_id);
    return `<tr>
      <td>${formatDate(p.date)}</td>
      <td><a href="#/orders/${p.order_id}">${escapeHtml(p.order_id)}</a></td>
      <td>${escapeHtml(order ? customerName(order.customer_id) : "Unknown")}</td>
      <td>${escapeHtml(p.kind)}</td>
      <td>${escapeHtml(p.method)}</td>
      <td>${money(p.amount)}</td>
      <td>${escapeHtml(PAYMENT_STATUS_LABELS[p.status] || "Confirmed")}</td>
    </tr>`;
  }).join("");

  return `
    ${bizHeader("Payments", `Deposit (${Math.round(DEPOSIT_RATE * 100)}%) when the order is placed; balance after quality control.`)}

    <div class="card ${waiting.length ? "attention" : ""}">
      <h2>Awaiting confirmation <span class="total">${waiting.length}</span></h2>
      <p class="hint">Checkout is a demo, so no money has moved. Confirm a payment once you've actually received it (for example by bank transfer). Production can't start until the deposit is confirmed.</p>
      ${waiting.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Type</th><th>Method</th><th>Amount</th><th></th></tr></thead>
        <tbody>${waitingRows}</tbody></table></div>` : "<p class='empty'>Nothing waiting.</p>"}
    </div>

    <div class="card">
      <h2>Record a payment</h2>
      ${orderOptions === "" ? "<p class='empty'>Every order is paid in full. 🎉</p>" : `
      <form id="payment-form" class="form-grid" onsubmit="return recordPayment(event)">
        <label>Order<select name="order" required>${orderOptions}</select></label>
        <label>Amount (${CURRENCY})<input name="amount" type="number" min="0.01" step="0.01" required></label>
        <label>Method<select name="method">${PAYMENT_METHODS.map(m => `<option>${m}</option>`).join("")}</select></label>
        <label>Date<input name="date" type="date" value="${today()}" required></label>
        <div class="form-actions"><button type="submit">Record payment</button></div>
      </form>`}
    </div>

    <div class="card">
      <h2>Balances <span class="total">Total owed: ${money(totalOwed)}</span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Deposit</th><th>Paid</th><th>Balance</th></tr></thead>
        <tbody>${balanceRows || "<tr><td colspan='6' class='empty'>No orders yet.</td></tr>"}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Payment history</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Type</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${historyRows || "<tr><td colspan='7' class='empty'>No payments yet.</td></tr>"}</tbody>
      </table></div>
    </div>
  `;
}

function recordPayment(event) {
  event.preventDefault();
  const form = event.target;
  const order = findOrder(form.order.value);
  const amount = Number(form.amount.value);
  const balance = balanceOwed(order);

  if (amount > balance) {
    alert(`That is more than the ${money(balance)} still owed on ${order.id}.`);
    return false;
  }
  recordOrderPayment(order, amount, form.method.value, form.date.value, true);
  saveData();
  toast(`${money(amount)} recorded for ${order.id}.`);
  renderAll();
  return false;
}
