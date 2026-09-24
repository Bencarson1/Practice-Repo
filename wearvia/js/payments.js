// ============================================================
// payments.js — record payments and see balances owed
// Deposit (step 7) is taken when an order is placed; the balance
// (step 14) is due after quality control.
// ============================================================

function renderPayments() {
  // Only orders that still have money owed can take a payment
  const orderOptions = db.orders.filter(o => balanceOwed(o) > 0).map(o =>
    `<option value="${o.id}">${o.id} — ${escapeHtml(customerName(o.customer_id))} (owes ${money(balanceOwed(o))})</option>`).join("");

  let totalOwed = 0;
  const balanceRows = db.orders.map(order => {
    const paid = amountPaid(order.id);
    const balance = balanceOwed(order);
    if (balance > 0) totalOwed += balance;
    const due = stageIndex(order) >= STAGES.findIndex(s => s.key === "quality_control");
    return `<tr>
      <td><a href="#/biz/orders/${order.id}">${order.id}</a></td>
      <td>${escapeHtml(customerName(order.customer_id))}</td>
      <td>${money(order.quote_total)}</td>
      <td>${money(order.deposit_amount)}</td>
      <td>${money(paid)}</td>
      <td class="${balance > 0 ? "owed" : "paid"}">${balance > 0 ? money(balance) + (due ? " — due now" : " — after QC") : "Paid in full"}</td>
    </tr>`;
  }).join("");

  const historyRows = db.payments.slice().reverse().map(p => {
    const order = findOrder(p.order_id);
    return `<tr>
      <td>${formatDate(p.date)}</td>
      <td><a href="#/biz/orders/${p.order_id}">${escapeHtml(p.order_id)}</a></td>
      <td>${escapeHtml(order ? customerName(order.customer_id) : "Unknown")}</td>
      <td>${escapeHtml(p.kind)}</td>
      <td>${escapeHtml(p.method)}</td>
      <td>${money(p.amount)}</td>
    </tr>`;
  }).join("");

  return `
    ${bizHeader("Payments", `Deposit (${Math.round(DEPOSIT_RATE * 100)}%) when the order is placed; balance after quality control.`)}

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
        <thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Type</th><th>Method</th><th>Amount</th></tr></thead>
        <tbody>${historyRows || "<tr><td colspan='6' class='empty'>No payments yet.</td></tr>"}</tbody>
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
  recordOrderPayment(order, amount, form.method.value, form.date.value);
  saveData();
  toast(`${money(amount)} recorded for ${order.id}.`);
  renderAll();
  return false;
}
