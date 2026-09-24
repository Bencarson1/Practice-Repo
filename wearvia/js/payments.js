// ============================================================
// payments.js — record payments and see balances owed
// ============================================================

const PAYMENT_METHODS = ["Cash", "Bank transfer", "Card", "Mobile money"];

function renderPayments() {
  // Only orders that still have money owed can take a payment
  let orderOptions = "";
  db.orders.forEach(order => {
    const balance = balanceOwed(order);
    if (balance > 0) {
      const customer = findCustomer(order.customerId);
      orderOptions += `<option value="${order.id}">${escapeHtml(order.id)} — ${escapeHtml(customer ? customer.name : "Unknown")} (owes ${money(balance)})</option>`;
    }
  });

  let methodOptions = "";
  PAYMENT_METHODS.forEach(method => {
    methodOptions += `<option>${method}</option>`;
  });

  // Balance table: one row per order
  let balanceRows = "";
  let totalOwed = 0;
  db.orders.forEach(order => {
    const customer = findCustomer(order.customerId);
    const paid = amountPaid(order.id);
    const balance = balanceOwed(order);
    if (balance > 0) totalOwed += balance;
    balanceRows += `
      <tr>
        <td>${escapeHtml(order.id)}</td>
        <td>${escapeHtml(customer ? customer.name : "Unknown")}</td>
        <td>${money(order.price)}</td>
        <td>${money(paid)}</td>
        <td class="${balance > 0 ? "owed" : "paid"}">${balance > 0 ? money(balance) : "Paid in full"}</td>
      </tr>`;
  });

  // Payment history, newest first
  let historyRows = "";
  db.payments.slice().reverse().forEach(payment => {
    const order = findOrder(payment.orderId);
    const customer = order ? findCustomer(order.customerId) : null;
    historyRows += `
      <tr>
        <td>${escapeHtml(payment.date)}</td>
        <td>${escapeHtml(payment.orderId)}</td>
        <td>${escapeHtml(customer ? customer.name : "Unknown")}</td>
        <td>${escapeHtml(payment.method)}</td>
        <td>${money(payment.amount)}</td>
      </tr>`;
  });

  document.getElementById("payments").innerHTML = `
    <h1>Payments</h1>

    <div class="card">
      <h2>Record a payment</h2>
      ${orderOptions === "" ? "<p class='empty'>Every order is paid in full. 🎉</p>" : `
      <form id="payment-form" class="form-grid">
        <label>Order
          <select name="order" required>${orderOptions}</select>
        </label>
        <label>Amount (${CURRENCY})
          <input name="amount" type="number" min="0.01" step="0.01" required>
        </label>
        <label>Method
          <select name="method">${methodOptions}</select>
        </label>
        <label>Date
          <input name="date" type="date" value="${today()}" required>
        </label>
        <div class="form-actions">
          <button type="submit">Record payment</button>
        </div>
      </form>`}
    </div>

    <div class="card">
      <h2>Balances <span class="total">Total owed: ${money(totalOwed)}</span></h2>
      <table>
        <thead><tr><th>Order</th><th>Customer</th><th>Price</th><th>Paid</th><th>Balance</th></tr></thead>
        <tbody>${balanceRows || "<tr><td colspan='5' class='empty'>No orders yet.</td></tr>"}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Payment history</h2>
      <table>
        <thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Method</th><th>Amount</th></tr></thead>
        <tbody>${historyRows || "<tr><td colspan='5' class='empty'>No payments yet.</td></tr>"}</tbody>
      </table>
    </div>
  `;

  const form = document.getElementById("payment-form");
  if (form) {
    form.addEventListener("submit", recordPayment);
  }
}

function recordPayment(event) {
  event.preventDefault();
  const form = event.target;
  const order = findOrder(form.order.value);
  const amount = Number(form.amount.value);
  const balance = balanceOwed(order);

  if (amount > balance) {
    alert(`That is more than the ${money(balance)} still owed on ${order.id}.`);
    return;
  }

  // Payment ids continue from the highest existing one, e.g. P5
  const highest = db.payments.reduce((max, p) => Math.max(max, Number(p.id.slice(1))), 0);

  db.payments.push({
    id: "P" + (highest + 1),
    orderId: order.id,
    amount: amount,
    method: form.method.value,
    date: form.date.value
  });

  saveData();
  renderAll();
}
