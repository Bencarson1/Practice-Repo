// ============================================================
// dashboard.js — screen 12: revenue, profit, order count,
// pending payments, what's due soon, and the Ask AI helper
// ============================================================

let aiQuestion = "Which orders are late?";

// Totals are kept per currency and never added across currencies: a tailor who
// changed currency, or sells ready-to-wear in another, sees "£1,250 · ₦250,000"
function businessTotals() {
  const revenue = moneyTotals(), profit = moneyTotals(), pending = moneyTotals();
  // Only confirmed money counts
  bizPayments().filter(isConfirmed).forEach(p => addMoney(revenue, paymentCurrency(p), p.amount));
  bizRtwSales().filter(isConfirmed).forEach(s => addMoney(revenue, rtwSaleCurrency(s), s.price));
  // Estimated profit = order value minus fabric and delivery costs, plus ready-to-wear margin
  placedOrders().forEach(o => addMoney(profit, orderCurrency(o), o.quote_total - o.fabric_cost - deliveryCostOf(o)));
  bizRtwSales().filter(isConfirmed).forEach(s => addMoney(profit, rtwSaleCurrency(s), s.price - s.cost));
  placedOrders().forEach(o => addMoney(pending, orderCurrency(o), Math.max(balanceOwed(o), 0)));
  return { revenue, profit, pending };
}

// A payment is in its order's currency
function paymentCurrency(payment) {
  if (payment.currency_code) return payment.currency_code;
  return orderCurrency(db.orders.find(o => o.id === payment.order_id));
}

function renderDashboard() {
  const totals = businessTotals();
  const open = placedOrders().filter(isOpen);
  const late = open.filter(isLate);
  const awaitingReview = placedOrders().filter(o => o.stage === "delivered" && !o.review_rating);
  const waitingPayments = paymentsAwaiting();
  const waitingQuotes = quoteRequests().filter(o => quoteStatus(o) === "requested");
  const unreadChats = scopedOrders().filter(o => unreadCount(o.id, "team") > 0);

  const dueSoon = open.slice().sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6);
  const rows = dueSoon.map(o => {
    const staff = staffForCurrentStep(o);
    return `<tr onclick="go('orders/${o.id}')" class="clickable">
      <td>${o.id}</td><td>${escapeHtml(customerName(o.customer_id))}</td><td>${escapeHtml(o.outfit_type)}</td>
      <td class="${isLate(o) ? "owed" : ""}">${formatDate(o.due_date)}${isLate(o) ? " · late" : ""}</td>
      <td>${stageBadge(o)}</td><td>${staff ? escapeHtml(staff.name) : "—"}</td></tr>`;
  }).join("");

  return `
    ${bizHeader(`${escapeHtml(bizDesigner().business_name)} — Business Dashboard`, `Welcome back! Here is how the shop is doing today, ${formatDate(today())}.`)}

    <div class="statgrid">
      <div class="stat"><div class="l">Total Orders</div><div class="n">${placedOrders().length}</div><div class="l">${open.length} in progress</div></div>
      <div class="stat"><div class="l">Revenue</div><div class="n">${totalsHtml(totals.revenue, bizCurrency())}</div><div class="l">payments + ready-to-wear</div></div>
      <div class="stat"><div class="l">Est. Profit</div><div class="n">${totalsHtml(totals.profit, bizCurrency())}</div><div class="l">after fabric &amp; delivery</div></div>
      <div class="stat"><div class="l">Pending Payments</div><div class="n">${totalsHtml(totals.pending, bizCurrency())}</div><div class="l">balances owed</div></div>
    </div>
    ${[totals.revenue, totals.profit, totals.pending].some(t => t.size > 1) ? `<p class="hint">Totals in different currencies are shown side by side, never added together.</p>` : ""}

    ${late.length || awaitingReview.length || waitingPayments.length || waitingQuotes.length || unreadChats.length ? `<div class="alerts">
      ${waitingQuotes.length ? `<a class="alert" href="#/quotes">📝 ${waitingQuotes.length} customer${waitingQuotes.length > 1 ? "s" : ""} waiting for a quote</a>` : ""}
      ${unreadChats.length ? `<a class="alert" href="#/${isPlaced(unreadChats[0]) ? "orders" : "quotes"}/${unreadChats[0].id}">💬 New messages on ${unreadChats.map(o => o.id).join(", ")}</a>` : ""}
      ${waitingPayments.length ? `<a class="alert" href="#/payments">💳 ${waitingPayments.length} payment${waitingPayments.length > 1 ? "s" : ""} to confirm</a>` : ""}
      ${late.length ? `<a class="alert" href="#/orders">⚠ ${late.length} late order${late.length > 1 ? "s" : ""}</a>` : ""}
      ${awaitingReview.length ? `<span class="alert soft">${awaitingReview.length} delivered order${awaitingReview.length > 1 ? "s" : ""} awaiting a review</span>` : ""}
    </div>` : ""}

    <div class="optbtns quick">
      <a class="optbtn" href="#/quotes">Quote requests</a>
      <a class="optbtn" href="#/orders">All Orders (live)</a>
      <a class="optbtn" href="#/team">Tailor Team</a>
      <a class="optbtn" href="#/profile">My profile</a>
      <a class="optbtn" href="#/customers">Customers</a>
      <a class="optbtn" href="#/weddings">Wedding Order</a>
      <a class="optbtn" href="#/shop">Ready to Wear</a>
      <a class="optbtn" href="#/invoices">Invoices</a>
      <a class="optbtn" href="#/deliveries">Delivery</a>
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
    return low.length ? `Running low: ${low.map(f => `${escapeHtml(f.name)} (${lengthText(f.yards_available, screenFabricUnit())})`).join(", ")}. The ${APP_NAME} admin looks after stock in NebedaHub Admin → Fabric inventory.` : `Every fabric has at least ${lengthText(LOW_STOCK_YARDS, screenFabricUnit())} in stock.`;
  }
  if (q.includes("owe") || q.includes("balance") || q.includes("pending") || q.includes("payment") || q.includes("unpaid")) {
    const owing = placedOrders().filter(o => balanceOwed(o) > 0);
    if (!owing.length) return "Every order is paid in full.";
    return `${escapeHtml(totalsText(businessTotals().pending, bizCurrency()))} is owed across ${owing.length} orders: ${owing.map(o => `#${o.id} ${escapeHtml(customerName(o.customer_id))} ${money(balanceOwed(o), orderCurrency(o))}`).join(", ")}.`;
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
    return `Revenue so far ${escapeHtml(totalsText(t.revenue, bizCurrency()))}, estimated profit ${escapeHtml(totalsText(t.profit, bizCurrency()))}, and ${escapeHtml(totalsText(t.pending, bizCurrency()))} still to collect.`;
  }
  if (q.includes("review") || q.includes("rating")) {
    const r = designerRating(bizDesignerId());
    return `${escapeHtml(bizDesigner().business_name)} is rated ${r.rating} from ${r.count} reviews.`;
  }
  return "I can answer questions about late orders, low stock, who owes money, staff workload, what's due this week, revenue and reviews.";
}
