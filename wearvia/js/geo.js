// ============================================================
// geo.js — where things are: the customer's location, distances,
// miles or km, and turning a postcode or address into a map position
//
// Looking up a position (geocoding):
//   • UK postcodes: api.postcodes.io — free, no key. A full postcode
//     ("SE15 4QN") or just the district ("SE15").
//   • Everywhere else (and UK addresses without a postcode):
//     OpenStreetMap Nominatim. Its usage policy asks for at most one request
//     a second, results cached, no bulk use, and credit to OpenStreetMap —
//     so requests wait in a queue, one at a time, a second apart; every
//     answer is kept in this browser; and wherever a Nominatim result is
//     used the page shows "© OpenStreetMap contributors".
// ============================================================

const Geo = (() => {
  const CACHE_KEY = "wearvia-geocode-v1";
  const UNIT_KEY = "wearvia-distance-unit";
  const KM_PER_MILE = 1.609344;
  const OSM_CREDIT = `Locations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>`;
  let cache = null;
  let nominatimQueue = Promise.resolve();
  let lastNominatim = 0;

  // ---- Distances ----

  function distanceKm(lat1, lng1, lat2, lng2) {
    const rad = x => x * Math.PI / 180;
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
      + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
    return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Where the browser is: from its language ("en-GB"), or else its time zone
  function browserRegion() {
    const fromLanguage = (navigator.languages || [navigator.language || ""]).map(l => (l.split("-")[1] || "").toUpperCase()).find(r => /^[A-Z]{2}$/.test(r));
    if (fromLanguage) return fromLanguage;
    let zone = "";
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* old browser */ }
    if (/^Europe\/(London|Belfast)$/.test(zone)) return "GB";
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana|Kentucky|North_Dakota)|^Pacific\/Honolulu$/.test(zone)) return "US";
    if (zone === "Africa/Lagos") return "NG";
    return "";
  }

  // "miles" in the UK and US, "km" elsewhere — until the customer picks one
  function defaultUnit(countryCode) {
    const country = countryCode ? countryByCode(countryCode) : null;
    if (country) return country.uses_miles ? "mi" : "km";
    return ["GB", "US"].includes(browserRegion()) ? "mi" : "km";
  }

  function unit(countryCode) {
    try { const saved = localStorage.getItem(UNIT_KEY); if (saved === "mi" || saved === "km") return saved; } catch (e) { /* private browsing */ }
    return defaultUnit(countryCode);
  }

  function setUnit(value) {
    try { localStorage.setItem(UNIT_KEY, value); } catch (e) { /* private browsing */ }
  }

  function toKm(value, u) { return u === "mi" ? value * KM_PER_MILE : value; }
  function fromKm(km, u) { return u === "mi" ? km / KM_PER_MILE : km; }

  // "2.1 miles away" / "850 m away" / "12 km away"
  function formatDistance(km, u) {
    if (km == null || isNaN(km)) return "";
    if (u === "mi") {
      const miles = km / KM_PER_MILE;
      return miles < 0.1 ? "less than 0.1 miles" : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mile${miles >= 0.95 && miles < 1.05 ? "" : "s"}`;
    }
    return km < 1 ? `${Math.max(100, Math.round(km * 10) * 100)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
  }

  // ---- The customer's location (the browser asks for permission) ----

  function locate() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Your browser can't share your location. Search by country, city or postcode instead."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }),
        error => reject(new Error(error.code === 1
          ? "Location is switched off for this site, so we can't see where you are. Search by country, city or postcode below — or allow location in your browser settings and try again."
          : error.code === 3
            ? "Finding your location took too long. Try again, or search by country, city or postcode below."
            : "We couldn't find your location. Search by country, city or postcode below.")),
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 });
    });
  }

  // ---- Looking up positions ----

  function readCache() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (e) { cache = {}; }
    return cache;
  }

  function writeCache(key, value) {
    const all = readCache();
    all[key] = Object.assign({ at: Date.now() }, value);
    // Keep the newest 300 answers
    const keys = Object.keys(all);
    if (keys.length > 300) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 300).forEach(k => { delete all[k]; });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch (e) { /* storage full: just not kept */ }
  }

  const UK_FULL = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i;
  const UK_DISTRICT = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/i;

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("lookup failed: " + response.status);
    return response.json();
  }

  async function postcodesIo(postcode) {
    const clean = postcode.trim().toUpperCase().replace(/\s+/g, " ");
    const full = UK_FULL.test(clean);
    const url = full
      ? "https://api.postcodes.io/postcodes/" + encodeURIComponent(clean.replace(/\s/g, ""))
      : "https://api.postcodes.io/outcodes/" + encodeURIComponent(clean);
    const data = await fetchJson(url);
    const r = data && data.result;
    if (!r || r.latitude == null) return null;
    const town = full ? (r.admin_district || r.parish || "") : ((r.admin_district || [])[0] || "");
    return { lat: r.latitude, lng: r.longitude, label: `${full ? r.postcode : r.outcode}${town ? ", " + town : ""}`, source: "postcodes.io", city: town };
  }

  // One Nominatim request at a time, at least 1.1 seconds apart
  function nominatim(params) {
    const run = async () => {
      const wait = lastNominatim + 1100 - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      lastNominatim = Date.now();
      const query = new URLSearchParams(Object.assign({ format: "jsonv2", limit: "1", addressdetails: "1" }, params));
      const data = await fetchJson("https://nominatim.openstreetmap.org/search?" + query.toString());
      const r = data && data[0];
      if (!r) return null;
      const a = r.address || {};
      return { lat: Number(r.lat), lng: Number(r.lon), label: r.display_name, source: "nominatim",
               city: a.city || a.town || a.village || a.county || a.state || "" };
    };
    const next = nominatimQueue.then(run, run);
    nominatimQueue = next.catch(() => {});
    return next;
  }

  // { country: "GB", city, postcode, address } → { lat, lng, label, source } or null
  async function geocode(where) {
    const country = (where.country || "").toUpperCase();
    const postcode = (where.postcode || "").trim();
    const city = (where.city || "").trim();
    const address = (where.address || "").trim();
    if (!postcode && !city && !address) return null;
    const key = [country, postcode.toUpperCase(), city.toLowerCase(), address.toLowerCase()].join("|");
    const cached = readCache()[key];
    if (cached) return cached.miss ? null : cached;

    let found = null;
    if ((country === "GB" || !country) && postcode && (UK_FULL.test(postcode) || UK_DISTRICT.test(postcode.replace(/\s/g, "")))) {
      found = await postcodesIo(postcode).catch(() => null);
    }
    if (!found) {
      const params = {};
      if (country) params.countrycodes = country.toLowerCase();
      if (address || (postcode && !UK_FULL.test(postcode))) {
        params.q = [address, postcode, city, country ? (countryByCode(country) || {}).name : ""].filter(Boolean).join(", ");
      } else if (postcode) {
        params.postalcode = postcode;
        if (city) params.city = city;
      } else {
        params.city = city;
      }
      found = await nominatim(params).catch(() => null);
      // A postcode Nominatim doesn't know: try the city on its own
      if (!found && city && (postcode || address)) {
        found = await nominatim(Object.assign(country ? { countrycodes: country.toLowerCase() } : {}, { city })).catch(() => null);
        if (found) found.approximate = true;
      }
    }
    writeCache(key, found || { miss: true });
    return found;
  }

  return { browserRegion, distanceKm, formatDistance, defaultUnit, unit, setUnit, toKm, fromKm, locate, geocode, OSM_CREDIT, KM_PER_MILE };
})();
