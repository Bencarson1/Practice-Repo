// ============================================================
// sw.js — lets NebedaHub Business be installed on a phone's home screen as its own app
// (scope /business/) and open without a connection. The work is in
// ../js/sw-core.js, shared by all the NebedaHub apps.
// ============================================================

self.NH_APP = {
  name: "business",
  root: "../",
  version: "nebedahub-business-shell-v1",
  oldCaches: /^nebedahub-business-shell-/,
  shell: ["./", "./index.html", "./manifest.webmanifest", "../css/style.css",
          "../icons/business-192.png", "../icons/business-512.png", "../icons/business-apple-touch-icon.png"]
};
importScripts("../js/sw-core.js");
