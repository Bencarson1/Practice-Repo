// ============================================================
// weddings.js — screen 17: wedding / group orders
// One event with many participants, each with their own outfit and status
// ============================================================

const MEMBER_STATUSES = ["Not started", "In progress", "Done"];

function memberStatus(member) {
  const order = member.order_id ? findOrder(member.order_id) : null;
  if (order) return currentStepLabel(order) === "Complete" ? "Done" : `${order.id} · ${currentStepLabel(order)}`;
  return member.status || "Not started";
}

function renderWeddings() {
  const events = db.wedding_orders.map(w => {
    const totalOutfits = w.members.reduce((t, m) => t + Number(m.outfits || 0), 0);
    const rows = w.members.map(m => {
      const order = m.order_id ? findOrder(m.order_id) : null;
      return `<tr>
        <td><b>${escapeHtml(m.role)}</b>${m.name ? `<div class="muted small-text">${escapeHtml(m.name)}</div>` : ""}</td>
        <td>${m.outfits} outfit${m.outfits == 1 ? "" : "s"}</td>
        <td>${order ? `<a href="#/biz/orders/${order.id}">${escapeHtml(memberStatus(m))}</a>` : `
          <select onchange="setMemberStatus('${w.id}', '${m.id}', this.value)" aria-label="Status">
            ${MEMBER_STATUSES.map(s => `<option ${s === m.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>`}</td>
        <td>
          <select onchange="linkMemberOrder('${w.id}', '${m.id}', this.value)" aria-label="Linked order">
            <option value="">No linked order</option>
            ${placedOrders().map(o => `<option value="${o.id}" ${o.id === m.order_id ? "selected" : ""}>${o.id} · ${escapeHtml(customerName(o.customer_id))}</option>`).join("")}
          </select>
        </td>
        <td><button class="small danger" onclick="removeMember('${w.id}', '${m.id}')">Remove</button></td>
      </tr>`;
    }).join("");

    return `
      <div class="card">
        <h2>${escapeHtml(w.event_name)} — ${formatDate(w.event_date)} <span class="total">${w.members.length} groups · ${totalOutfits} outfits</span></h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Member</th><th>Outfits</th><th>Status</th><th>Order</th><th></th></tr></thead>
          <tbody>${rows || "<tr><td colspan='5' class='empty'>No members yet.</td></tr>"}</tbody>
        </table></div>
        <form class="inline-form" onsubmit="return addMember(event, '${w.id}')">
          <input name="role" placeholder="Role, e.g. Groomsmen (6)" required aria-label="Role">
          <input name="name" placeholder="Name (optional)" aria-label="Name">
          <input name="outfits" type="number" min="1" value="1" aria-label="Outfits" class="narrow">
          <button type="submit">+ Add Member</button>
        </form>
      </div>`;
  }).join("");

  return `
    ${bizHeader("Wedding & Group Orders", "One event, many people — each with their own measurements, outfit and status.")}
    ${events || "<p class='empty'>No group orders yet.</p>"}
    <div class="card">
      <h2>New group order</h2>
      <form class="form-grid" onsubmit="return addWedding(event)">
        <label>Event name<input name="name" required placeholder="e.g. Okafor Wedding"></label>
        <label>Event date<input name="date" type="date" required></label>
        <div class="form-actions"><button type="submit">Create</button></div>
      </form>
    </div>
  `;
}

function findWedding(id) {
  return db.wedding_orders.find(w => w.id === id);
}

function addWedding(event) {
  event.preventDefault();
  db.wedding_orders.push({ id: newId("W", db.wedding_orders), designer_id: designer().id, event_name: event.target.name.value.trim(), event_date: event.target.date.value, members: [] });
  saveData();
  renderAll();
  return false;
}

function addMember(event, weddingId) {
  event.preventDefault();
  const form = event.target;
  findWedding(weddingId).members.push({
    id: newId("WM", db.wedding_orders.flatMap(w => w.members)), role: form.role.value.trim(), name: form.name.value.trim(),
    outfits: Number(form.outfits.value) || 1, order_id: "", status: "Not started"
  });
  saveData();
  renderAll();
  return false;
}

function setMemberStatus(weddingId, memberId, status) {
  findWedding(weddingId).members.find(m => m.id === memberId).status = status;
  saveData();
  renderAll();
}

function linkMemberOrder(weddingId, memberId, orderId) {
  findWedding(weddingId).members.find(m => m.id === memberId).order_id = orderId;
  saveData();
  renderAll();
}

function removeMember(weddingId, memberId) {
  const wedding = findWedding(weddingId);
  wedding.members = wedding.members.filter(m => m.id !== memberId);
  saveData();
  renderAll();
}
