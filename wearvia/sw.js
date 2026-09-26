// ============================================================
// sw.js — lets NebedaHub (the customer app) be installed on a phone's home
// screen and open without a connection. The work is in js/sw-core.js,
// shared with NebedaHub Business, Seller and Admin (each has its own sw.js).
//
// The app used to live at /wearvia/ (cache "wearvia-shell-v1"); that old
// copy is deleted when this version starts.
// ============================================================

self.NH_APP = {
  name: "customer",
  root: "./",
  version: "nebedahub-shell-v2",
  oldCaches: /^(wearvia-|nebedahub-shell-)/,
  shell: ["./", "./index.html", "./manifest.webmanifest", "./css/style.css",
          "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"]
};
importScripts("js/sw-core.js");
