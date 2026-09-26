// ============================================================
// production.js — a board showing each order's latest completed step
// Tailor assigned → cut → sewn → embroidered → fitted → QC passed →
// balance paid → delivered
// ============================================================

function renderProduction() {
  const columns = STAGES.map((stage, index) => {
    const orders = placedOrders().filter(o => o.stage === stage.key);
    const next = STAGES[index + 1];

    const cards = orders.map(order => {
      const staff = staffForCurrentStep(order);
      let nextButton;
      if (!next) {
        nextButton = `<span class="muted small-text">${order.review_rating ? "★".repeat(order.review_rating) : "Awaiting review"}</span>`;
      } else if (next.key === "delivered") {
        nextButton = `<a class="button small" href="#/orders/${order.id}">${findDelivery(order.id) ? "Delivery ▶" : "Dispatch ▶"}</a>`;
      } else if (depositAwaiting(order)) {
        nextButton = `<a class="button small" href="#/payments" title="Confirm the deposit to start production">Awaiting deposit</a>`;
      } else {
        const blocked = next.key === "balance_paid" && balanceOwed(order) > 0;
        nextButton = `<button class="small" onclick="moveStage('${order.id}', 1)" ${blocked ? `disabled title="Balance of ${money(balanceOwed(order), orderCurrency(order))} owed"` : ""}>${blocked ? "Awaiting balance" : "Next ▶"}</button>`;
      }
      return `
        <div class="job-card ${isLate(order) ? "late" : ""}">
          <a href="#/orders/${order.id}"><strong>${order.id}</strong></a>
          <div>${escapeHtml(order.outfit_type)} · ${escapeHtml(colourName(order.colour))}</div>
          <small>${escapeHtml(customerName(order.customer_id))} · due ${formatDate(order.due_date)}${isLate(order) ? " · late" : ""}</small>
          ${styleJobStrip(order)}
          ${next && next.role ? `<small>Next: ${escapeHtml(next.label)}${staff ? " · " + escapeHtml(staff.name) : ""}</small>` : ""}
          <div class="job-buttons">
            <button class="small" onclick="moveStage('${order.id}', -1)" ${canMoveBack(order) ? "" : "disabled"}>◀ Back</button>
            ${nextButton}
          </div>
        </div>`;
    }).join("");

    return `
      <div class="stage-column">
        <h2><span class="badge stage-${stage.key}">${stage.done}</span> <small>${orders.length}</small></h2>
        ${next ? `<p class="muted small-text">Next: ${escapeHtml(next.label)}</p>` : `<p class="muted small-text">Then: review</p>`}
        ${cards || "<p class='empty'>No orders</p>"}
      </div>`;
  }).join("");

  return `
    ${bizHeader("Production Tracking", "Each column is the last step an order has completed. Orders can't pass quality control until the balance is paid, and are delivered once the courier confirms.")}
    <div class="board">${columns}</div>
  `;
}

// direction is +1 (next step) or -1 (previous step)
function moveStage(orderId, direction) {
  const order = findOrder(orderId);
  if (direction > 0) {
    const problem = advanceOrder(order);
    if (problem) { alert(problem); return; }
  } else {
    moveOrderBack(order);
  }
  saveData();
  renderAll();
}
