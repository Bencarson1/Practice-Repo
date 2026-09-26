// ============================================================
// sw.js — lets NebedaHub be installed on a phone's home screen and open
// without a connection.
//
// It only ever stores NebedaHub's OWN files (the page, styles, scripts,
// icons). It never stores anything from another address — so nothing from
// Supabase (orders, chats, photos, sign-ins), postcodes.io or OpenStreetMap
// is ever kept on the device by this file. Pages and scripts are fetched
// fresh from the internet first, so updates show straight away; the stored
// copy is only used when there's no connection.
//
// The app used to live at /wearvia/ (cache "wearvia-shell-v1"); that old
// copy is deleted when this version starts.
// ============================================================

const VERSION = "nebedahub-shell-v1";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./css/style.css",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => /^(wearvia|nebedahub)-/.test(k) && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // Anything that isn't a plain GET of our own files goes straight to the network, untouched
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL("./", self.location.href).pathname)) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(hit => hit || (request.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
