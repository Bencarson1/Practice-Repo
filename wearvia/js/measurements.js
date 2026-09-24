// ============================================================
// measurements.js — save each customer's body measurements
// ============================================================

// The measurements we record (all in inches)
const MEASUREMENT_FIELDS = [
  { key: "neck", label: "Neck" },
  { key: "chest", label: "Chest / Bust" },
  { key: "waist", label: "Waist" },
  { key: "hips", label: "Hips" },
  { key: "shoulder", label: "Shoulder" },
  { key: "sleeve", label: "Sleeve" },
  { key: "length", label: "Top / Dress length" },
  { key: "inseam", label: "Inseam" }
];

function renderMeasurements() {
  let customerSuggestions = "";
  db.customers.forEach(customer => {
    customerSuggestions += `<option value="${escapeHtml(customer.name)}"></option>`;
  });

  let inputs = "";
  MEASUREMENT_FIELDS.forEach(field => {
    inputs += `
      <label>${field.label} (in)
        <input name="${field.key}" type="number" min="0" step="0.25">
      </label>`;
  });

  // One card per customer that has measurements saved
  let cards = "";
  db.measurements.forEach(m => {
    const customer = findCustomer(m.customerId);
    if (!customer) return;

    let list = "";
    MEASUREMENT_FIELDS.forEach(field => {
      const value = m[field.key];
      list += `<div><span>${field.label}</span><strong>${value ? value + '"' : "—"}</strong></div>`;
    });

    cards += `
      <div class="measure-card">
        <div class="measure-head">
          <div>
            <h3>${escapeHtml(customer.name)}</h3>
            <small>${escapeHtml(customer.phone)} · Updated ${escapeHtml(m.updated)}</small>
          </div>
          <button class="small" onclick="editMeasurements('${customer.id}')">Edit</button>
        </div>
        <div class="measure-list">${list}</div>
        ${m.notes ? `<p class="notes">${escapeHtml(m.notes)}</p>` : ""}
      </div>`;
  });

  document.getElementById("measurements").innerHTML = `
    <h1>Measurements</h1>

    <div class="card">
      <h2>Save measurements</h2>
      <p class="hint">Type an existing customer's name to update them, or a new name to add a customer.</p>
      <form id="measure-form" class="form-grid">
        <label>Customer name
          <input name="customer" list="measure-customer-list" required>
          <datalist id="measure-customer-list">${customerSuggestions}</datalist>
        </label>
        <label>Phone
          <input name="phone" placeholder="Optional">
        </label>
        ${inputs}
        <label class="wide">Notes
          <input name="notes" placeholder="e.g. prefers loose fit">
        </label>
        <div class="form-actions">
          <button type="submit">Save measurements</button>
        </div>
      </form>
    </div>

    <div class="measure-grid">${cards || "<p class='empty'>No measurements saved yet.</p>"}</div>
  `;

  document.getElementById("measure-form").addEventListener("submit", saveMeasurements);
}

function saveMeasurements(event) {
  event.preventDefault();
  const form = event.target;
  const customer = findOrCreateCustomer(form.customer.value.trim(), form.phone.value.trim());

  const record = { customerId: customer.id, notes: form.notes.value.trim(), updated: today() };
  MEASUREMENT_FIELDS.forEach(field => {
    record[field.key] = form[field.key].value ? Number(form[field.key].value) : null;
  });

  // Replace the old record for this customer (if any) with the new one
  db.measurements = db.measurements.filter(m => m.customerId !== customer.id);
  db.measurements.push(record);

  saveData();
  renderAll();
}

// Fill the form with a customer's saved measurements so they can be changed
function editMeasurements(customerId) {
  const customer = findCustomer(customerId);
  const m = db.measurements.find(x => x.customerId === customerId);
  const form = document.getElementById("measure-form");

  form.customer.value = customer.name;
  form.phone.value = customer.phone;
  form.notes.value = m.notes || "";
  MEASUREMENT_FIELDS.forEach(field => {
    form[field.key].value = m[field.key] || "";
  });
  form.scrollIntoView({ behavior: "smooth" });
}
