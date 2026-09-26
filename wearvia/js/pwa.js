// ============================================================
// pwa.js — makes each NebedaHub app installable on its own ("Add to Home Screen" on iPhone,
// "Install app" on Android and laptops). Each app registers the sw.js in its own
// folder (sw-core.js does the work). What is stored:
// only the app's own files, never anything from Supabase.
// ============================================================

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(error => console.warn("Offline support isn't available:", error.message));
    // The app used to be at /wearvia/. Remove that old offline copy so it can
    // never open the old version instead of this one.
    navigator.serviceWorker.getRegistrations()
      .then(list => list.filter(r => /\/wearvia\/$/.test(new URL(r.scope).pathname) && r.scope !== new URL("./", location.href).href)
        .forEach(r => r.unregister()))
      .catch(() => {});
  });
}
