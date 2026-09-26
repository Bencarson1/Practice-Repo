// The fabric seller app moved from /sell/ to /sellers/. Phones that installed
// the old one check this file for updates: it removes the old offline copy
// and reloads the page, which then goes to /sellers/.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => /^nebedahub-seller-shell-v1$/.test(k)).map(k => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll({ type: "window" }))
    .then(clients => clients.forEach(c => c.navigate(c.url).catch(() => {}))));
});
