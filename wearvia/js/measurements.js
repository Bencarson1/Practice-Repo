// ============================================================
// measurements.js — save each customer's body measurements (inches)
// Measurements are versioned by year: saving in 2026 updates the
// "2026" profile and keeps earlier years.
// ============================================================

function renderMeasurements() {
  const inputs = MEASUREMENT_FIELDS.map(field => `
    <label>${field.label} (in)
      <input name="${field.key}" type="number" min="1" max="120" step="0.25" ${field.required ? "required" : ""}>
    </label>`).join("");

  // One card per customer that has measurements saved
  const cards = db.customers.filter(c => c.measurement_profiles.length).map(customer => {
    const m = latestProfile(customer);
    const years = customer.measurement_profiles.map(p => p.label).sort().join(", ");
    return `
      <div class="measure-card">
        <div class="measure-head">
          <div>
            <h3><a href="#/biz/customers/${customer.id}">${escapeHtml(customer.name)}</a></h3>
            <small>${escapeHtml(customer.phone)} · ${escapeHtml(m.label)} profile · updated ${formatDate(m.updated)}</small>
          </div>
          <button class="small" onclick="editMeasurements('${customer.id}')">Edit</button>
        </div>
        <div class="measure-list">${MEASUREMENT_FIELDS.map(f => `<div><span>${f.label}</span><strong>${m[f.key] != null ? m[f.key] + '"' : "—"}</strong></div>`).join("")}</div>
        ${customer.notes ? `<p class="notes">${escapeHtml(customer.notes)}</p>` : ""}
        ${customer.measurement_profiles.length > 1 ? `<p class="muted small-text">Profiles on file: ${escapeHtml(years)}</p>` : ""}
      </div>`;
  }).join("");

  return `
    ${bizHeader("Measurements", `All in inches. Saving updates the customer's ${thisYear()} profile; earlier years are kept.`)}

    <div class="card">
      <h2>Save measurements</h2>
      <p class="hint">Type an existing customer's name to update them, or a new name to add a customer.</p>
      <form id="measure-form" class="form-grid" onsubmit="return saveMeasurements(event)">
        <label>Customer name
          <input name="customer" list="measure-customer-list" required>
          <datalist id="measure-customer-list">${db.customers.map(c => `<option value="${escapeHtml(c.name)}"></option>`).join("")}</datalist>
        </label>
        <label>Phone<input name="phone" placeholder="Optional"></label>
        ${inputs}
        <label class="wide">Notes<input name="notes" placeholder="e.g. prefers loose fit"></label>
        <div class="form-actions"><button type="submit">Save measurements</button></div>
      </form>
    </div>

    <div class="measure-grid">${cards || "<p class='empty'>No measurements saved yet.</p>"}</div>
  `;
}

function saveMeasurements(event) {
  event.preventDefault();
  const form = event.target;
  const customer = findOrCreateCustomer(form.customer.value.trim(), form.phone.value.trim());
  const values = {};
  MEASUREMENT_FIELDS.forEach(field => { values[field.key] = form[field.key].value; });
  saveMeasurementProfile(customer, values);
  if (form.notes.value.trim()) customer.notes = form.notes.value.trim();
  saveData();
  toast(`Saved ${customer.name}'s ${thisYear()} measurements.`);
  renderAll();
  return false;
}

// Fill the form with a customer's latest measurements so they can be changed
function editMeasurements(customerId) {
  const customer = findCustomer(customerId);
  const m = latestProfile(customer);
  const form = document.getElementById("measure-form");
  if (!form) return;
  form.customer.value = customer.name;
  form.phone.value = customer.phone;
  form.notes.value = customer.notes || "";
  MEASUREMENT_FIELDS.forEach(field => { form[field.key].value = m && m[field.key] != null ? m[field.key] : ""; });
  form.scrollIntoView({ behavior: "smooth" });
}
