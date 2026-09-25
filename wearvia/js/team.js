// ============================================================
// team.js — screen 14: the tailor / production team
// Staff are assigned to cutting, sewing, embroidery, finishing and QC
// ============================================================

function renderTeam() {
  const open = placedOrders().filter(isOpen);

  const groups = STAFF_ROLES.map(role => {
    const people = bizStaff().filter(s => s.role === role.key).map(person => {
      const jobs = open.filter(o => { const who = staffForCurrentStep(o); return who && who.id === person.id; });
      const assigned = open.filter(o => o.assigned_staff[role.key] === person.id);
      const others = bizStaff().filter(s => s.role === role.key && s.id !== person.id);
      return `
        <div class="person">
          <div class="row-between">
            <div><b>${escapeHtml(person.name)}</b><div class="muted small-text">${escapeHtml(role.label)}${person.phone ? ` · <a href="tel:${escapeHtml(person.phone.replace(/\s/g, ""))}">📞 ${escapeHtml(person.phone)}</a>` : ""}</div></div>
            <button class="small danger" onclick="removeStaff('${person.id}')" ${assigned.length ? `disabled title="Reassign their ${assigned.length} order(s) first"` : ""}>Remove</button>
          </div>
          ${jobs.length ? `<ul class="jobs">${jobs.map(o => `<li>
            <a href="#/biz/orders/${o.id}">${o.id}</a> ${escapeHtml(o.outfit_type)} — ${escapeHtml(currentStepLabel(o).toLowerCase())} now
            ${hasInspiration(o.inspiration) ? `<a href="#/biz/orders/${o.id}" title="The customer uploaded photos of the style to copy">📷 style photos</a>` : ""}
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
    ${teamLoginsCard()}
  `;
}

// ---- Logins for the business dashboard (live mode) ----
// Tailors above don't need to sign in. These are the people who can open the Business dashboard.

let teamLoginsLoading = false;

function teamLoginsCard() {
  if (!Cloud.live) {
    return `<div class="card"><h2>Team logins</h2><p class="hint">In the live app, the owner adds staff here by email so they can sign in to the Business dashboard. (Not available in the demo.)</p></div>`;
  }
  const list = Cloud.teamLogins;
  if (!list && !teamLoginsLoading) {
    teamLoginsLoading = true;
    Cloud.loadTeamLogins().catch(error => toast(error.message)).finally(() => { teamLoginsLoading = false; renderAll(); });
  }
  const rows = (list || []).map(p => `<tr>
    <td>${escapeHtml(p.name || "—")}</td><td>${escapeHtml(p.email || "—")}</td>
    <td>${p.kind === "owner" ? "Owner" : escapeHtml(p.job_role || "staff")}</td>
    <td>${p.kind === "invite" ? `<span class="badge status-pending">Waiting for them to sign up</span>` : `<span class="badge status-approved">Can sign in</span>`}</td>
    <td>${p.kind !== "owner" && Cloud.isOwner() ? `<button class="small danger" onclick="removeTeamLogin('${p.kind}', '${p.id}')">Remove</button>` : ""}</td>
  </tr>`).join("");
  return `
    <div class="card">
      <h2>Team logins <small class="muted">who can open the Business dashboard</small></h2>
      ${list ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || "<tr><td colspan='5' class='empty'>Only you so far.</td></tr>"}</tbody></table></div>` : `<p class="muted">Loading…</p>`}
      ${Cloud.isOwner() ? `
        <form class="inline-form" onsubmit="return addTeamLogin(event)">
          <input name="email" type="email" required placeholder="Their email address" aria-label="Email">
          <select name="role" aria-label="Job">${["staff", "manager"].concat(STAFF_ROLES.map(r => r.key)).map(r => `<option value="${r}">${escapeHtml(r.replace("_", " "))}</option>`).join("")}</select>
          <button type="submit">Add login</button>
        </form>
        <p class="hint">They then create an account in the app with that email (and confirm it). They'll see the Business dashboard when they sign in.</p>`
        : `<p class="hint">Only the owner can add or remove logins.</p>`}
    </div>`;
}

function addTeamLogin(event) {
  event.preventDefault();
  const form = event.target;
  const email = form.email.value.trim();
  Cloud.addTeamLogin(email, form.role.value)
    .then(result => {
      toast(result === "added" ? `${email} can now open the Business dashboard (after signing in again).` : `${email} added. Ask them to create an account with that email.`);
      renderAll();
    })
    .catch(error => toast(error.message));
  return false;
}

function removeTeamLogin(kind, id) {
  if (!confirm("Remove this login? They won't be able to open the Business dashboard any more.")) return;
  Cloud.removeTeamLogin(kind, id).then(renderAll, error => toast(error.message));
}

function addStaff(event) {
  event.preventDefault();
  const form = event.target;
  db.staff.push({ id: newId("T", db.staff), designer_id: bizDesignerId(), name: form.name.value.trim(), role: form.role.value, phone: form.phone.value.trim() });
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
