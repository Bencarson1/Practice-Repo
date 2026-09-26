// ============================================================
// sw.js — lets NebedaHub Admin be installed on a phone's home screen as its own app
// (scope /admin/) and open without a connection. The work is in
// ../js/sw-core.js, shared by all the NebedaHub apps.
// ============================================================

self.NH_APP = {
  name: "admin",
  root: "../",
  version: "nebedahub-admin-shell-v1",
  oldCaches: /^nebedahub-admin-shell-/,
  shell: ["./", "./index.html", "./manifest.webmanifest", "../css/style.css",
          "../icons/admin-192.png", "../icons/admin-512.png", "../icons/admin-apple-touch-icon.png"]
};
importScripts("../js/sw-core.js");
