// ============================================================
// deliveries.js — screen 20 (business side): dispatch orders and
// move parcels along. "Delivered" completes step 15.
// ============================================================

function renderDeliveries() {
  const ready = placedOrders().filter(o => o.stage === "balance_paid" && !findDelivery(o.id));
  const readyRows = ready.map(o => `<tr>
    <td><a href="#/biz/orders/${o.id}">${o.id}</a></td>
    <td>${escapeHtml(customerName(o.customer_id))}</td>
    <td>${escapeHtml(o.outfit_type)}</td>
    <td><form class="inline-form" onsubmit="return dispatchFromDetail(event, '${o.id}')">
      <select name="courier" aria-label="Courier"><option>DHL</option><option>Royal Mail</option></select>
      <button type="submit" class="small">Dispatch</button></form></td>
  </tr>`).join("");

  const rows = db.deliveries.slice().reverse().map(d => {
    const order = findOrder(d.order_id);
    const next = DELIVERY_STATUSES[DELIVERY_STATUSES.indexOf(d.status) + 1];
    return `<tr>
      <td><a href="#/biz/orders/${d.order_id}">${escapeHtml(d.order_id)}</a></td>
      <td>${escapeHtml(order ? customerName(order.customer_id) : "—")}</td>
      <td>${escapeHtml(d.courier)}</td>
      <td><code>${escapeHtml(d.tracking_number)}</code></td>
      <td><span class="badge ${d.status === "Delivered" ? "stage-complete" : "stage-sewing"}">${escapeHtml(d.status)}</span></td>
      <td>${formatDate(d.eta)}</td>
      <td>${next ? `<button class="small" onclick="advanceDeliveryFor('${d.order_id}')">${escapeHtml(next)} ▶</button>` : "✓"}</td>
    </tr>`;
  }).join("");

  return `
    ${bizHeader("Deliveries", "Orders can be dispatched once the balance is paid. Customers see the tracking number in their order.")}
    <div class="card">
      <h2>Ready to dispatch</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Outfit</th><th>Courier</th></tr></thead>
        <tbody>${readyRows || "<tr><td colspan='4' class='empty'>Nothing waiting to go out.</td></tr>"}</tbody>
      </table></div>
    </div>
    <div class="card">
      <h2>All deliveries</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Courier</th><th>Tracking number</th><th>Status</th><th>ETA</th><th></th></tr></thead>
        <tbody>${rows || "<tr><td colspan='7' class='empty'>No deliveries yet.</td></tr>"}</tbody>
      </table></div>
    </div>
  `;
}
