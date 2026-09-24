// ============================================================
// team.js — screen 14: the tailor / production team
// Staff are assigned to cutting, sewing, embroidery, finishing and QC
// ============================================================

function renderTeam() {
  const open = db.orders.filter(isOpen);

  const groups = STAFF_ROLES.map(role => {
    const people = db.staff.filter(s => s.role === role.key).map(person => {
      const jobs = open.filter(o => { const who = staffForCurrentStep(o); return who && who.id === person.id; });
      const assigned = open.filter(o => o.assigned_staff[role.key] === person.id);
      const others = db.staff.filter(s => s.role === role.key && s.id !== person.id);
      return `
        <div class="person">
          <div class="row-between">
            <div><b>${escapeHtml(person.name)}</b><div class="muted small-text">${escapeHtml(role.label)} · <a href="tel:${escapeHtml(person.phone.replace(/\s/g, ""))}">📞 ${escapeHtml(person.phone)}</a></div></div>
            <button class="small danger" onclick="removeStaff('${person.id}')" ${assigned.length ? `disabled title="Reassign their ${assigned.length} order(s) first"` : ""}>Remove</button>
          </div>
          ${jobs.length ? `<ul class="jobs">${jobs.map(o => `<li>
            <a href="#/biz/orders/${o.id}">${o.id}</a> ${escapeHtml(o.outfit_type)} — ${escapeHtml(currentStepLabel(o).toLowerCase())} now
            ${others.length ? `<select class="small" onchange="reassign('${o.id}', '${role.key}', this.value)" aria-label="Reassign ${o.id}">
              <option value="">Reassign…</option>${others.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select>` : ""}
          </li>`).join("")}</ul>` : `<p class="muted small-text">No jobs waiting right now · ${assigned.length} order(s) assigned for later</p>`}
        </div>`;
    }).join("");
    return `<div class="card"><h2>${role.label}</h2>${people || "<p class='empty'>Nobody in this role yet.</p>"}</div>`;
  }).join("");

  return `
    ${bizHeader("Production Team", "Who is working on what right now. New orders are given to the least busy person in each role.")}
    <div class="team-grid">${groups}</div>
    <div class="card">
      <h2>Add a team member</h2>
      <form class="form-grid" onsubmit="return addStaff(event)">
        <label>Name<input name="name" required></label>
        <label>Role<select name="role">${STAFF_ROLES.map(r => `<option value="${r.key}">${r.label}</option>`).join("")}</select></label>
        <label>Phone<input name="phone" type="tel"></label>
        <div class="form-actions"><button type="submit">Add</button></div>
      </form>
    </div>
  `;
}

function addStaff(event) {
  event.preventDefault();
  const form = event.target;
  const highest = db.staff.reduce((max, s) => Math.max(max, Number(s.id.slice(1))), 0);
  db.staff.push({ id: "T" + (highest + 1), name: form.name.value.trim(), role: form.role.value, phone: form.phone.value.trim() });
  saveData();
  renderAll();
  return false;
}

function removeStaff(staffId) {
  const person = findStaff(staffId);
  if (!confirm(`Remove ${person.name} from the team?`)) return;
  db.staff = db.staff.filter(s => s.id !== staffId);
  db.orders.forEach(o => STAFF_ROLES.forEach(r => { if (o.assigned_staff[r.key] === staffId) o.assigned_staff[r.key] = ""; }));
  saveData();
  renderAll();
}

function reassign(orderId, role, staffId) {
  if (!staffId) return;
  findOrder(orderId).assigned_staff[role] = staffId;
  saveData();
  toast(`${orderId} reassigned to ${findStaff(staffId).name}.`);
  renderAll();
}
