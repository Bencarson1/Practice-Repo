// ============================================================
// admin.js — NebedaHub Admin (/admin/): the platform's own screens
//   Overview                 every tailor, seller, customer and order, and
//                            what's waiting for approval
//   Hidden contact details   chat messages the filter changed, with what
//                            was really written (only the admin sees it)
//   Seller applications      new fabric sellers: approve, ask for changes, hide
// The other admin tabs live with the code they share: Tailors and
// Specialities in tailor-admin.js, Fabric sellers in seller-fabrics.js,
// Fabric inventory in fabrics.js. The database decides who is an admin
// (public.is_admin()); everyone else sees "This account isn't an admin".
// ============================================================

let adminListTab = "orders";

function adminTailors() {
  return db.designers.filter(d => !d.from_search || d.is_mine);
}

function renderAdminOverview() {
  const tailors = adminTailors();
  const byStatus = status => tailors.filter(d => d.admin_status === status);
  const waitingTailors = byStatus("pending");
  const waitingSellers = db.suppliers.filter(s => s.admin_status === "pending");
  const waitingFabrics = activeFabrics().filter(f => f.status === "pending");
  const lowStock = activeFabrics().filter(f => f.status === "approved" && f.yards_available < LOW_STOCK_YARDS);
  const placed = db.orders.filter(isPlaced);
  const requests = db.orders.filter(o => !isPlaced(o));
  const value = placed.reduce((total, o) => total + (o.quote_total || 0), 0);
  const hidden = db.messages.filter(m => m.contact_hidden).length;

  const stat = (label, n, sub, href) => `<a class="stat stat-link" href="${href}"><div class="l">${label}</div><div class="n">${n}</div><div class="l">${sub}</div></a>`;
  const lists = {
    orders: { label: `Orders (${db.orders.length})`, html: adminOrdersTable },
    tailors: { label: `Tailors (${tailors.length})`, html: adminTailorsTable },
    sellers: { label: `Fabric sellers (${db.suppliers.length})`, html: adminSellersTable },
    customers: { label: `Customers (${db.customers.length})`, html: adminCustomersTable }
  };
  const list = lists[adminListTab] || lists.orders;

  return `
    ${bizHeader(`${APP_NAME} overview`, `Everyone on ${APP_NAME}, ${formatDate(today())}.`)}
    <div class="statgrid">
      ${stat("Tailors", tailors.length, `${byStatus("approved").length} approved · ${waitingTailors.length} waiting`, "#/tailors")}
      ${stat("Fabric sellers", db.suppliers.length, `${db.suppliers.filter(isSellerLive).length} approved · ${waitingSellers.length} waiting`, "#/applications")}
      ${stat("Customers", db.customers.length, "with an account or added by a tailor", "#/overview")}
      ${stat("Orders", placed.length, `${requests.length} quote request${requests.length === 1 ? "" : "s"} · ${money(value)}`, "#/overview")}
    </div>

    <div class="card">
      <h2>Waiting for approval</h2>
      ${waitingTailors.length || waitingFabrics.length || waitingSellers.length ? `<div class="alerts">
        ${waitingSellers.length ? `<a class="alert" href="#/applications">🏪 ${waitingSellers.length} new fabric seller${waitingSellers.length > 1 ? "s" : ""}: ${waitingSellers.slice(0, 4).map(s => escapeHtml(s.name)).join(", ")}</a>` : ""}
        ${waitingTailors.length ? `<a class="alert" href="#/tailors">🧵 ${waitingTailors.length} new tailor${waitingTailors.length > 1 ? "s" : ""}: ${waitingTailors.slice(0, 4).map(d => escapeHtml(d.business_name)).join(", ")}${waitingTailors.length > 4 ? "…" : ""}</a>` : ""}
        ${waitingFabrics.length ? `<a class="alert" href="#/sellers">🧶 ${waitingFabrics.length} seller fabric${waitingFabrics.length > 1 ? "s" : ""} to check</a>` : ""}
      </div>` : `<p class="empty">Nothing waiting. New tailors, fabric sellers and sellers' fabrics appear here.</p>`}
      ${lowStock.length || hidden ? `<div class="alerts">
        ${lowStock.length ? `<a class="alert soft" href="#/fabrics">⚠ Low stock: ${lowStock.map(f => `${escapeHtml(f.name)} (${f.yards_available} yd)`).join(", ")}</a>` : ""}
        ${hidden ? `<a class="alert soft" href="#/contacts">🔒 ${hidden} chat message${hidden > 1 ? "s" : ""} had contact details hidden</a>` : ""}
      </div>` : ""}
    </div>

    <div class="card">
      <div class="chips">${Object.keys(lists).map(k => `<button class="chip ${lists[k] === list ? "active" : ""}" onclick="adminListTab='${k}';renderAll()">${lists[k].label}</button>`).join("")}</div>
      ${list.html()}
    </div>`;
}

function adminTable(head, rows, empty) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>` : `<p class="empty">${empty}</p>`;
}

function adminOrdersTable() {
  const orders = db.orders.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 50);
  return adminTable(["Order", "Customer", "Tailor", "Placed", "Total", "Where it is"], orders.map(o => `<tr>
    <td>${escapeHtml(o.id)}</td><td>${escapeHtml(customerName(o.customer_id))}</td><td>${escapeHtml(designerName(o.designer_id))}</td>
    <td>${formatDate(String(o.created_at || "").slice(0, 10))}</td><td>${isPlaced(o) || quoteStatus(o) === "quoted" ? money(o.quote_total || 0) : "—"}</td>
    <td>${stageBadge(o)}</td></tr>`), "No orders yet.");
}

function adminTailorsTable() {
  const tailors = adminTailors().slice().sort((a, b) => a.business_name.localeCompare(b.business_name));
  return adminTable(["Tailor", "Where", "Status", "Orders", ""], tailors.map(d => {
    const country = countryByCode(d.country_code);
    return `<tr><td>${escapeHtml(d.business_name)}${d.demo ? ` <span class="pill muted-pill">demo</span>` : ""}</td>
      <td>${country ? country.flag + " " : ""}${escapeHtml(d.city || "—")}</td>
      <td><span class="badge status-${d.admin_status}">${escapeHtml(TAILOR_STATUS_LABELS[d.admin_status] || d.admin_status)}</span></td>
      <td>${db.orders.filter(o => o.designer_id === d.id).length}</td>
      <td><a href="${escapeHtml(appUrl("customer", "tailor/" + d.slug))}" target="_blank" rel="noopener">Page</a></td></tr>`;
  }), "No tailors yet.");
}

function adminSellersTable() {
  const sellers = db.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name));
  return adminTable(["Shop", "Where", "Status", "Fabrics", "Waiting", "Orders"], sellers.map(s => {
    const fabrics = sellerFabrics(s.id);
    return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.location || "—")}</td>
      <td><span class="badge status-${escapeHtml(s.admin_status || "approved")}">${escapeHtml(SELLER_STATUS_LABELS[s.admin_status || "approved"])}</span></td><td>${fabrics.length}</td>
      <td>${fabrics.filter(f => f.status === "pending").length || "—"}</td><td>${sellerOrders(s.id).length}</td></tr>`;
  }), "No fabric sellers yet.");
}

// ---- Seller applications: approve, ask for changes or hide ----

let sellerAppFilter = "pending";

function renderSellerApplications() {
  const groups = { pending: "Waiting", approved: "Approved", declined: "Changes asked", hidden: "Hidden" };
  const all = db.suppliers;
  const status = s => s.admin_status || "approved";
  const shown = all.filter(s => status(s) === sellerAppFilter)
    .sort((a, b) => String(b.submitted_at || b.created_at || "").localeCompare(String(a.submitted_at || a.created_at || "")));
  const rows = shown.map(s => {
    const country = countryByCode(s.country_code);
    const fabrics = sellerFabrics(s.id);
    return `<div class="tailor-admin-row seller-app-row">
      <img class="tailor-logo" src="${escapeHtml(sellerLogoUrl(s))}" alt="">
      <div class="grow">
        <b>${escapeHtml(s.name)}</b> <span class="badge status-${escapeHtml(status(s))}">${escapeHtml(SELLER_STATUS_LABELS[status(s)])}</span>
        <div class="muted small-text">${country ? country.flag + " " + escapeHtml(country.name) : "No country"}${s.city ? " · " + escapeHtml(s.city) : ""} · shown as “${escapeHtml(s.location || "—")}” · ${escapeHtml(s.currency_code || "GBP")}</div>
        <div class="small-text">${escapeHtml(s.contact_name || "No contact name")}${s.phone ? ` · 📞 ${escapeHtml(s.phone)}` : ""}${s.email ? ` · ✉ ${escapeHtml(s.email)}` : ""}</div>
        <div class="small-text">${escapeHtml([s.address_line, s.city, s.postcode].filter(Boolean).join(", ") || "No address")}</div>
        ${s.sells ? `<div class="small-text"><span class="muted">Sells:</span> ${escapeHtml(s.sells)}</div>` : ""}
        ${(s.sample_photos || []).length ? `<div class="application-photos">${s.sample_photos.map((ref, i) => `<img src="${escapeHtml(photoUrl(ref))}" alt="Sample photo ${i + 1}" loading="lazy">`).join("")}</div>` : ""}
        <div class="small-text">${fabrics.length} fabric${fabrics.length === 1 ? "" : "s"} added${s.submitted_at ? ` · applied ${formatDate(String(s.submitted_at).slice(0, 10))}` : ""}
          ${s.seller_terms_accepted_at ? ` · <span class="paid">✓ accepted the seller terms</span>` : s.submitted_at ? ` · <span class="owed">hasn't accepted the seller terms</span>` : ""}</div>
        ${s.admin_note ? `<div class="small-text owed">Your note: ${escapeHtml(s.admin_note)}</div>` : ""}
      </div>
      <div class="nowrap job-buttons">
        ${status(s) !== "approved" ? `<button class="small gold" onclick="setSellerStatus('${s.id}', 'approved')">✓ Approve</button>` : ""}
        ${status(s) === "pending" ? `<button class="small ghost" onclick="setSellerStatus('${s.id}', 'declined')">Ask for changes</button>` : ""}
        ${status(s) !== "hidden" ? `<button class="small danger" onclick="setSellerStatus('${s.id}', 'hidden')">Hide</button>` : ""}
      </div>
    </div>`;
  }).join("");
  return `
    ${bizHeader("Seller applications", `New fabric sellers apply in ${APPS.seller.name}. Their fabrics only reach customers once you approve the shop here (and each fabric in Seller fabrics). Contact details are only shown to you.`)}
    <div class="card">
      <div class="chips">${Object.keys(groups).map(k => `<button class="chip ${k === sellerAppFilter ? "active" : ""}" onclick="sellerAppFilter='${k}';renderAll()">${groups[k]} (${all.filter(s => status(s) === k).length})</button>`).join("")}</div>
      ${rows || `<p class="empty">No ${groups[sellerAppFilter].toLowerCase()} sellers.</p>`}
    </div>`;
}

function setSellerStatus(id, status) {
  const s = findSupplier(id);
  if (status === "approved" && s.submitted_at && !s.seller_terms_accepted_at && !Cloud.live) {
    alert(`${s.name} hasn't accepted the ${APP_NAME} seller terms yet.`);
    return;
  }
  let note = "";
  if (status === "declined" || status === "hidden") {
    note = prompt(status === "declined" ? `What should ${s.name} change? They'll see this note.` : `Why hide ${s.name}? They'll see this note.`, "");
    if (note === null) return;
  }
  const done = () => { toast(`${s.name}: ${SELLER_STATUS_LABELS[status].toLowerCase()}.`); renderAll(); };
  if (Cloud.live) {
    Cloud.reviewSeller(id, status, note).then(done, error => alert(error.message));
    return;
  }
  reviewSellerApplication(id, status, note);
  saveData();
  done();
}

function adminCustomersTable() {
  const customers = db.customers.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return adminTable(["Customer", "Since", "Orders", "Spent"], customers.map(c => `<tr>
    <td>${escapeHtml(c.name)}</td><td>${escapeHtml(String(c.created_at || "").slice(0, 10))}</td>
    <td>${db.orders.filter(o => o.customer_id === c.id).length}</td><td>${money(customerSpend(c.id))}</td></tr>`), "No customers yet.");
}

// ---- Hidden contact details ----

function renderHiddenContacts() {
  const messages = db.messages.filter(m => m.contact_hidden)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const rows = messages.map(m => {
    const order = db.orders.find(o => o.id === m.order_id);
    return `<div class="hidden-contact-row">
      <div class="row-between wrap"><b>${escapeHtml(m.order_id)}</b>
        <span class="muted small-text">${escapeHtml(m.sender_name || (m.sender_kind === "customer" ? "Customer" : "Tailor"))} · ${m.sender_kind === "customer" ? "customer" : "tailor"} · ${escapeHtml(String(m.created_at).slice(0, 16).replace("T", " "))}</span></div>
      ${order ? `<div class="muted small-text">${escapeHtml(customerName(order.customer_id))} ↔ ${escapeHtml(designerName(order.designer_id))}</div>` : ""}
      <div class="small-text"><span class="muted">Shown:</span> ${escapeHtml(m.body)}</div>
      <div class="small-text"><span class="muted">Written:</span> ${m.original_body ? escapeHtml(m.original_body) : `<span class="muted">not available</span>`}</div>
    </div>`;
  }).join("");
  return `
    ${bizHeader("Hidden contact details", `Chat messages where the ${APP_NAME} filter hid a phone number, email, website, social handle or an "outside the app" request. Customers and tailors only see the hidden version; the original is kept for safety and only you can read it.`)}
    <div class="card">${rows || `<p class="empty">No messages have had contact details hidden.</p>`}</div>`;
}
