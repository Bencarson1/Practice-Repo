// ============================================================
// inspiration.js — "Upload a style": the customer's own photos of the
// outfit they want made, a link to the post, and a note of what to change
//
// Kept on the draft while ordering, then copied onto the order:
//   inspiration: { photos: ["ph_style_…", …], link: "https://…", note: "…" }
//
// Photos are shrunk before saving and kept in PhotoStore under the
// "style" folder. Moving to Supabase: PhotoStore.put uploads them to the
// "style-photos" bucket, and the link and note go in the
// order_inspiration table (see supabase/schema.sql).
// ============================================================

const MAX_STYLE_PHOTOS = 5;
const STYLE_PHOTO_MAX_SIZE = 1280;  // longest side in pixels — sharp enough to copy details from
const STYLE_PHOTO_QUALITY = 0.78;
const STYLE_NOTE_MAX = 500;

let styleAdding = 0; // photos still being shrunk and saved

function hasInspiration(insp) {
  return !!(insp && insp.photos && insp.photos.length);
}

function draftInspiration() {
  const d = draft();
  if (!d.inspiration) d.inspiration = { photos: [], link: "", note: "" };
  return d.inspiration;
}

// Deletes the draft's style photos (when the customer starts over or removes them)
function clearDraftInspiration() {
  const d = db.draft;
  if (!d || !d.inspiration) return;
  d.inspiration.photos.forEach(ref => PhotoStore.remove(ref));
  d.inspiration = null;
}

// ---- Links ----

// Tidies a pasted link. Returns "" when empty, or null when it isn't a web address.
// Share buttons often paste "Look at this! https://…", so the address is picked out of the text.
function cleanStyleLink(text) {
  let s = String(text || "").trim();
  if (!s) return "";
  const found = s.match(/https?:\/\/[^\s<>"']+/i);
  if (found) s = found[0];
  else if (/\s/.test(s)) return null;
  else s = "https://" + s;
  try {
    const url = new URL(s);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
    return url.href;
  } catch (e) {
    return null;
  }
}

const LINK_SOURCES = [
  [/(^|\.)instagram\.com$|^instagr\.am$/, "Instagram"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, "Pinterest"],
  [/(^|\.)facebook\.com$|^fb\.watch$/, "Facebook"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)(x|twitter)\.com$/, "X"]
];

function linkSource(href) {
  const host = new URL(href).hostname.replace(/^www\./, "");
  const match = LINK_SOURCES.find(([pattern]) => pattern.test(host));
  return match ? match[1] : host;
}

function styleLinkHtml(link) {
  const href = cleanStyleLink(link);
  if (!href) return "";
  return `<a class="style-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
    <span>🔗 View on ${escapeHtml(linkSource(href))} ↗</span><small>${escapeHtml(href)}</small></a>`;
}

// ---- Photos that open full size when tapped ----
// key is "draft" for the order being made, or an order id

function styleThumbs(key, insp, limit) {
  const photos = insp.photos.slice(0, limit || MAX_STYLE_PHOTOS);
  return photos.map((ref, i) => {
    const url = photoUrl(ref);
    return `<button type="button" class="style-thumb" onclick="openStyleViewer('${key}', ${i})" aria-label="Enlarge style photo ${i + 1} of ${insp.photos.length}">
      ${url ? `<img src="${url}" alt="" loading="lazy">` : `<span class="style-missing">Photo not on this device</span>`}</button>`;
  }).join("");
}

// "Your inspiration" in the customer app (concept screen and order tracking)
function inspirationBlock(key, insp) {
  if (!hasInspiration(insp)) return "";
  return `<section class="insp" aria-label="Your inspiration">
    <div class="row-between"><b class="insp-title">Your inspiration</b>
      ${key === "draft" ? `<button class="linkish" onclick="go('inspiration')">Edit</button>` : `<span class="fl">${insp.photos.length} photo${insp.photos.length === 1 ? "" : "s"}</span>`}</div>
    <div class="insp-grid">${styleThumbs(key, insp)}</div>
    ${insp.note ? `<p class="insp-note">“${escapeHtml(insp.note)}”</p>` : ""}
    ${styleLinkHtml(insp.link)}
  </section>`;
}

// ---- Customer screen: upload a style (step 1) ----

function styleSlots() {
  const insp = draft().inspiration || { photos: [] };
  const tiles = insp.photos.map((ref, i) => `
    <div class="photo-slot">
      <img src="${photoUrl(ref)}" alt="Style photo ${i + 1}">
      <button type="button" class="slot-btn" onclick="removeStylePhoto(${i})" aria-label="Remove photo ${i + 1}">×</button>
    </div>`).join("");
  const busy = Array.from({ length: styleAdding }, () =>
    `<div class="photo-slot busy" role="status"><span class="gen-spin"></span><small>Adding…</small></div>`).join("");
  const count = insp.photos.length + styleAdding;
  const add = count < MAX_STYLE_PHOTOS ? `
    <label class="photo-slot add">
      <input type="file" accept="image/*" multiple onchange="addStylePhotos(this)">
      <span>＋</span><small>Add photo${count ? "" : "s"}<br>${count}/${MAX_STYLE_PHOTOS}</small>
    </label>` : "";
  return tiles + busy + add;
}

function screenInspiration() {
  const d = draft();
  const insp = d.inspiration || { photos: [], link: "", note: "" };
  return `
    ${cTop("Upload a Style", "outfit")}
    <div class="content">
      ${flowBar("design")}
      <div class="meta">Add up to ${MAX_STYLE_PHOTOS} photos of the style you want — screenshots from Instagram, TikTok or Pinterest, or pictures from your camera. ${escapeHtml(SHOP_NAME)}'s tailors will copy it.</div>
      <div class="selopt"><span class="fl">Outfit type</span>
        <span><b>${escapeHtml(d.outfit)}</b> <button class="linkish" onclick="go('outfit')">Change</button></span></div>
      <div id="style-slots" class="photo-slots style-slots">${styleSlots()}</div>
      <label class="field"><span>Link to the post <small>(optional)</small></span>
        <input id="style-link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="Paste the Instagram, TikTok or Pinterest link" value="${escapeHtml(insp.link)}" oninput="saveStyleText()"></label>
      <label class="field"><span>What should we change? <small>(optional)</small></span>
        <textarea id="style-note" rows="3" maxlength="${STYLE_NOTE_MAX}" placeholder="e.g. Same dress but longer sleeves and in green" oninput="saveStyleText()">${escapeHtml(insp.note)}</textarea></label>
      <div id="style-error" class="form-error" role="alert"></div>
      <button class="cta" onclick="continueWithStyle()">Continue to Design →</button>
      <button id="style-remove" class="linkish" onclick="removeStyle()" ${hasInspiration(d.inspiration) ? "" : "hidden"}>Remove my style photos</button>
    </div>`;
}

function redrawStyleSlots() {
  const el = document.getElementById("style-slots");
  if (el) el.innerHTML = styleSlots();
  const remove = document.getElementById("style-remove");
  if (remove) remove.hidden = !hasInspiration(db.draft && db.draft.inspiration);
}

function styleError(message) {
  const el = document.getElementById("style-error");
  if (el) el.textContent = message;
  return false;
}

// Link and note are saved as they're typed, so adding a photo (or a refresh) doesn't lose them
function saveStyleText() {
  const link = document.getElementById("style-link");
  const note = document.getElementById("style-note");
  if (!link || !note) return;
  const insp = draftInspiration();
  insp.link = link.value.trim();
  insp.note = note.value.trim().slice(0, STYLE_NOTE_MAX);
  saveData();
}

function addStylePhotos(input) {
  const insp = draftInspiration();
  const files = Array.from(input.files || []);
  input.value = "";
  const room = MAX_STYLE_PHOTOS - insp.photos.length - styleAdding;
  if (room <= 0) return;
  if (files.length > room) toast(`Only ${room} more photo${room === 1 ? "" : "s"} added — you can upload up to ${MAX_STYLE_PHOTOS}.`);
  styleError("");
  const picked = files.slice(0, room);
  styleAdding += picked.length;
  redrawStyleSlots();
  // One at a time, so a phone doesn't hold five full-size photos in memory at once
  picked.reduce((chain, file) => chain.then(() =>
    resizeImage(file, STYLE_PHOTO_MAX_SIZE, STYLE_PHOTO_QUALITY)
      .then(url => PhotoStore.put(url, "style").catch(() => {
        throw new Error("Couldn't save the photo — this browser's storage may be full. Try fewer photos.");
      }))
      .then(ref => {
        // The customer may have started over while this photo was saving
        if (!db.draft || db.draft.inspiration !== insp || insp.photos.length >= MAX_STYLE_PHOTOS) {
          PhotoStore.remove(ref);
          return;
        }
        insp.photos.push(ref);
        saveData();
      })
      .catch(error => {
        styleError(error.message);
        toast(error.message);
      })
      .finally(() => {
        styleAdding -= 1;
        redrawStyleSlots();
      })
  ), Promise.resolve());
}

function removeStylePhoto(index) {
  const insp = draftInspiration();
  const [ref] = insp.photos.splice(index, 1);
  PhotoStore.remove(ref);
  saveData();
  redrawStyleSlots();
}

function continueWithStyle() {
  saveStyleText();
  const insp = draftInspiration();
  if (styleAdding) return styleError("One moment — your photos are still being added.");
  if (!hasInspiration(insp)) return styleError("Add at least one photo of the style you want.");
  const link = cleanStyleLink(insp.link);
  if (link === null) return styleError("That link doesn't look right. Paste the whole address of the post, or leave it empty.");
  insp.link = link;
  saveData();
  go("design");
}

function removeStyle() {
  if (!confirm("Remove your style photos, link and note?")) return;
  clearDraftInspiration();
  saveData();
  go("outfit");
}

// ---- Business: what the designer and tailors see ----

// Full brief on the order page
function styleBriefCard(order) {
  const insp = order.inspiration;
  if (!hasInspiration(insp)) return "";
  const n = insp.photos.length;
  return `
    <div class="card style-brief">
      <h2>📷 Customer's style — copy this <small class="muted">${n} photo${n === 1 ? "" : "s"} from the customer</small></h2>
      <div class="style-brief-body">
        <div class="style-brief-photos">${styleThumbs(order.id, insp)}</div>
        <div class="style-brief-text">
          <div class="style-label">Customer's note</div>
          ${insp.note ? `<blockquote class="style-note">${escapeHtml(insp.note)}</blockquote>` : `<p class="muted">No note — copy the photos as they are.</p>`}
          <div class="style-label">Link to the post</div>
          ${styleLinkHtml(insp.link) || `<p class="muted">No link given.</p>`}
          <p class="hint">Tap a photo to see it full size. The design options below set the price; the note says what to change from the photos.</p>
        </div>
      </div>
    </div>`;
}

// Short version on the production board and team lists
function styleJobStrip(order) {
  const insp = order.inspiration;
  if (!hasInspiration(insp)) return "";
  const more = insp.photos.length - 3;
  const note = insp.note.length > 90 ? insp.note.slice(0, 88) + "…" : insp.note;
  return `<div class="style-strip">
    <span class="style-tag">📷 Copy customer's style</span>
    <div class="style-mini">${styleThumbs(order.id, insp, 3)}${more > 0 ? `<button type="button" class="style-more" onclick="openStyleViewer('${order.id}', 3)" aria-label="See ${more} more photo${more === 1 ? "" : "s"}">+${more}</button>` : ""}</div>
    ${note ? `<small class="style-mini-note">“${escapeHtml(note)}”</small>` : ""}
    ${insp.link && cleanStyleLink(insp.link) ? `<small><a href="${escapeHtml(cleanStyleLink(insp.link))}" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(linkSource(cleanStyleLink(insp.link)))} post ↗</a></small>` : ""}
  </div>`;
}

// ---- Full-size photo viewer ----

let styleViewer = null;

function openStyleViewer(key, index) {
  const insp = key === "draft" ? (db.draft && db.draft.inspiration) : (findOrder(key) || {}).inspiration;
  if (!hasInspiration(insp)) return;
  styleViewer = {
    photos: insp.photos.slice(),
    index: Math.min(index, insp.photos.length - 1),
    title: key === "draft" ? "Your inspiration" : `${key} · customer's style`,
    returnFocus: document.activeElement
  };
  document.addEventListener("keydown", styleViewerKeys);
  drawStyleViewer();
}

function drawStyleViewer() {
  let el = document.getElementById("style-viewer");
  if (!el) {
    el = document.createElement("div");
    el.id = "style-viewer";
    el.className = "viewer";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.addEventListener("click", e => { if (e.target === el || e.target.classList.contains("viewer-stage")) closeStyleViewer(); });
    let startX = null;
    el.addEventListener("touchstart", e => { startX = e.touches[0].clientX; }, { passive: true });
    el.addEventListener("touchend", e => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 45) stepStyleViewer(dx < 0 ? 1 : -1);
    });
    document.body.appendChild(el);
  }
  const { photos, index, title } = styleViewer;
  const many = photos.length > 1;
  el.setAttribute("aria-label", title);
  el.innerHTML = `
    <div class="viewer-bar"><span>${escapeHtml(title)}${many ? ` · ${index + 1} of ${photos.length}` : ""}</span>
      <button type="button" class="viewer-close" onclick="closeStyleViewer()" aria-label="Close">×</button></div>
    <div class="viewer-stage">
      ${many ? `<button type="button" class="viewer-nav prev" onclick="stepStyleViewer(-1)" aria-label="Previous photo">‹</button>` : ""}
      <img src="${photoUrl(photos[index])}" alt="Style photo ${index + 1} of ${photos.length}">
      ${many ? `<button type="button" class="viewer-nav next" onclick="stepStyleViewer(1)" aria-label="Next photo">›</button>` : ""}
    </div>`;
  el.querySelector(".viewer-close").focus();
}

function stepStyleViewer(delta) {
  if (!styleViewer) return;
  const n = styleViewer.photos.length;
  styleViewer.index = (styleViewer.index + delta + n) % n;
  drawStyleViewer();
}

function closeStyleViewer() {
  if (!styleViewer) return;
  const el = document.getElementById("style-viewer");
  if (el) el.remove();
  document.removeEventListener("keydown", styleViewerKeys);
  const back = styleViewer.returnFocus;
  styleViewer = null;
  if (back && document.contains(back)) back.focus();
}

function styleViewerKeys(event) {
  if (event.key === "Escape") closeStyleViewer();
  else if (event.key === "ArrowLeft") stepStyleViewer(-1);
  else if (event.key === "ArrowRight") stepStyleViewer(1);
  else if (event.key === "Tab") {
    // Keep keyboard focus inside the viewer
    const buttons = Array.from(document.querySelectorAll("#style-viewer button"));
    const at = buttons.indexOf(document.activeElement);
    event.preventDefault();
    buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
  }
}
