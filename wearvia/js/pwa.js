// ============================================================
// pwa.js — makes Wearvia installable ("Add to Home Screen" on iPhone,
// "Install app" on Android and laptops). See sw.js for what is stored:
// only the app's own files, never anything from Supabase.
// ============================================================

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(error => console.warn("Offline support isn't available:", error.message));
  });
}
