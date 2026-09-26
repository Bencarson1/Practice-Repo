// ============================================================
// sw-core.js — the offline copy for each NebedaHub app. Each app has its
// own tiny sw.js (/sw.js, /business/sw.js, /sell/sw.js, /admin/sw.js) that
// says which app it is and then loads this file, so each one installs as a
// separate app with its own scope.
//
// It only ever stores NebedaHub's OWN files (the page, styles, scripts,
// icons). It never stores anything from another address — so nothing from
// Supabase (orders, chats, photos, sign-ins), postcodes.io or OpenStreetMap
// is ever kept on the device. Pages and scripts are fetched fresh from the
// internet first, so updates show straight away; the stored copy is only
// used when there's no connection.
// ============================================================

/* global NH_APP */
const SCOPE = new URL("./", self.location.href).pathname;          // "/", "/business/", …
const ROOT = new URL(NH_APP.root, self.location.href).pathname;    // "/" — where css/, js/ and icons/ live
const SHARED = ["css/", "js/", "icons/"].map(dir => ROOT + dir);
// The other apps' folders: the customer app (scope "/") leaves those to their own offline copies
const OTHER_APPS = NH_APP.name === "customer" ? ["business/", "sell/", "admin/"].map(dir => SCOPE + dir) : [];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(NH_APP.version).then(cache => cache.addAll(NH_APP.shell)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => NH_APP.oldCaches.test(k) && k !== NH_APP.version).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // Anything that isn't a plain GET of our own files goes straight to the network, untouched
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (OTHER_APPS.some(dir => url.pathname.startsWith(dir))) return;
  if (!url.pathname.startsWith(SCOPE) && !SHARED.some(dir => url.pathname.startsWith(dir))) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(NH_APP.version).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(hit => hit || (request.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
