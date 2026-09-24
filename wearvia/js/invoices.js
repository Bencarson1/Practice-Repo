// ============================================================
// invoices.js — screen 19 (business side): invoices are made
// automatically from each order when the deposit is paid
// ============================================================

function renderInvoices(orderId) {
  if (orderId) {
    const order = findOrder(orderId);
    if (!order) return `${bizHeader("Invoice not found")}<p><a href="#/biz/invoices">← Invoices</a></p>`;
    return `
      <p class="no-print"><a href="#/biz/invoices">← Invoices</a> · <a href="#/biz/orders/${order.id}">Order ${order.id}</a></p>
      <div class="card invoice-card">
        ${invoiceBody(order)}
        <div class="job-buttons no-print">
          <button onclick="window.print()">Download PDF</button>
          <button onclick="shareInvoice('${order.id}')">Share</button>
        </div>
      </div>`;
  }

  const rows = db.invoices.slice().reverse().map(inv => {
    const order = findOrder(inv.order_id);
    if (!order) return "";
    const balance = balanceOwed(order);
    return `<tr class="clickable" onclick="go('biz/invoices/${order.id}')">
      <td><a href="#/biz/invoices/${order.id}">${escapeHtml(inv.id)}</a></td>
      <td>${formatDate(inv.created_at)}</td>
      <td>${order.id}</td>
      <td>${escapeHtml(customerName(order.customer_id))}</td>
      <td>${money(inv.total)}</td>
      <td class="${balance > 0 ? "owed" : "paid"}">${balance > 0 ? money(balance) : "Paid"}</td>
    </tr>`;
  }).join("");

  return `
    ${bizHeader("Invoices", "Created automatically from each order. Open one to download or share it.")}
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Invoice</th><th>Date</th><th>Order</th><th>Customer</th><th>Total</th><th>Balance</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='6' class='empty'>No invoices yet.</td></tr>"}</tbody>
    </table></div></div>
  `;
}
