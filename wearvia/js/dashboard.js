// ============================================================
// dashboard.js — screen 12: revenue, profit, order count,
// pending payments, what's due soon, and the Ask AI helper
// ============================================================

let aiQuestion = "Which orders are late?";

function businessTotals() {
  // Only confirmed money counts
  const orderRevenue = bizPayments().filter(isConfirmed).reduce((total, p) => total + p.amount, 0);
  const shopRevenue = bizRtwSales().filter(isConfirmed).reduce((total, s) => total + s.price, 0);
  // Estimated profit = order value minus fabric and delivery costs, plus ready-to-wear margin
  const orderProfit = placedOrders().reduce((total, o) => total + o.quote_total - o.fabric_cost - deliveryCostOf(o), 0);
  const shopProfit = bizRtwSales().filter(isConfirmed).reduce((total, s) => total + s.price - s.cost, 0);
  const pending = placedOrders().reduce((total, o) => total + Math.max(balanceOwed(o), 0), 0);
  return { revenue: orderRevenue + shopRevenue, profit: orderProfit + shopProfit, pending };
}

function renderDashboard() {
  const totals = businessTotals();
  const open = placedOrders().filter(isOpen);
  const late = open.filter(isLate);
  // The fabric marketplace and new tailors are the admin's to look after
  const lowStock = isAdminUser() ? activeFabrics().filter(f => f.status === "approved" && f.yards_available < LOW_STOCK_YARDS) : [];
  const waitingFabrics = isAdminUser() ? activeFabrics().filter(f => f.status === "pending") : [];
  const waitingTailors = isAdminUser() ? db.designers.filter(d => d.admin_status === "pending") : [];
  const awaitingReview = placedOrders().filter(o => o.stage === "delivered" && !o.review_rating);
  const waitingPayments = paymentsAwaiting();
  const waitingQuotes = quoteRequests().filter(o => quoteStatus(o) === "requested");
  const unreadChats = scopedOrders().filter(o => unreadCount(o.id, "team") > 0);

  const dueSoon = open.slice().sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6);
  const rows = dueSoon.map(o => {
    const staff = staffForCurrentStep(o);
    return `<tr onclick="go('biz/orders/${o.id}')" class="clickable">
      <td>${o.id}</td><td>${escapeHtml(customerName(o.customer_id))}</td><td>${escapeHtml(o.outfit_type)}</td>
      <td class="${isLate(o) ? "owed" : ""}">${formatDate(o.due_date)}${isLate(o) ? " · late" : ""}</td>
      <td>${stageBadge(o)}</td><td>${staff ? escapeHtml(staff.name) : "—"}</td></tr>`;
  }).join("");

  return `
    ${bizHeader(`${escapeHtml(bizDesigner().business_name)} — Business Dashboard`, `Welcome back! Here is how the shop is doing today, ${formatDate(today())}.`)}

    <div class="statgrid">
      <div class="stat"><div class="l">Total Orders</div><div class="n">${placedOrders().length}</div><div class="l">${open.length} in progress</div></div>
      <div class="stat"><div class="l">Revenue</div><div class="n">${money(totals.revenue)}</div><div class="l">payments + ready-to-wear</div></div>
      <div class="stat"><div class="l">Est. Profit</div><div class="n">${money(totals.profit)}</div><div class="l">after fabric &amp; delivery</div></div>
      <div class="stat"><div class="l">Pending Payments</div><div class="n">${money(totals.pending)}</div><div class="l">balances owed</div></div>
    </div>

    ${late.length || lowStock.length || awaitingReview.length || waitingFabrics.length || waitingPayments.length || waitingQuotes.length || unreadChats.length || waitingTailors.length ? `<div class="alerts">
      ${waitingTailors.length ? `<a class="alert" href="#/biz/tailors">🧵 ${waitingTailors.length} new tailor${waitingTailors.length > 1 ? "s" : ""} waiting for your approval</a>` : ""}
      ${waitingQuotes.length ? `<a class="alert" href="#/biz/quotes">📝 ${waitingQuotes.length} customer${waitingQuotes.length > 1 ? "s" : ""} waiting for a quote</a>` : ""}
      ${unreadChats.length ? `<a class="alert" href="#/biz/${isPlaced(unreadChats[0]) ? "orders" : "quotes"}/${unreadChats[0].id}">💬 New messages on ${unreadChats.map(o => o.id).join(", ")}</a>` : ""}
      ${waitingPayments.length ? `<a class="alert" href="#/biz/payments">💷 ${waitingPayments.length} payment${waitingPayments.length > 1 ? "s" : ""} to confirm</a>` : ""}
      ${waitingFabrics.length ? `<a class="alert" href="#/biz/sellers">🧶 ${waitingFabrics.length} seller fabric${waitingFabrics.length > 1 ? "s" : ""} to approve</a>` : ""}
      ${late.length ? `<a class="alert" href="#/biz/orders">⚠ ${late.length} late order${late.length > 1 ? "s" : ""}</a>` : ""}
      ${lowStock.length ? `<a class="alert" href="#/biz/fabrics">⚠ Low stock: ${lowStock.map(f => `${escapeHtml(f.name)} (${f.yards_available} yd)`).join(", ")}</a>` : ""}
      ${awaitingReview.length ? `<span class="alert soft">${awaitingReview.length} delivered order${awaitingReview.length > 1 ? "s" : ""} awaiting a review</span>` : ""}
    </div>` : ""}

    <div class="optbtns quick">
      <a class="optbtn" href="#/biz/quotes">Quote requests</a>
      <a class="optbtn" href="#/biz/orders">All Orders (live)</a>
      <a class="optbtn" href="#/biz/team">Tailor Team</a>
      <a class="optbtn" href="#/biz/profile">My profile</a>
      ${isAdminUser() ? `<a class="optbtn" href="#/biz/fabrics">Inventory</a>
      <a class="optbtn" href="#/biz/sellers">Fabric Sellers</a>
      <a class="optbtn" href="#/biz/tailors">Tailors</a>` : ""}
      <a class="optbtn" href="#/biz/customers">Customers</a>
      <a class="optbtn" href="#/biz/weddings">Wedding Order</a>
      <a class="optbtn" href="#/biz/shop">Ready to Wear</a>
      <a class="optbtn" href="#/biz/invoices">Invoices</a>
      <a class="optbtn" href="#/biz/deliveries">Delivery</a>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>Due soon</h2>
        ${dueSoon.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Order</th><th>Customer</th><th>Outfit</th><th>Due</th><th>Now</th><th>With</th></tr></thead>
          <tbody>${rows}</tbody></table></div>` : "<p class='empty'>Nothing in production right now.</p>"}
      </div>

      <div class="card ai-card">
        <h2>Ask ${APP_NAME} AI</h2>
        <form class="aiask" onsubmit="return askAI(event)">
          <input name="q" value="${escapeHtml(aiQuestion)}" placeholder="Ask about your business…" aria-label="Question">
          <button type="submit">Ask</button>
        </form>
        <div class="bubble-u">${escapeHtml(aiQuestion)}</div>
        <div class="bubble-a">${answerQuestion(aiQuestion)}</div>
        <p class="hint">Answers come from your live shop data. Try: late orders, low stock, who owes money, staff workload, due this week, revenue.</p>
      </div>
    </div>
  `;
}

function askAI(event) {
  event.preventDefault();
  const q = event.target.q.value.trim();
  if (q) aiQuestion = q;
  renderAll();
  return false;
}

// Answers simple questions from the shop's own data
function answerQuestion(question) {
  const q = question.toLowerCase();
  const open = placedOrders().filter(isOpen);
  const list = orders => orders.map(o => `#${o.id} (${escapeHtml(customerName(o.customer_id))}, ${escapeHtml(o.outfit_type)})`).join(", ");
  const daysLate = o => Math.round((new Date(today()) - new Date(o.due_date)) / 86400000);

  if (q.includes("late") || q.includes("overdue")) {
    const late = open.filter(isLate);
    if (!late.length) return "No orders are late. 🎉";
    return `${late.length} late order${late.length > 1 ? "s" : ""}: ${late.map(o => `#${o.id} (${daysLate(o)} day${daysLate(o) === 1 ? "" : "s"}, now ${escapeHtml(currentStepLabel(o).toLowerCase())})`).join(", ")}.`;
  }
  if (q.includes("stock") || q.includes("fabric") || q.includes("inventory") || q.includes("yard")) {
    const low = activeFabrics().filter(f => f.status === "approved" && f.yards_available < LOW_STOCK_YARDS);
    return low.length ? `Running low: ${low.map(f => `${escapeHtml(f.name)} (${f.yards_available} yd)`).join(", ")}. Restock from Fabric Inventory.` : `Every fabric has at least ${LOW_STOCK_YARDS} yd in stock.`;
  }
  if (q.includes("owe") || q.includes("balance") || q.includes("pending") || q.includes("payment") || q.includes("unpaid")) {
    const owing = placedOrders().filter(o => balanceOwed(o) > 0);
    if (!owing.length) return "Every order is paid in full.";
    return `${money(businessTotals().pending)} is owed across ${owing.length} orders: ${owing.map(o => `#${o.id} ${escapeHtml(customerName(o.customer_id))} ${money(balanceOwed(o))}`).join(", ")}.`;
  }
  if (q.includes("staff") || q.includes("tailor") || q.includes("team") || q.includes("busy") || q.includes("workload")) {
    return bizStaff().map(s => {
      const jobs = open.filter(o => { const who = staffForCurrentStep(o); return who && who.id === s.id; });
      return `${escapeHtml(s.name)}: ${jobs.length} job${jobs.length === 1 ? "" : "s"}`;
    }).join(" · ");
  }
  if (q.includes("due") || q.includes("week")) {
    const soon = open.filter(o => o.due_date >= today() && o.due_date <= addDays(7));
    return soon.length ? `Due in the next 7 days: ${list(soon)}.` : "Nothing is due in the next 7 days.";
  }
  if (q.includes("revenue") || q.includes("profit") || q.includes("money") || q.includes("sales")) {
    const t = businessTotals();
    return `Revenue so far ${money(t.revenue)}, estimated profit ${money(t.profit)}, and ${money(t.pending)} still to collect.`;
  }
  if (q.includes("review") || q.includes("rating")) {
    const r = designerRating(bizDesignerId());
    return `${escapeHtml(bizDesigner().business_name)} is rated ${r.rating} from ${r.count} reviews.`;
  }
  return "I can answer questions about late orders, low stock, who owes money, staff workload, what's due this week, revenue and reviews.";
}
