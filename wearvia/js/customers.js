// ============================================================
// customers.js — screen 16: customer profiles
// Order history, spend, preferences, notes and measurement profiles
// ============================================================

function renderCustomers(customerId) {
  if (customerId) return renderCustomerDetail(customerId);

  const rows = bizCustomers().map(c => {
    const orders = customerOrders(c.id);
    const last = orders.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return `<tr class="clickable" onclick="go('biz/customers/${c.id}')">
      <td><a href="#/biz/customers/${c.id}">${escapeHtml(c.name)}</a></td>
      <td class="nowrap">${escapeHtml(c.phone)}</td>
      <td>${orders.length}</td>
      <td>${totalsHtml(customerSpend(c.id), bizCurrency())}</td>
      <td>${escapeHtml(favouriteColour(c.id))}</td>
      <td>${last ? `${last.id} · ${escapeHtml(currentStepLabel(last))}` : "—"}</td>
    </tr>`;
  }).join("");

  return `
    ${bizHeader("Customers", "Everyone who has ordered or saved measurements.")}
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Spent</th><th>Favourite colour</th><th>Latest order</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='6' class='empty'>No customers yet.</td></tr>"}</tbody>
    </table></div></div>
  `;
}

function renderCustomerDetail(customerId) {
  const c = findCustomer(customerId);
  if (!c) return `${bizHeader("Customer not found")}<p><a href="#/biz/customers">← Customers</a></p>`;
  const orders = customerOrders(c.id).slice().reverse();
  const profiles = c.measurement_profiles.slice().sort((a, b) => b.label.localeCompare(a.label));
  const unit = customerBodyUnit(c);
  const owes = sumByCurrency(orders, o => Math.max(balanceOwed(o), 0), orderCurrency);
  const country = countryByCode(c.country_code);

  return `
    <p><a href="#/biz/customers">← Customers</a></p>
    ${bizHeader(escapeHtml(c.name), `${escapeHtml(c.phone || "No phone")} · ${escapeHtml(c.email || "No email")} · customer since ${formatDate(c.created_at)}${country ? ` · ${country.flag} ${escapeHtml(country.name)}` : ""}`)}

    <div class="statgrid">
      <div class="stat"><div class="l">Total orders</div><div class="n">${orders.length}</div></div>
      <div class="stat"><div class="l">Total spent</div><div class="n">${totalsHtml(customerSpend(c.id), bizCurrency())}</div></div>
      <div class="stat"><div class="l">Favourite colour</div><div class="n">${escapeHtml(favouriteColour(c.id))}</div></div>
      <div class="stat"><div class="l">Owes</div><div class="n">${totalsHtml(owes, bizCurrency())}</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>Notes &amp; preferences <small class="muted">only your team sees these</small></h2>
        <form onsubmit="return saveCustomerNotes(event, '${c.id}')" class="stack">
          <textarea name="notes" rows="3">${escapeHtml(customerNotes(c.id))}</textarea>
          <div><button type="submit">Save notes</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Measurement profiles <small class="muted">in ${unit === "cm" ? "centimetres" : "inches"}, as the customer measures</small></h2>
        ${profiles.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Year</th>${MEASUREMENT_FIELDS.map(f => `<th>${f.label}</th>`).join("")}</tr></thead>
          <tbody>${profiles.map(p => `<tr><td><b>${escapeHtml(p.label)}</b></td>${MEASUREMENT_FIELDS.map(f => `<td class="nowrap" title="${escapeHtml(bodyBoth(p[f.key], unit))}">${bodyText(p[f.key], unit)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>` : "<p class='empty'>No measurements saved.</p>"}
        <p><button class="small" onclick="openMeasurementsFor('${c.id}')">Edit measurements →</button></p>
      </div>
    </div>

    <div class="card">
      <h2>Order history</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Outfit</th><th>Placed</th><th>Now</th><th>Total</th><th>Balance</th><th>Review</th></tr></thead>
        <tbody>${orders.map(o => `<tr class="clickable" onclick="go('biz/orders/${o.id}')">
          <td><a href="#/biz/orders/${o.id}">${o.id}</a></td><td>${escapeHtml(o.outfit_type)}</td><td>${formatDate(o.created_at)}</td>
          <td>${stageBadge(o)}</td><td>${money(o.quote_total, orderCurrency(o))}</td>
          <td class="${balanceOwed(o) > 0 ? "owed" : "paid"}">${balanceOwed(o) > 0 ? money(balanceOwed(o), orderCurrency(o)) : "Paid"}</td>
          <td>${o.review_rating ? `<span class="gold">${"★".repeat(o.review_rating)}</span>` : "—"}</td></tr>`).join("") || "<tr><td colspan='7' class='empty'>No orders yet.</td></tr>"}</tbody>
      </table></div>
    </div>
  `;
}

function saveCustomerNotes(event, customerId) {
  event.preventDefault();
  setCustomerNotes(customerId, event.target.notes.value.trim());
  saveData();
  toast("Notes saved.");
  renderAll();
  return false;
}

function openMeasurementsFor(customerId) {
  go("biz/measurements");
  setTimeout(() => editMeasurements(customerId), 50);
}
