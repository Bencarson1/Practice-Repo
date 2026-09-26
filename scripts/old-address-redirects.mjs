#!/usr/bin/env node
// ============================================================
// old-address-redirects.mjs — keeps old /wearvia/ links working
//
// The app used to be published at https://nebedahub.com/wearvia/ (and before
// that at bencarson1.github.io/Practice-Repo/wearvia/, which GitHub now
// forwards to nebedahub.com/wearvia/). It now lives at the top of the site:
// https://nebedahub.com/. This script adds to the finished site folder:
//
//   wearvia/<page>            for every page of the app: a tiny page that
//                             sends the visitor to the same page at its new
//                             address, keeping #/… app links (e.g.
//                             /wearvia/#/tailor/x → /#/tailor/x)
//   wearvia/sw.js             replaces the old offline copy of the app with
//                             one that deletes itself, so phones that
//                             installed the old version get the new one
//   404.html                  any other old /wearvia/… address (e.g. a
//                             tailor page made after this build) goes to
//                             its new address too
//
// Run (the workflow does this):  node scripts/old-address-redirects.mjs _site
// Settings: SITE_URL, the published address (default https://nebedahub.com)
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT, "wearvia");
const SITE_DIR = path.resolve(process.argv[2] || "_site");
const SITE_URL = (process.env.SITE_URL || "https://nebedahub.com").replace(/\/+$/, "");
const BASE = new URL(SITE_URL + "/").pathname;            // "/" on nebedahub.com
const OLD = "wearvia/";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function write(rel, text) {
  const file = path.join(SITE_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Every page of the app (index.html, tailors/…, tailor/…)
function pages(dir, rel = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const r = rel + e.name;
    if (e.isDirectory()) return e.name === "supabase" ? [] : pages(path.join(dir, e.name), r + "/");
    return e.name.endsWith(".html") ? [r] : [];
  });
}

// ---- A page that sends the visitor on to the new address ----

function movedPage(rel) {
  const to = BASE + rel.replace(/(^|\/)index\.html$/, "$1");  // tailors/uk/index.html → /tailors/uk/
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NebedaHub has moved</title>
  <link rel="canonical" href="${esc(SITE_URL + to.slice(BASE.length - 1))}">
  <script>location.replace(${JSON.stringify(to)} + location.search + location.hash);</script>
  <meta http-equiv="refresh" content="0; url=${esc(to)}">
</head>
<body style="font-family: system-ui, sans-serif; background: #0c1220; color: #f3efe6; padding: 24px">
  <p>NebedaHub has a new address. <a style="color: #d4a64a" href="${esc(to)}">Continue to NebedaHub</a>.</p>
</body>
</html>
`;
}

const list = pages(APP_DIR);
for (const rel of list) write(OLD + rel, movedPage(rel));

// ---- The old offline copy removes itself ----
// Phones and laptops that opened the old address still have its offline copy
// (scope /wearvia/). The browser checks /wearvia/sw.js for updates; this
// version deletes the old stored files, removes itself and reloads the page,
// which then goes to the new address.

write(OLD + "sw.js", `// The app moved from /wearvia/ to the top of the site. This removes the
// old offline copy; the new one is at /sw.js.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("wearvia-")).map(k => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll({ type: "window" }))
    .then(clients => clients.forEach(c => c.navigate(c.url).catch(() => {}))));
});
`);

// ---- Any other address: old /wearvia/… links, and tailors added since the last build ----

write("404.html", `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page not found · NebedaHub</title>
  <meta name="robots" content="noindex">
  <script>
    (function () {
      var base = ${JSON.stringify(BASE)}, p = location.pathname, m;
      if (p.indexOf(base + ${JSON.stringify(OLD)}) === 0) {
        location.replace(base + p.slice(base.length + ${OLD.length}) + location.search + location.hash);
      } else if ((m = p.slice(base.length).match(/^tailor\\/([a-z0-9-]+)\\/?$/))) {
        location.replace(base + "#/tailor/" + m[1]);
      }
    })();
  </script>
</head>
<body style="font-family: system-ui, sans-serif; background: #0c1220; color: #f3efe6; padding: 24px">
  <h1 style="font-family: Georgia, serif; color: #d4a64a">NebedaHub</h1>
  <p>We couldn't find that page.</p>
  <p><a style="color: #d4a64a" href="${esc(BASE)}">Go to NebedaHub</a> · <a style="color: #d4a64a" href="${esc(BASE)}tailors/">Find tailors</a></p>
</body>
</html>
`);

console.log(`Added ${list.length} old /${OLD} addresses that go to their new ones, the old offline-copy remover and 404.html (site at ${SITE_URL}).`);
