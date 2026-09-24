// ============================================================
// photos.js — where fabric photos and shop logos are kept
//
// A photo is saved once and then referred to by a short "ref":
//   "ph_…"            a photo someone uploaded (kept in this browser)
//   "pattern:…"       a drawn sample fabric (used by the sample sellers)
//   "logo:…"          a drawn logo made from the shop's initials
//   "data:…"/"https:" a full image address, used as it is
//
// Uploaded photos live in the browser's IndexedDB (it holds far more
// than localStorage). Moving to Supabase: upload to a Storage bucket
// in PhotoStore.put and return the file path as the ref, then make
// photoUrl() build the public URL. Nothing else needs to change.
// ============================================================

const MAX_PHOTOS_PER_FABRIC = 5;
const PHOTO_MAX_SIZE = 1200;  // longest side in pixels after resizing
const LOGO_MAX_SIZE = 320;

const PhotoStore = (() => {
  const DB_NAME = "wearvia-photos";
  const TABLE = "photos";
  const FALLBACK_KEY = "wearvia-photos-v1";
  const cache = new Map();   // ref → data URL, so screens can draw straight away
  let idb = null;

  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("No IndexedDB"));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(TABLE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbRun(mode, work) {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(TABLE, mode);
      const result = work(tx.objectStore(TABLE));
      tx.oncomplete = () => resolve(result && result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function readFallback() {
    try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || "{}"); } catch (e) { return {}; }
  }

  function writeFallback() {
    const all = {};
    cache.forEach((url, ref) => { all[ref] = url; });
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(all));
  }

  // Loads every saved photo into memory. The app draws again once this finishes.
  const ready = openIdb()
    .then(opened => {
      idb = opened;
      return new Promise((resolve, reject) => {
        const tx = idb.transaction(TABLE, "readonly");
        const request = tx.objectStore(TABLE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) { cache.set(cursor.key, cursor.value); cursor.continue(); } else resolve();
        };
        request.onerror = () => reject(request.error);
      });
    })
    .catch(error => {
      console.warn("IndexedDB unavailable, keeping photos in localStorage instead.", error);
      idb = null;
      const saved = readFallback();
      Object.keys(saved).forEach(ref => cache.set(ref, saved[ref]));
    });

  function newRef() {
    return "ph_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Saves an image (a data URL) and returns its ref. Rejects if the browser is out of space.
  function put(dataUrl) {
    const ref = newRef();
    cache.set(ref, dataUrl);
    const saving = idb
      ? idbRun("readwrite", store => store.put(dataUrl, ref))
      : new Promise(resolve => { writeFallback(); resolve(); });
    return saving.then(() => ref).catch(error => {
      cache.delete(ref);
      throw error;
    });
  }

  function remove(ref) {
    if (!ref || !cache.has(ref)) return;
    cache.delete(ref);
    try {
      if (idb) idbRun("readwrite", store => store.delete(ref)).catch(() => {});
      else writeFallback();
    } catch (e) { /* nothing else to do */ }
  }

  function clear() {
    cache.clear();
    try {
      if (idb) idbRun("readwrite", store => store.clear()).catch(() => {});
      localStorage.removeItem(FALLBACK_KEY);
    } catch (e) { /* nothing else to do */ }
  }

  function get(ref) { return cache.get(ref) || ""; }

  return { ready, put, remove, clear, get };
})();

// Turns a ref into something an <img src> can use
const drawnImages = new Map();
function photoUrl(ref) {
  if (!ref) return "";
  if (ref.startsWith("ph_")) return PhotoStore.get(ref);
  if (ref.startsWith("pattern:") || ref.startsWith("logo:")) {
    if (!drawnImages.has(ref)) {
      const svg = ref.startsWith("logo:") ? logoSVG(ref) : fabricPatternSVG(ref);
      drawnImages.set(ref, "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    }
    return drawnImages.get(ref);
  }
  return ref;
}

// Shrinks a photo from a phone camera to a sensible size before saving it
function resizeImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error(`${file.name} isn't a photo.`));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`Couldn't open ${file.name}. Try a JPG or PNG photo.`));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; // transparent PNGs become white, not black, as JPEGs
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality || 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- Drawn sample photos, so the sample sellers have something to show ----
// "pattern:<kind>:<colour>-<colour>-<colour>:<view>"   view 0 = flat, 1 = close-up, 2 = draped

function fabricPatternSVG(ref) {
  const [, kind, colourText, viewText] = ref.split(":");
  const [a, b, c] = (colourText || "1e2a44-c9a24a-efe6d2").split("-").map(h => "#" + h);
  const view = Number(viewText) || 0;
  const scale = view === 1 ? 2.2 : 1;
  const tile = {
    ankara: `<rect width="60" height="60" fill="${a}"/>
      <circle cx="30" cy="30" r="17" fill="${b}"/><circle cx="30" cy="30" r="11" fill="${a}"/><circle cx="30" cy="30" r="6" fill="${c}"/>
      <circle cx="0" cy="0" r="9" fill="${c}"/><circle cx="60" cy="0" r="9" fill="${c}"/><circle cx="0" cy="60" r="9" fill="${c}"/><circle cx="60" cy="60" r="9" fill="${c}"/>
      <path d="M30 2 q6 6 0 12 q-6 -6 0 -12M30 46 q6 6 0 12 q-6 -6 0 -12M2 30 q6 -6 12 0 q-6 6 -12 0M46 30 q6 -6 12 0 q-6 6 -12 0" fill="${b}"/>`,
    kente: `<rect width="60" height="60" fill="${a}"/>
      <rect x="0" width="20" height="30" fill="${b}"/><rect x="40" y="30" width="20" height="30" fill="${b}"/>
      <rect x="20" y="0" width="20" height="30" fill="${c}"/><rect x="20" y="30" width="20" height="30" fill="${a}"/>
      <path d="M0 30h60M20 0v60M40 0v60" stroke="#111" stroke-width="2"/>
      <path d="M22 8h16M22 14h16M22 20h16M2 38h16M2 44h16M2 50h16" stroke="${a}" stroke-width="2.5"/>
      <path d="M42 6l4 6l4 -6l4 6l4 -6" stroke="${a}" stroke-width="2" fill="none"/>`,
    aso_oke: `<rect width="60" height="60" fill="${a}"/>
      <path d="M0 6h60M0 18h60M0 30h60M0 42h60M0 54h60" stroke="${b}" stroke-width="4"/>
      <path d="M0 12h60M0 36h60" stroke="${c}" stroke-width="1.5"/>
      <path d="M10 0v60M40 0v60" stroke="${b}" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>`,
    lace: `<rect width="60" height="60" fill="${a}"/>
      <g fill="none" stroke="${b}" stroke-width="1.6">
        <circle cx="30" cy="30" r="12"/><circle cx="30" cy="30" r="5"/>
        <path d="M30 18 q5 -9 0 -18 q-5 9 0 18M30 42 q5 9 0 18 q-5 -9 0 -18M18 30 q-9 5 -18 0 q9 -5 18 0M42 30 q9 5 18 0 q-9 -5 -18 0"/>
        <path d="M0 0 l12 12M60 0 l-12 12M0 60 l12 -12M60 60 l-12 -12" stroke-dasharray="2 3"/>
      </g>
      <g fill="${c}"><circle cx="30" cy="18" r="1.8"/><circle cx="30" cy="42" r="1.8"/><circle cx="18" cy="30" r="1.8"/><circle cx="42" cy="30" r="1.8"/><circle cx="6" cy="30" r="1.2"/><circle cx="54" cy="30" r="1.2"/><circle cx="30" cy="6" r="1.2"/><circle cx="30" cy="54" r="1.2"/></g>`,
    adire: `<rect width="60" height="60" fill="${a}"/>
      <g fill="none" stroke="${b}" opacity=".85">
        <circle cx="15" cy="15" r="10" stroke-width="3"/><circle cx="15" cy="15" r="4" stroke-width="2"/>
        <circle cx="45" cy="45" r="10" stroke-width="3"/><circle cx="45" cy="45" r="4" stroke-width="2"/>
        <path d="M34 8 l18 0M34 14 l18 0M34 20 l18 0M8 38 l14 14M8 46 l6 6M16 38 l6 6" stroke-width="2.4"/>
      </g>
      <circle cx="15" cy="15" r="1.6" fill="${c}"/><circle cx="45" cy="45" r="1.6" fill="${c}"/>`,
    brocade: `<rect width="60" height="60" fill="${a}"/>
      <g fill="${b}" opacity=".55">
        <path d="M30 6 q10 12 0 24 q-10 -12 0 -24M30 30 q10 12 0 24 q-10 -12 0 -24"/>
        <path d="M6 30 q12 -10 24 0 q-12 10 -24 0M30 30 q12 -10 24 0 q-12 10 -24 0"/>
      </g>
      <circle cx="30" cy="30" r="3" fill="${c}"/><circle cx="0" cy="0" r="3" fill="${c}"/><circle cx="60" cy="60" r="3" fill="${c}"/><circle cx="60" cy="0" r="3" fill="${c}"/><circle cx="0" cy="60" r="3" fill="${c}"/>`,
    linen: `<rect width="60" height="60" fill="${a}"/>
      <g stroke="${b}" stroke-width=".8" opacity=".5">
        <path d="M0 3h60M0 9h60M0 15h60M0 21h60M0 27h60M0 33h60M0 39h60M0 45h60M0 51h60M0 57h60"/>
        <path d="M4 0v60M12 0v60M20 0v60M28 0v60M36 0v60M44 0v60M52 0v60" opacity=".7"/>
      </g>
      <path d="M8 12h14M30 34h18M5 48h10" stroke="${c}" stroke-width="1.6" opacity=".6"/>`,
    silk: `<rect width="60" height="60" fill="${a}"/>
      <path d="M0 60 L60 0" stroke="${b}" stroke-width="10" opacity=".18"/>
      <path d="M-30 60 L30 0M30 60 L90 0" stroke="${c}" stroke-width="3" opacity=".12"/>`,
    plain: `<rect width="60" height="60" fill="${a}"/>
      <g stroke="${b}" stroke-width="1.2" opacity=".35">
        <path d="M-6 6 l12 -12M-6 18 l24 -24M-6 30 l36 -36M-6 42 l48 -48M-6 54 l60 -60M-6 66 l72 -72M6 66 l60 -60M18 66 l48 -48M30 66 l36 -36M42 66 l24 -24M54 66 l12 -12"/>
      </g>`
  };
  const body = tile[kind] || tile.plain;
  const sheen = kind === "silk" ? `<linearGradient id="sh" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset=".45" stop-color="#fff" stop-opacity=".35"/>
      <stop offset=".55" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>` : "";
  // Soft light and shadow bands make the "draped" view look like hanging cloth
  const folds = view === 2 ? `<linearGradient id="fold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".18" stop-color="#fff" stop-opacity=".18"/>
      <stop offset=".34" stop-color="#000" stop-opacity=".3"/><stop offset=".52" stop-color="#fff" stop-opacity=".22"/>
      <stop offset=".7" stop-color="#000" stop-opacity=".28"/><stop offset=".86" stop-color="#fff" stop-opacity=".15"/>
      <stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <defs>
      <pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="scale(${scale}) rotate(${view === 2 ? 4 : 0})">${body}</pattern>
      ${sheen}${folds}
      <radialGradient id="v" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>
    </defs>
    <rect width="400" height="400" fill="url(#p)"/>
    ${sheen ? `<rect width="400" height="400" fill="url(#sh)"/>` : ""}
    ${folds ? `<rect width="400" height="400" fill="url(#fold)"/>` : ""}
    <rect width="400" height="400" fill="url(#v)"/>
  </svg>`;
}

// "logo:<initials>:<colour>" → a round badge with the shop's initials
function logoSVG(ref) {
  const [, initials, colour] = ref.split(":");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
    <rect width="120" height="120" rx="60" fill="#${colour || "1e2a44"}"/>
    <circle cx="60" cy="60" r="50" fill="none" stroke="#c9a24a" stroke-width="3"/>
    <text x="60" y="73" font-family="Georgia, serif" font-size="40" font-weight="700" fill="#f3ead1" text-anchor="middle">${escapeHtml(initials || "?")}</text>
  </svg>`;
}

function initialsOf(name) {
  return String(name || "?").split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w[0] || "")).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}
