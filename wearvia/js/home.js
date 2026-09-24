// ============================================================
// home.js — the welcome screen with a quick summary
// ============================================================

function renderHome() {
  const openOrders = db.orders.filter(o => o.stage !== "ready");
  const readyOrders = db.orders.filter(o => o.stage === "ready");
  const totalOwed = db.orders.reduce((total, o) => total + Math.max(balanceOwed(o), 0), 0);
  const yardsInStock = db.fabrics.reduce((total, f) => total + f.stock, 0);

  // Orders not yet ready, soonest due date first
  const dueSoon = openOrders
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  let dueSoonRows = "";
  dueSoon.forEach(order => {
    const customer = findCustomer(order.customerId);
    dueSoonRows += `
      <tr>
        <td>${escapeHtml(order.id)}</td>
        <td>${escapeHtml(customer ? customer.name : "Unknown")}</td>
        <td>${escapeHtml(order.item)}</td>
        <td>${escapeHtml(order.dueDate)}</td>
        <td><span class="badge stage-${order.stage}">${capitalize(order.stage)}</span></td>
      </tr>`;
  });

  document.getElementById("home").innerHTML = `
    <div class="welcome">
      <h1>${escapeHtml(SHOP_NAME)}</h1>
      <p>Welcome back! Here is how the shop is doing today.</p>
    </div>

    <div class="stats">
      <div class="stat-card">
        <div class="stat-number">${openOrders.length}</div>
        <div class="stat-label">Orders in production</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${readyOrders.length}</div>
        <div class="stat-label">Ready for pickup</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${money(totalOwed)}</div>
        <div class="stat-label">Balances owed</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${yardsInStock}</div>
        <div class="stat-label">Yards of fabric in stock</div>
      </div>
    </div>

    <div class="card">
      <h2>Due soon</h2>
      ${dueSoon.length === 0 ? "<p class='empty'>Nothing in production right now.</p>" : `
      <table>
        <thead><tr><th>Order</th><th>Customer</th><th>Item</th><th>Due</th><th>Stage</th></tr></thead>
        <tbody>${dueSoonRows}</tbody>
      </table>`}
    </div>
  `;
}
