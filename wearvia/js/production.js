// ============================================================
// production.js — show each order's stage and move it along
// Stages: cutting → sewing → finishing → ready
// ============================================================

function renderProduction() {
  let columns = "";

  STAGES.forEach((stage, index) => {
    const ordersInStage = db.orders.filter(o => o.stage === stage);

    let cards = "";
    ordersInStage.forEach(order => {
      const customer = findCustomer(order.customerId);
      const isFirst = index === 0;
      const isLast = index === STAGES.length - 1;
      cards += `
        <div class="job-card">
          <strong>${escapeHtml(order.id)}</strong>
          <div>${escapeHtml(order.item)}</div>
          <small>${escapeHtml(customer ? customer.name : "Unknown")} · due ${escapeHtml(order.dueDate)}</small>
          <div class="job-buttons">
            <button class="small" onclick="moveStage('${order.id}', -1)" ${isFirst ? "disabled" : ""}>◀ Back</button>
            <button class="small" onclick="moveStage('${order.id}', 1)" ${isLast ? "disabled" : ""}>Next ▶</button>
          </div>
        </div>`;
    });

    columns += `
      <div class="stage-column">
        <h2><span class="badge stage-${stage}">${capitalize(stage)}</span> <small>${ordersInStage.length}</small></h2>
        ${cards || "<p class='empty'>No orders</p>"}
      </div>`;
  });

  document.getElementById("production").innerHTML = `
    <h1>Production Tracking</h1>
    <div class="board">${columns}</div>
  `;
}

// direction is +1 (next stage) or -1 (previous stage)
function moveStage(orderId, direction) {
  const order = findOrder(orderId);
  const newIndex = STAGES.indexOf(order.stage) + direction;
  if (newIndex >= 0 && newIndex < STAGES.length) {
    order.stage = STAGES[newIndex];
    saveData();
    renderAll();
  }
}
