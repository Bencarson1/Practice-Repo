// ============================================================
// measurements.js — save each customer's body measurements (inches)
// Measurements are versioned by year: saving in 2026 updates the
// "2026" profile and keeps earlier years.
// ============================================================

// The team types measurements in inches or centimetres; they're saved in inches
let bizMeasureUnit = null;
function bizBodyUnit() {
  return bizMeasureUnit || (designerFabricUnit(bizDesigner()) === "m" ? "cm" : "in");
}

function setBizMeasureUnit(unit) {
  const form = document.getElementById("measure-form");
  const typed = {};
  if (form) MEASUREMENT_FIELDS.forEach(f => { typed[f.key] = inchesFrom(form[f.key].value, bizBodyUnit()); });
  const kept = form ? { customer: form.customer.value, notes: form.notes.value } : null;
  bizMeasureUnit = unit;
  renderAll();
  const again = document.getElementById("measure-form");
  if (again) {
    MEASUREMENT_FIELDS.forEach(f => { again[f.key].value = typed[f.key] == null ? "" : bodyValue(typed[f.key], unit); });
    if (kept) { again.customer.value = kept.customer; again.notes.value = kept.notes; }
  }
}

function renderMeasurements() {
  const unit = bizBodyUnit();
  const cm = unit === "cm";
  const inputs = MEASUREMENT_FIELDS.map(field => `
    <label>${field.label} (${cm ? "cm" : "in"})
      <input name="${field.key}" type="number" min="${cm ? 2 : 1}" max="${cm ? 300 : 120}" step="${cm ? 0.5 : 0.25}" ${field.required ? "required" : ""}>
    </label>`).join("");

  // One card per customer that has measurements saved
  const cards = bizCustomers().filter(c => c.measurement_profiles.length).map(customer => {
    const m = latestProfile(customer);
    const years = customer.measurement_profiles.map(p => p.label).sort().join(", ");
    return `
      <div class="measure-card">
        <div class="measure-head">
          <div>
            <h3><a href="#/biz/customers/${customer.id}">${escapeHtml(customer.name)}</a></h3>
            <small>${escapeHtml(customer.phone)} · ${escapeHtml(m.label)} profile · updated ${formatDate(m.updated)} · measures in ${customerBodyUnit(customer) === "cm" ? "cm" : "inches"}</small>
          </div>
          <button class="small" onclick="editMeasurements('${customer.id}')">Edit</button>
        </div>
        <div class="measure-list">${MEASUREMENT_FIELDS.map(f => `<div><span>${f.label}</span><strong>${bodyBoth(m[f.key], customerBodyUnit(customer))}</strong></div>`).join("")}</div>
        ${customerNotes(customer.id) ? `<p class="notes">${escapeHtml(customerNotes(customer.id))}</p>` : ""}
        ${customer.measurement_profiles.length > 1 ? `<p class="muted small-text">Profiles on file: ${escapeHtml(years)}</p>` : ""}
      </div>`;
  }).join("");

  return `
    ${bizHeader("Measurements", `Saved in inches and shown in both inches and centimetres. Saving updates the customer's ${thisYear()} profile; earlier years are kept.`)}

    <div class="card">
      <h2>Save measurements</h2>
      <p class="hint">Type an existing customer's name to update them, or a new name to add a customer.</p>
      <div class="optbtns" role="group" aria-label="Measure in">
        <button type="button" class="optbtn ${cm ? "" : "sel"}" aria-pressed="${!cm}" onclick="setBizMeasureUnit('in')">Inches</button>
        <button type="button" class="optbtn ${cm ? "sel" : ""}" aria-pressed="${cm}" onclick="setBizMeasureUnit('cm')">Centimetres</button></div>
      <form id="measure-form" class="form-grid" data-unit="${unit}" onsubmit="return saveMeasurements(event)">
        <label>Customer name
          <input name="customer" list="measure-customer-list" required>
          <datalist id="measure-customer-list">${bizCustomers().map(c => `<option value="${escapeHtml(c.name)}"></option>`).join("")}</datalist>
        </label>
        <label>Phone${phoneFieldHtml("phone", "", bizDesigner().country_code, 'placeholder="Optional"')}</label>
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
  const customer = findOrCreateCustomer(form.customer.value.trim(), readPhone(form, "phone"));
  const values = {};
  MEASUREMENT_FIELDS.forEach(field => { values[field.key] = inchesFrom(form[field.key].value, form.dataset.unit); });
  saveMeasurementProfile(customer, values);
  if (form.notes.value.trim()) setCustomerNotes(customer.id, form.notes.value.trim());
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
  const code = phoneCountryFor(customer.phone, bizDesigner().country_code);
  if (form.phone_cc) form.phone_cc.value = code;
  form.phone.value = String(customer.phone || "").replace(countryPhoneCode(code), "").trim();
  form.notes.value = customerNotes(customer.id);
  MEASUREMENT_FIELDS.forEach(field => { form[field.key].value = m && m[field.key] != null ? bodyValue(m[field.key], form.dataset.unit) : ""; });
  form.scrollIntoView({ behavior: "smooth" });
}
