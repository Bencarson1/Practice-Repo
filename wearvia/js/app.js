// ============================================================
// app.js — page addresses (routing), the tabs, and start-up
//
// Each NebedaHub app (see apps.js) has its own addresses:
//   NebedaHub           /#/home, /#/outfit, /#/tracking/NT-1003
//   NebedaHub Business  /business/#/dashboard, /business/#/orders/NT-1003
//   NebedaHub Seller    /sell/#/fabrics, /sell/#/edit/F12
//   NebedaHub Admin     /admin/#/overview, /admin/#/tailors
// ============================================================

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
  { key: "payments", label: "Payments", render: renderPayments },
  { key: "prices", label: "Prices", render: renderPrices },
  { key: "weddings", label: "Wedding Orders", render: renderWeddings },
  { key: "shop", label: "Ready to Wear", render: renderShop },
  { key: "deliveries", label: "Deliveries", render: renderDeliveries },
  { key: "invoices", label: "Invoices", render: renderInvoices }
];

// The platform's own tools: only in NebedaHub Admin (admin.js)
const ADMIN_TABS = [
  { key: "overview", label: "Overview", render: renderAdminOverview },
  { key: "tailors", label: "Tailors", render: renderTailorAdmin, badge: () => db.designers.filter(d => d.admin_status === "pending").length },
  { key: "sellers", label: "Fabric sellers", render: renderSellerFabrics, badge: () => activeFabrics().filter(f => f.status === "pending").length },
  { key: "fabrics", label: "Fabric inventory", render: renderFabrics },
  { key: "specialities", label: "Specialities", render: renderSpecialities },
  { key: "contacts", label: "Hidden contact details", render: renderHiddenContacts }
];

// Screens someone without an account can open in each app
const GUEST_SCREENS_BY_APP = { business: ["welcome"], seller: ["welcome"], admin: [] };

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
    go(fallback || APP.home, true);
  }
}

function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const area = APP_KIND;
  if (area === "customer") return { area, screen: parts[0] || "home", id: parts[1] };
  return { area, screen: parts[0] || APP.home, id: parts[1] };
}

// Without an account you can find tailors, and read how to join as a tailor or seller
function guestCanOpen(route) {
  if (route.area === "customer") return Cloud.GUEST_SCREENS.includes(route.screen);
  return (GUEST_SCREENS_BY_APP[route.area] || []).includes(route.screen);
}

// Redraw whatever is on screen (called after any data change)
function renderAll() {
  if (appMoving || !db || !document.getElementById("auth-view").hidden) return; // still loading, or signing in
  const route = currentRoute();
  // Without an account you can only look around; anything else asks you to sign in
  if (Cloud.isGuest() && !guestCanOpen(route)) {
    Auth.show("signIn");
    return;
  }
  const business = route.area === "business" && Cloud.isTeam() && !["welcome", "join"].includes(route.screen);
  const view = route.area === "customer" ? "customer-view"
    : route.area === "seller" ? "seller-view"
    : route.area === "admin" ? "admin-view"
    : business ? "business-view" : "join-view";
  ["customer-view", "business-view", "seller-view", "join-view", "admin-view"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = id !== view;
  });
  document.body.classList.toggle("in-business", business);
  // Quotes and prices on screen use the right tailor's price list
  usePricesOf(contextDesignerId());
  const shop = business ? bizDesigner() : null;
  document.getElementById("shop-pill").innerHTML = shop ? `Business: <b>${escapeHtml(shop.business_name)}</b>` : escapeHtml(APP_PILLS[APP_KIND]);
  // On phones the customer app fills the screen below the top bar, whose height changes with its contents
  document.documentElement.style.setProperty("--appbar-h", document.querySelector(".appbar").offsetHeight + "px");

  if (route.area === "seller") {
    renderSellerArea(route.screen, route.id);
  } else if (route.area === "admin") {
    renderAdminArea(route.screen, route.id);
  } else if (route.area === "business" && !business) {
    renderTailorJoin(route.screen);
  } else if (business) {
    const tabs = BIZ_TABS.filter(t => !t.show || t.show());
    const tab = tabs.find(t => t.key === route.screen) || tabs[0];
    // The page first: opening a chat marks it read, so the badges are drawn after
    document.getElementById("biz-content").innerHTML = bizSwitcher() + (tab.key === "profile" ? "" : tailorStatusBanner(bizDesigner())) + tab.render(route.id);
    afterChatRender();
    document.getElementById("biz-tabs").innerHTML = tabsHtml(tabs, tab);
    document.title = `${tab.label} · ${(bizDesigner() || {}).business_name || SHOP_NAME} · ${APP.name}`;
  } else if (needsCustomerRecord()) {
    document.getElementById("customer-app").innerHTML = notACustomerScreen();
    document.title = APP.name;
  } else {
    renderCustomer(route.screen, route.id);
    const tailor = route.screen === "tailor" ? designerById((db.designers.find(d => d.slug === route.id) || {}).id) : null;
    document.title = tailor ? `${tailor.business_name} · ${APP_NAME}` : route.screen === "tailors" ? `Find tailors near me · ${APP_NAME}` : APP_NAME;
  }
}

const APP_PILLS = { customer: "Tailors near you", business: "For tailors and designers", seller: "For fabric sellers", admin: "Platform admin" };

function tabsHtml(tabs, active) {
  return tabs.map(t => {
    const badge = t.badge ? t.badge() : 0;
    return `<a class="tab ${t.key === active.key ? "active" : ""}" href="#/${t.key}">${t.label}${badge ? `<span class="tab-badge" aria-label="${badge} need attention">${badge}</span>` : ""}</a>`;
  }).join("");
}

// ---- NebedaHub Admin ----

function renderAdminArea(screen, id) {
  const tabsEl = document.getElementById("admin-tabs");
  const content = document.getElementById("admin-content");
  if (!isAdminUser()) {
    tabsEl.innerHTML = "";
    content.innerHTML = noAccessCard("This account isn't a NebedaHub admin",
      `NebedaHub Admin is only for the NebedaHub team. You're signed in as ${escapeHtml((Cloud.me || {}).email || "")}.`,
      [["customer", "", "Open NebedaHub"], ["business", "", "Open NebedaHub Business"], ["seller", "", "Open NebedaHub Seller"]]);
    document.title = APP.name;
    return;
  }
  const tab = ADMIN_TABS.find(t => t.key === screen) || ADMIN_TABS[0];
  content.innerHTML = tab.render(id);
  tabsEl.innerHTML = tabsHtml(ADMIN_TABS, tab);
  document.title = `${tab.label} · ${APP.name}`;
}

// "This account can't use this app" — with the way to the right one, and to sign out
function noAccessCard(title, text, links, extra) {
  return `<div class="card no-access">
    <h1>${title}</h1>
    <p class="muted">${text}</p>
    ${extra || ""}
    <div class="no-access-links">${links.map(([kind, path, label], i) =>
      `<a class="button ${i ? "ghost" : "gold"}" href="${escapeHtml(appUrl(kind, path))}">${escapeHtml(label)}</a>`).join("")}</div>
    ${Cloud.live && Cloud.me ? `<p class="hint">Or <button class="linkish strong" onclick="Auth.signOut()">sign out</button> and use a different email.</p>` : ""}
  </div>`;
}

// ---- The customer app, for an account that was only ever a tailor ----
// Customers get a customer record when they sign up. Tailors and their staff
// don't, so the first time they open the customer app they can make one.

function needsCustomerRecord() {
  return APP_KIND === "customer" && Cloud.live && !!Cloud.me && !Cloud.me.customer_id;
}

function notACustomerScreen() {
  const kind = Cloud.me.is_admin && !(Cloud.me.designers || []).length ? "admin" : "business";
  return `<div class="content not-customer">
    <div class="auth-brand">${APP_NAME}</div>
    <h2>This is ${kind === "admin" ? "an admin" : "a tailor"} account</h2>
    <p>${escapeHtml(Cloud.me.email)} is set up for ${APPS[kind].name}. You can open it, or use the same email to order outfits here too.</p>
    <a class="cta" href="${escapeHtml(appUrl(kind, ""))}">Open ${APPS[kind].name}</a>
    <button class="btn-outline" id="make-customer" onclick="startOrderingToo()">Order outfits with this account too</button>
    <button class="linkish" onclick="Auth.signOut()">Sign out</button>
  </div>`;
}

function startOrderingToo() {
  const button = document.getElementById("make-customer");
  if (button) { button.disabled = true; button.textContent = "Setting up…"; }
  Cloud.becomeCustomer()
    .then(() => { toast("Done — you can order outfits with this account now."); go("home", true); })
    .catch(error => { toast(error.message); if (button) { button.disabled = false; button.textContent = "Order outfits with this account too"; } });
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

Auth.drawBrand();

if (!appMoving) Auth.loading();
if (!appMoving) Cloud.start()
  .then(result => {
    if (result.recovery) return Auth.show("newPassword");
    if (!result.signedIn) {
      // Someone arriving at a tailor page (e.g. from Google), or at the tailor
      // or seller welcome page, can look around first
      if (APP_KIND !== "customer" && APP_KIND !== "admin" && !/^#\/./.test(location.hash)) history.replaceState(null, "", "#/welcome");
      if (guestCanOpen(currentRoute())) {
        return Cloud.startGuest().then(() => { Auth.hide(); Auth.drawChrome(); renderAll(); });
      }
      return Auth.show("signIn");
    }
    if (Cloud.live) return Auth.enterApp();
    // Demo mode
    Auth.hide();
    Auth.drawChrome();
    if (!location.hash || !/^#\//.test(location.hash)) history.replaceState(null, "", "#/" + APP.home);
    renderAll();
    // Uploaded photos load from the browser's photo store a moment later; draw again when they're in
    PhotoStore.ready.then(renderAll);
  })
  .catch(error => {
    console.error(error);
    Auth.flash(error.message || "Something went wrong while loading.");
    Auth.show("signIn");
  });
