// ============================================================
// app.js — page addresses (routing), the business tabs, and start-up
//
// Addresses look like:
//   #/home, #/outfit, #/tracking/NT-1003     → customer app
//   #/biz/dashboard, #/biz/orders/NT-1003    → business dashboard
//   #/seller/fabrics, #/seller/edit/F12      → fabric seller area
// ============================================================

// show: only for some people (the fabric marketplace and approving tailors are the admin's)
const BIZ_TABS = [
  { key: "dashboard", label: "Dashboard", render: renderDashboard },
  { key: "profile", label: "My profile", render: renderMyProfile, badge: () => (bizDesigner() || {}).admin_status === "approved" ? 0 : 1 },
  // Badges: quote requests that need the team; orders with unread customer messages
  { key: "quotes", label: "Quote requests", render: renderQuotes, badge: () => quotesNeedingTeam().length },
  { key: "orders", label: "Orders", render: renderOrdersTab, badge: () => placedOrders().filter(o => unreadCount(o.id, "team") > 0).length },
  { key: "production", label: "Production", render: renderProduction },
  { key: "team", label: "Tailor Team", render: renderTeam },
  { key: "customers", label: "Customers", render: renderCustomers },
  { key: "measurements", label: "Measurements", render: renderMeasurements },
  { key: "fabrics", label: "Fabric Inventory", render: renderFabrics, show: isAdminUser },
  { key: "sellers", label: "Fabric Sellers", render: renderSellerFabrics, show: isAdminUser },
  { key: "tailors", label: "Tailors", render: renderTailorAdmin, show: isAdminUser, badge: () => db.designers.filter(d => d.admin_status === "pending").length },
  { key: "payments", label: "Payments", render: renderPayments },
  { key: "prices", label: "Prices", render: renderPrices },
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
  if (parts[0] === "seller") {
    return { area: "seller", screen: parts[1] || "fabrics", id: parts[2] };
  }
  return { area: "customer", screen: parts[0] || "home", id: parts[1] };
}

// Redraw whatever is on screen (called after any data change)
function renderAll() {
  if (!db || !document.getElementById("auth-view").hidden) return; // still loading, or signing in
  const route = currentRoute();
  // Without an account you can find tailors; anything else asks you to sign in
  if (Cloud.isGuest() && (route.area !== "customer" || !Cloud.GUEST_SCREENS.includes(route.screen))) {
    Auth.show("signIn");
    return;
  }
  if (!Cloud.canOpen(route.area)) {
    go(Cloud.homeRoute(), true);
    return;
  }
  const isBusiness = route.area === "business";
  const isSeller = route.area === "seller";
  const isCustomer = route.area === "customer";
  document.getElementById("customer-view").hidden = !isCustomer;
  document.getElementById("business-view").hidden = !isBusiness;
  document.getElementById("seller-view").hidden = !isSeller;
  document.getElementById("mode-customer").classList.toggle("on", isCustomer);
  document.getElementById("mode-seller").classList.toggle("on", isSeller);
  document.getElementById("mode-business").classList.toggle("on", isBusiness);
  document.body.classList.toggle("in-business", isBusiness);
  // Quotes and prices on screen use the right tailor's price list
  usePricesOf(contextDesignerId());
  const shop = isBusiness ? bizDesigner() : null;
  document.getElementById("shop-pill").innerHTML = shop ? `Business: <b>${escapeHtml(shop.business_name)}</b>` : `Tailors near you · <b>${escapeHtml(APP_NAME)}</b>`;
  // On phones the customer app fills the screen below the top bar, whose height changes with its contents
  document.documentElement.style.setProperty("--appbar-h", document.querySelector(".appbar").offsetHeight + "px");

  if (isSeller) {
    renderSellerArea(route.screen, route.id);
  } else if (isBusiness) {
    const tabs = BIZ_TABS.filter(t => !t.show || t.show());
    const tab = tabs.find(t => t.key === route.screen) || tabs[0];
    // The page first: opening a chat marks it read, so the badges are drawn after
    document.getElementById("biz-content").innerHTML = bizSwitcher() + (tab.key === "profile" ? "" : tailorStatusBanner(bizDesigner())) + tab.render(route.id);
    afterChatRender();
    document.getElementById("biz-tabs").innerHTML = tabs.map(t => {
      const badge = t.badge ? t.badge() : 0;
      return `<a class="tab ${t.key === tab.key ? "active" : ""}" href="#/biz/${t.key}">${t.label}${badge ? `<span class="tab-badge" aria-label="${badge} need attention">${badge}</span>` : ""}</a>`;
    }).join("");
    document.title = `${tab.label} · ${(bizDesigner() || {}).business_name || SHOP_NAME} · ${APP_NAME}`;
  } else {
    renderCustomer(route.screen, route.id);
    const tailor = route.screen === "tailor" ? designerById((db.designers.find(d => d.slug === route.id) || {}).id) : null;
    document.title = tailor ? `${tailor.business_name} · ${APP_NAME}` : route.screen === "tailors" ? `Find tailors near me · ${APP_NAME}` : APP_NAME;
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

// Which tailor's dashboard this is (only shown to people who work for more than one, and in the demo)
function bizSwitcher() {
  const list = managedDesigners();
  if (list.length < 2) return "";
  return `<div class="biz-switch"><label>Dashboard for
    <select onchange="switchBizDesigner(this.value)">${list.map(d => `<option value="${d.id}" ${d.id === bizDesignerId() ? "selected" : ""}>${escapeHtml(d.business_name)}${d.admin_status !== "approved" ? " — " + TAILOR_STATUS_LABELS[d.admin_status].toLowerCase() : ""}</option>`).join("")}</select></label>
    ${Cloud.live ? "" : `<span class="hint">Demo: switch tailor to see that each one only sees their own customers and orders.</span>`}</div>`;
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
  closeStyleViewer();
  renderAll();
  Cloud.refreshIfStale(); // picks up changes made on other phones and laptops
  window.scrollTo(0, 0);
  const inner = document.querySelector("#customer-app .content");
  if (inner) inner.scrollTop = 0;
});

document.getElementById("app-name").textContent = APP_NAME;

Auth.loading();
Cloud.start()
  .then(result => {
    if (result.recovery) return Auth.show("newPassword");
    if (!result.signedIn) {
      // Someone arriving at a tailor page (e.g. from Google) can look around first
      if (Cloud.GUEST_SCREENS.includes(currentRoute().screen) && currentRoute().area === "customer") {
        return Cloud.startGuest().then(() => { Auth.hide(); Auth.drawChrome(); renderAll(); });
      }
      return Auth.show("signIn");
    }
    if (Cloud.live) return Auth.enterApp();
    // Demo mode
    Auth.hide();
    Auth.drawChrome();
    if (!location.hash || !/^#\//.test(location.hash)) history.replaceState(null, "", "#/home");
    renderAll();
    // Uploaded photos load from the browser's photo store a moment later; draw again when they're in
    PhotoStore.ready.then(renderAll);
  })
  .catch(error => {
    console.error(error);
    Auth.flash(error.message || "Something went wrong while loading.");
    Auth.show("signIn");
  });
