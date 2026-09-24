// ============================================================
// orders.js — create and track customer orders
// ============================================================

function renderOrders() {
  // Options for the fabric dropdown
  let fabricOptions = "";
  db.fabrics.forEach(fabric => {
    fabricOptions += `<option value="${fabric.id}">${escapeHtml(fabric.name)} — ${money(fabric.price)}/yd (${fabric.stock} yd left)</option>`;
  });

  // Suggestions for the customer name box
  let customerSuggestions = "";
  db.customers.forEach(customer => {
    customerSuggestions += `<option value="${escapeHtml(customer.name)}"></option>`;
  });

  // One table row per order, newest first
  let rows = "";
  db.orders.slice().reverse().forEach(order => {
    const customer = findCustomer(order.customerId);
    const fabric = findFabric(order.fabricId);
    const balance = balanceOwed(order);
    rows += `
      <tr>
        <td>${escapeHtml(order.id)}</td>
        <td>${escapeHtml(customer ? customer.name : "Unknown")}</td>
        <td>${escapeHtml(order.item)}</td>
        <td>${escapeHtml(fabric ? fabric.name : "—")} (${order.yards} yd)</td>
        <td>${escapeHtml(order.dueDate)}</td>
        <td><span class="badge stage-${order.stage}">${capitalize(order.stage)}</span></td>
        <td>${money(order.price)}</td>
        <td class="${balance > 0 ? "owed" : "paid"}">${balance > 0 ? money(balance) : "Paid"}</td>
        <td><button class="small danger" onclick="deleteOrder('${order.id}')">Delete</button></td>
      </tr>`;
  });

  document.getElementById("orders").innerHTML = `
    <h1>Orders</h1>

    <div class="card">
      <h2>New order</h2>
      <form id="order-form" class="form-grid">
        <label>Customer name
          <input name="customer" list="customer-list" required placeholder="Type a name">
          <datalist id="customer-list">${customerSuggestions}</datalist>
        </label>
        <label>Phone (for new customers)
          <input name="phone" placeholder="Optional">
        </label>
        <label>Item
          <input name="item" required placeholder="e.g. Kaftan, suit, gown">
        </label>
        <label>Fabric
          <select name="fabric" id="order-fabric" required>${fabricOptions}</select>
        </label>
        <label>Yards needed
          <input name="yards" type="number" min="0.5" step="0.5" value="3" required>
        </label>
        <label>Price for customer (${CURRENCY})
          <input name="price" type="number" min="0" step="0.01" required>
        </label>
        <label>Due date
          <input name="dueDate" type="date" required>
        </label>
        <div class="form-actions">
          <button type="submit">Create order</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>All orders</h2>
      <table>
        <thead>
          <tr><th>Order</th><th>Customer</th><th>Item</th><th>Fabric</th><th>Due</th><th>Stage</th><th>Price</th><th>Balance</th><th></th></tr>
        </thead>
        <tbody>${rows || "<tr><td colspan='9' class='empty'>No orders yet.</td></tr>"}</tbody>
      </table>
    </div>
  `;

  document.getElementById("order-form").addEventListener("submit", createOrder);
}

function createOrder(event) {
  event.preventDefault(); // stop the page from reloading
  const form = event.target;

  const fabric = findFabric(form.fabric.value);
  const yards = Number(form.yards.value);

  if (yards > fabric.stock) {
    alert(`Only ${fabric.stock} yards of ${fabric.name} left in stock.`);
    return;
  }

  const customer = findOrCreateCustomer(form.customer.value.trim(), form.phone.value.trim());

  // Order numbers continue from the highest existing one, e.g. NT-1006
  const highest = db.orders.reduce((max, o) => Math.max(max, Number(o.id.split("-")[1])), 1000);

  db.orders.push({
    id: "NT-" + (highest + 1),
    customerId: customer.id,
    item: form.item.value.trim(),
    fabricId: fabric.id,
    yards: yards,
    price: Number(form.price.value),
    dueDate: form.dueDate.value,
    stage: "cutting", // every new order starts at the first stage
    created: today()
  });

  fabric.stock -= yards; // take the fabric out of stock

  saveData();
  renderAll();
}

function deleteOrder(orderId) {
  if (!confirm(`Delete order ${orderId} and its payments?`)) {
    return;
  }
  const order = findOrder(orderId);
  const fabric = findFabric(order.fabricId);
  if (fabric) {
    fabric.stock += order.yards; // put the fabric back in stock
  }
  db.orders = db.orders.filter(o => o.id !== orderId);
  db.payments = db.payments.filter(p => p.orderId !== orderId);
  saveData();
  renderAll();
}
