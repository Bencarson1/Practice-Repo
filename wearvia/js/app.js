// ============================================================
// app.js — page addresses (routing), the business tabs, and start-up
//
// Addresses look like:
//   #/home, #/outfit, #/tracking/NT-1003     → customer app
//   #/biz/dashboard, #/biz/orders/NT-1003    → business dashboard
// ============================================================

const BIZ_TABS = [
  { key: "dashboard", label: "Dashboard", render: renderDashboard },
  { key: "orders", label: "Orders", render: renderOrdersTab },
  { key: "production", label: "Production", render: renderProduction },
  { key: "team", label: "Tailor Team", render: renderTeam },
  { key: "customers", label: "Customers", render: renderCustomers },
  { key: "measurements", label: "Measurements", render: renderMeasurements },
  { key: "fabrics", label: "Fabric Inventory", render: renderFabrics },
  { key: "payments", label: "Payments", render: renderPayments },
  { key: "weddings", label: "Wedding Orders", render: renderWeddings },
  { key: "shop", label: "Ready to Wear", render: renderShop },
  { key: "deliveries", label: "Deliveries", render: renderDeliveries },
  { key: "invoices", label: "Invoices", render: renderInvoices }
];

let navDepth = 0;      // how many screens deep we are, so "‹ back" knows where to go
let goingBack = false;

function go(path, replace) {
  const hash = "#/" + path;
  if (location.hash === hash) {
    renderAll();
  } else if (replace) {
    history.replaceState(null, "", hash);
    renderAll();
  } else {
    location.hash = hash;
  }
}

function back(fallback) {
  if (navDepth > 0) {
    goingBack = true;
    history.back();
  } else {
    go(fallback || "home", true);
  }
}

function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "biz") {
    return { area: "business", screen: parts[1] || "dashboard", id: parts[2] };
  }
  return { area: "customer", screen: parts[0] || "home", id: parts[1] };
}

// Redraw whatever is on screen (called after any data change)
function renderAll() {
  const route = currentRoute();
  const isBusiness = route.area === "business";
  document.getElementById("customer-view").hidden = isBusiness;
  document.getElementById("business-view").hidden = !isBusiness;
  document.getElementById("mode-customer").classList.toggle("on", !isBusiness);
  document.getElementById("mode-business").classList.toggle("on", isBusiness);
  document.body.classList.toggle("in-business", isBusiness);

  if (isBusiness) {
    const tab = BIZ_TABS.find(t => t.key === route.screen) || BIZ_TABS[0];
    document.getElementById("biz-tabs").innerHTML = BIZ_TABS.map(t =>
      `<a class="tab ${t.key === tab.key ? "active" : ""}" href="#/biz/${t.key}">${t.label}</a>`).join("");
    document.getElementById("biz-content").innerHTML = tab.render(route.id);
    document.title = `${tab.label} · ${SHOP_NAME} · ${APP_NAME}`;
  } else {
    renderCustomer(route.screen, route.id);
    document.title = APP_NAME;
  }
}

// A short message that fades away
let toastTimer = null;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// Small shared pieces for the business screens

function stageBadge(order) {
  const label = currentStepLabel(order);
  const cls = label === "Complete" ? "complete" : isLate(order) ? "late" : order.stage;
  return `<span class="badge stage-${cls}">${label === "Complete" ? "Complete" : escapeHtml(label)}</span>`;
}

function bizHeader(title, subtitle) {
  return `<div class="biz-head"><h1>${title}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ""}</div>`;
}

// ---- Start the app ----

window.addEventListener("hashchange", () => {
  if (goingBack) {
    navDepth = Math.max(0, navDepth - 1);
    goingBack = false;
  } else {
    navDepth += 1;
  }
  renderAll();
  window.scrollTo(0, 0);
  const inner = document.querySelector("#customer-app .content");
  if (inner) inner.scrollTop = 0;
});

document.getElementById("app-name").textContent = APP_NAME;
document.getElementById("shop-name").textContent = SHOP_NAME;
if (!location.hash) history.replaceState(null, "", "#/home");
renderAll();
