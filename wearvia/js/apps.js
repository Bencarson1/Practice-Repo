// ============================================================
// apps.js — which NebedaHub app this page is
//
// NebedaHub is four apps on one Supabase database, like Uber and Uber Driver:
//   NebedaHub           /           customers: find tailors, order, chat, pay, track
//   NebedaHub Business  /business/  tailors, designers and their staff
//   NebedaHub Seller    /sell/      fabric sellers
//   NebedaHub Admin     /admin/     the NebedaHub admin only
// Each page says which app it is with <html data-app="…">. They share this
// code, but each has its own address, sign-in, look and installable app.
// ============================================================

const APPS = {
  customer: { name: "NebedaHub", dir: "", home: "home", who: "customers" },
  business: { name: "NebedaHub Business", dir: "business/", home: "dashboard", who: "tailors and designers" },
  seller: { name: "NebedaHub Seller", dir: "sell/", home: "fabrics", who: "fabric sellers" },
  admin: { name: "NebedaHub Admin", dir: "admin/", home: "overview", who: "the NebedaHub admin" }
};
const APP_KIND = APPS[document.documentElement.dataset.app] ? document.documentElement.dataset.app : "customer";
const APP = APPS[APP_KIND];
const SITE_ROOT = APP_KIND === "customer" ? "./" : "../";

// A link to another app (or to a page in one): appUrl("business", "join")
function appUrl(kind, path) {
  const page = location.protocol === "file:" ? "index.html" : "";   // opened straight from the folder
  return SITE_ROOT + APPS[kind].dir + page + (path ? "#/" + path : "");
}

// ---- Old addresses keep working ----
let appMoving = false;   // true while this page is on its way to another app
// Before the split everything was one app: #/biz/… was the Business
// dashboard, #/seller/… the fabric seller area and #/for-tailors the tailor
// welcome page. Those links (bookmarks, emails, the old /wearvia/ address)
// now go to the right app. Sign-in links from Supabase (#access_token=…)
// are left alone.
(function oldAddresses() {
  const hash = location.hash;
  if (!/^#\/?[a-zA-Z]/.test(hash) || /access_token=|error_description=|type=recovery/.test(hash)) return;
  const parts = hash.replace(/^#\/?/, "").split("/");
  const rest = parts.slice(1).join("/");
  const moves = {
    customer: { biz: ["business", rest], seller: ["seller", rest], "for-tailors": ["business", "welcome"], joinTailor: ["business", "join"] },
    business: { biz: ["business", rest] },
    seller: { seller: ["seller", rest] }
  }[APP_KIND] || {};
  const move = moves[parts[0]];
  if (!move) return;
  if (move[0] === APP_KIND) history.replaceState(null, "", location.pathname + location.search + (move[1] ? "#/" + move[1] : ""));
  else {
    appMoving = true;
    const to = appUrl(move[0], move[1]);
    location.replace(to.replace(/(#|$)/, location.search + "$1"));   // keeps ?demo=1
  }
})();
