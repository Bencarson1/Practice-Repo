// ============================================================
// sw.js — lets NebedaHub Seller be installed on a phone's home screen as its own app
// (scope /sell/) and open without a connection. The work is in
// ../js/sw-core.js, shared by all the NebedaHub apps.
// ============================================================

self.NH_APP = {
  name: "seller",
  root: "../",
  version: "nebedahub-seller-shell-v1",
  oldCaches: /^nebedahub-seller-shell-/,
  shell: ["./", "./index.html", "./manifest.webmanifest", "../css/style.css",
          "../icons/seller-192.png", "../icons/seller-512.png", "../icons/seller-apple-touch-icon.png"]
};
importScripts("../js/sw-core.js");
