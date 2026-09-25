// ============================================================
// tailors.js — Find tailors near me, each tailor's public page,
// and "Join as a tailor"
//
// Search: "Use my current location" (the browser asks permission), or
// search by country, city and postcode/area. Filters: distance, speciality,
// delivery, custom tailoring, minimum rating; sort by distance or rating.
// Live mode asks the database (wearvia_search_tailors), which does the
// distance maths and paging itself; the demo does the same in the browser.
// Tailors who hide their address are only ever placed to about 1 km.
// ============================================================

const WIDE_SCREENS = ["tailors", "tailor", "joinTailor"];
const RADIUS_STEPS = [5, 10, 25, 50];                    // miles, or km — whichever the customer uses
const TAILORS_PAGE = 20;

const tailorCache = new Map();   // id → tailor from a search or page (live mode)
const tailorPages = new Map();   // slug → tailor, or "loading" / "missing"

const tailorSearch = {
  mode: null,          // "gps" or "manual"
  point: null,         // { lat, lng, label, source }
  status: "idle",      // idle · locating · searching · done · error
  message: "",
  locationProblem: "",
  country: "", city: "", area: "",
  radius: 10, specs: [], delivery: false, custom: false, minRating: 0, sort: "distance",
  results: [], total: 0, filtersOpen: false, usedText: false, run: 0
};

function searchUnit() {
  return Geo.unit(tailorSearch.country);
}

// ---- The search page ----

function screenTailors() {
  const s = tailorSearch;
  if (!s.country && db.session.customerId === null && !s.mode) s.country = "";
  const u = searchUnit();
  const unitWord = u === "mi" ? "miles" : "km";
  const busy = s.status === "locating" || s.status === "searching";
  const chip = (on, label, action, pressed) => `<button type="button" class="optbtn ${on ? "sel" : ""}" ${pressed ? `aria-pressed="${on}"` : ""} onclick="${action}">${label}</button>`;
  const activeFilters = s.specs.length + (s.delivery ? 1 : 0) + (s.custom ? 1 : 0) + (s.minRating ? 1 : 0);

  return `
    ${cTop("Find tailors near me", "home")}
    <div class="content tailor-search">
      <p class="meta">Tailors and designers on ${APP_NAME}, nearest first. Tap one to see their work and request a quote.</p>
      <button type="button" class="cta locate-btn" onclick="searchNearMe()" ${busy ? "disabled" : ""}>
        ${s.status === "locating" ? `<span class="gen-spin"></span> Finding you…` : `<span aria-hidden="true">📍</span> Use my current location`}</button>
      ${s.locationProblem ? `<div class="notice warn" role="alert">${escapeHtml(s.locationProblem)}</div>` : ""}

      <details class="card-lite place-search" ${!s.mode || s.mode === "manual" || s.locationProblem || s.placeOpen ? "open" : ""} >
      <summary onclick="tailorSearch.placeOpen=!this.parentElement.open">${s.locationProblem ? "Search by place instead" : "Or search by country, city or postcode"}</summary>
      <form class="search-form stack" onsubmit="return searchManually(event)">
        <label class="field">Country<select name="country" onchange="tailorSearch.country=this.value">${countryOptions(s.country, "Any country")}</select></label>
        <div class="form-pair">
          <label class="field">City or town<input name="city" value="${escapeHtml(s.city)}" placeholder="e.g. London" autocomplete="address-level2"></label>
          <label class="field">Postcode or area<input name="area" value="${escapeHtml(s.area)}" placeholder="e.g. SE15 or Lekki" autocomplete="postal-code"></label>
        </div>
        <button type="submit" class="btn-outline" ${busy ? "disabled" : ""}>${s.status === "searching" && s.mode === "manual" ? "Searching…" : "Search"}</button>
      </form>
      </details>

      <details class="card-lite filters" ${s.filtersOpen ? "open" : ""}>
        <summary onclick="tailorSearch.filtersOpen=!this.parentElement.open">Filters &amp; sorting ${activeFilters ? `<span class="chat-badge">${activeFilters}</span>` : ""}</summary>
        <div class="filter-row"><span class="fl">Distance</span><span class="optbtns">
          ${RADIUS_STEPS.map(r => chip(s.radius === r, `${r} ${unitWord}`, `setTailorFilter('radius', ${r})`)).join("")}</span></div>
        <div class="filter-row"><span class="fl">Speciality <small>(any of)</small></span><span class="optbtns">
          ${specialityList().map(sp => chip(s.specs.includes(sp.name), escapeHtml(sp.name), `toggleTailorSpec(${escapeHtml(JSON.stringify(sp.name))})`, true)).join("")}</span></div>
        <div class="filter-row"><span class="optbtns">
          ${chip(s.delivery, "🚚 Delivers", "setTailorFilter('delivery', " + !s.delivery + ")", true)}
          ${chip(s.custom, "✂️ Custom tailoring", "setTailorFilter('custom', " + !s.custom + ")", true)}</span></div>
        <div class="filter-row"><span class="fl">Rating</span><span class="optbtns">
          ${[0, 3, 4, 4.5].map(r => chip(s.minRating === r, r ? `${r}★ +` : "Any", `setTailorFilter('minRating', ${r})`)).join("")}</span></div>
        <div class="filter-row"><span class="fl">Sort by</span><span class="optbtns">
          ${chip(s.sort === "distance", "Nearest", "setTailorFilter('sort', 'distance')")}${chip(s.sort === "rating", "Best rated", "setTailorFilter('sort', 'rating')")}</span></div>
        <div class="filter-row"><span class="fl">Show distances in</span><span class="optbtns">
          ${chip(u === "mi", "Miles", "setTailorUnit('mi')")}${chip(u === "km", "Kilometres", "setTailorUnit('km')")}</span></div>
        ${activeFilters ? `<button type="button" class="linkish" onclick="clearTailorFilters()">Clear filters</button>` : ""}
      </details>

      <div id="tailor-results" aria-live="polite" data-status="${s.status}">${tailorResultsHtml()}</div>
      <button type="button" class="linkish" onclick="go('joinTailor')">Are you a tailor or designer? Join ${APP_NAME} →</button>
    </div>
    ${cNav("tailors")}`;
}

function tailorResultsHtml() {
  const s = tailorSearch;
  const u = searchUnit();
  if (s.status === "idle") {
    return `<div class="empty">Tap <b>Use my current location</b>, or search by country, city or postcode.</div>`;
  }
  if (s.status === "locating" || (s.status === "searching" && !s.loadingMore)) {
    return `<p class="auth-loading"><span class="gen-spin"></span>${s.status === "locating" ? "Finding your location…" : "Looking for tailors…"}</p>`;
  }
  if (s.status === "error") return `<div class="notice warn">${escapeHtml(s.message)}</div>`;

  const where = s.point ? (s.mode === "gps" ? "you" : s.point.label.split(",").slice(0, 2).join(",")) : "";
  const radiusText = `${s.radius} ${u === "mi" ? "miles" : "km"}`;
  const heading = s.total
    ? `${s.total} tailor${s.total === 1 ? "" : "s"}${s.point && !s.cityOnly ? ` within ${radiusText} of ${escapeHtml(where)}` : placeText()}`
    : "No tailors found";
  const credit = s.point && s.point.source === "nominatim" ? `<p class="osm-credit">${Geo.OSM_CREDIT}</p>` : "";
  const note = s.message ? `<p class="meta">${escapeHtml(s.message)}</p>` : "";

  if (!s.total) {
    const bigger = RADIUS_STEPS.find(r => r > s.radius);
    const filtered = s.specs.length || s.delivery || s.custom || s.minRating;
    return `<h2 class="results-head">${heading}</h2>${note}
      <div class="empty no-results">
        <p>Nobody matches yet${s.point && !s.cityOnly ? ` within ${radiusText}` : placeText()}. Try:</p>
        <div class="optbtns">
          ${s.point && !s.cityOnly && bigger ? `<button class="optbtn sel" onclick="setTailorFilter('radius', ${bigger})">Widen to ${bigger} ${u === "mi" ? "miles" : "km"}</button>` : ""}
          ${filtered ? `<button class="optbtn" onclick="clearTailorFilters()">Clear filters</button>` : ""}
          ${s.area ? `<button class="optbtn" onclick="tailorSearch.area='';searchManually()">Search the whole city</button>` : ""}
          ${s.city || s.area ? `<button class="optbtn" onclick="tailorSearch.city='';tailorSearch.area='';searchManually()">Search the whole country</button>` : ""}
        </div>
        <p class="meta">New tailors join ${APP_NAME} every week.</p>
      </div>${credit}`;
  }
  return `<h2 class="results-head">${heading}</h2>${note}
    <div class="tailor-list">${s.results.map(t => tailorCardHtml(t, u)).join("")}</div>
    ${s.results.length < s.total ? `<button class="btn-outline" onclick="moreTailors()" ${s.status === "searching" ? "disabled" : ""}>Show more (${s.total - s.results.length} more)</button>` : ""}
    ${credit}`;
}

function placeText() {
  const s = tailorSearch;
  const country = countryByCode(s.country);
  const parts = [s.area, s.city, country ? country.name : ""].filter(Boolean);
  return parts.length ? ` in ${escapeHtml(parts.join(", "))}` : "";
}

// "Tailor A · 2.1 miles away · Agbada, Kaftan, Wedding outfits · ⭐ 4.8 (23 reviews)"
function tailorCardHtml(t, u) {
  const distance = t.distance_km != null ? `${Geo.formatDistance(t.distance_km, u)} away` : "";
  return `<a class="tailor-card" href="#/tailor/${encodeURIComponent(t.slug)}">
    <img class="tailor-logo" src="${escapeHtml(photoUrl(t.profile_image) || photoUrl(`logo:${initialsOf(t.business_name)}:1e2a44`))}" alt="" loading="lazy">
    <span class="tailor-card-text">
      <b>${escapeHtml(t.business_name)}</b>
      <span class="meta">${[distance, escapeHtml(tailorAreaText(t))].filter(Boolean).join(" · ")}</span>
      <span class="meta">${escapeHtml((t.speciality_tags || []).join(", ") || "Tailoring")}</span>
      <span class="tailor-card-foot"><span class="gold">${tailorRatingText(t)}</span>
        ${t.delivery_available ? `<span class="pill">Delivers</span>` : ""}${t.custom_orders ? `<span class="pill">Custom</span>` : ""}</span>
    </span>
    <span aria-hidden="true" class="chev">›</span>
  </a>`;
}

// ---- Searching ----

function searchNearMe() {
  const s = tailorSearch;
  s.mode = "gps";
  s.status = "locating";
  s.locationProblem = "";
  s.message = "";
  renderAll();
  Geo.locate()
    .then(point => {
      s.point = Object.assign(point, { label: "you", source: "gps" });
      s.cityOnly = false;
      runTailorSearch(true);
    })
    .catch(error => {
      s.status = s.results.length ? "done" : "idle";
      s.locationProblem = error.message;
      s.mode = null;
      renderAll();
      const box = document.querySelector(".search-form input[name=city]");
      if (box) box.focus();
    });
}

function searchManually(event) {
  if (event) event.preventDefault();
  const s = tailorSearch;
  const form = document.querySelector(".search-form");
  if (form && event) {
    s.country = form.country.value;
    s.city = form.city.value.trim();
    s.area = form.area.value.trim();
  }
  if (!s.country && !s.city && !s.area) {
    s.status = "error";
    s.message = "Choose a country, or type a city or postcode.";
    renderAll();
    return false;
  }
  s.mode = "manual";
  s.status = "searching";
  s.message = "";
  s.point = null;
  renderAll();
  const run = ++s.run;
  // A postcode or area is looked up on the map, so distance works; a city on its own
  // is matched by name and sorted by distance from its centre
  Geo.geocode({ country: s.country, city: s.city, postcode: s.area })
    .then(found => {
      if (run !== s.run) return;
      if (found) {
        s.point = found;
        s.cityOnly = !s.area;
        if (!s.city && found.city && !s.area) s.city = "";
      } else {
        s.cityOnly = false;
        if (s.area || s.city) s.message = "We couldn't find that place on the map, so these tailors match the name you typed.";
      }
      s.usedText = !found;
      runTailorSearch(true);
    });
  return false;
}

function searchParams(offset) {
  const s = tailorSearch;
  const u = searchUnit();
  const p = {
    specialities: s.specs, delivery: s.delivery, custom: s.custom, minRating: s.minRating, sort: s.sort,
    limit: TAILORS_PAGE, offset: offset || 0, country: s.country || null
  };
  if (s.point) {
    p.lat = s.point.lat;
    p.lng = s.point.lng;
    // A city on its own: everyone in that city, nearest the centre first
    p.radiusKm = s.cityOnly ? 500 : Geo.toKm(s.radius, u);
  }
  if (s.mode === "manual") {
    if (s.cityOnly || !s.point) p.city = s.city || null;
    if (!s.point) p.area = s.area || null;
  }
  if (s.mode === "gps") p.country = null;
  return p;
}

function runTailorSearch(fresh) {
  const s = tailorSearch;
  s.status = "searching";
  const run = ++s.run;
  const offset = fresh ? 0 : s.results.length;
  s.loadingMore = !fresh;
  const params = searchParams(offset);
  const work = Cloud.live ? Cloud.searchTailors(params) : Promise.resolve(demoSearchTailors(params));
  work.then(result => {
    if (run !== s.run) return;
    result.rows.forEach(t => tailorCache.set(t.id, t));
    s.results = fresh ? result.rows : s.results.concat(result.rows);
    s.total = result.total;
    s.status = "done";
    redrawTailorResults();
  }).catch(error => {
    if (run !== s.run) return;
    s.status = "error";
    s.message = error.message || "Couldn't search right now. Check your connection and try again.";
    redrawTailorResults();
  });
  redrawTailorResults();
}

// Only the results redraw, so the form keeps what's being typed
function redrawTailorResults() {
  const el = document.getElementById("tailor-results");
  if (el && currentRoute().screen === "tailors") {
    el.innerHTML = tailorResultsHtml();
    el.dataset.status = tailorSearch.status;
    const busy = tailorSearch.status === "locating" || tailorSearch.status === "searching";
    const button = document.querySelector(".locate-btn");
    if (button) {
      button.disabled = busy;
      button.innerHTML = `<span aria-hidden="true">📍</span> Use my current location`;
    }
    const search = document.querySelector(".search-form button[type=submit]");
    if (search) {
      search.disabled = busy;
      search.textContent = busy && tailorSearch.mode === "manual" ? "Searching…" : "Search";
    }
  } else {
    renderAll();
  }
}

function moreTailors() {
  runTailorSearch(false);
}

function setTailorFilter(key, value) {
  tailorSearch[key] = value;
  tailorSearch.filtersOpen = key !== "radius" || tailorSearch.filtersOpen;
  if (tailorSearch.mode) runTailorSearch(true);
  renderAll();
}

function toggleTailorSpec(name) {
  const specs = tailorSearch.specs;
  tailorSearch.specs = specs.includes(name) ? specs.filter(x => x !== name) : specs.concat(name);
  tailorSearch.filtersOpen = true;
  if (tailorSearch.mode) runTailorSearch(true);
  renderAll();
}

function setTailorUnit(u) {
  const before = searchUnit();
  Geo.setUnit(u);
  if (before !== u) {
    // Keep roughly the same distance: 10 miles ↔ 25 km (the nearest step)
    const km = Geo.toKm(tailorSearch.radius, before);
    tailorSearch.radius = RADIUS_STEPS.reduce((best, r) => Math.abs(Geo.toKm(r, u) - km) < Math.abs(Geo.toKm(best, u) - km) ? r : best, RADIUS_STEPS[0]);
    if (tailorSearch.mode) runTailorSearch(true);
  }
  tailorSearch.filtersOpen = true;
  renderAll();
}

function clearTailorFilters() {
  Object.assign(tailorSearch, { specs: [], delivery: false, custom: false, minRating: 0, sort: "distance" });
  if (tailorSearch.mode) runTailorSearch(true);
  renderAll();
}

// ---- A tailor's public page ----

function findTailorBySlug(slug) {
  if (!Cloud.live) {
    const d = db.designers.find(x => x.slug === slug);
    return d && (d.admin_status === "approved" || inBusiness()) ? d : d ? "missing" : "missing";
  }
  const cached = tailorPages.get(slug);
  if (cached) return cached;
  tailorPages.set(slug, "loading");
  Cloud.tailorPage(slug)
    .then(d => { tailorPages.set(slug, d || "missing"); if (d) tailorCache.set(d.id, d); })
    .catch(() => tailorPages.set(slug, "missing"))
    .finally(() => { if (currentRoute().screen === "tailor") renderAll(); });
  return "loading";
}

function screenTailorPage(slug) {
  const d = findTailorBySlug(slug);
  if (d === "loading") return `${cTop("Tailor", "tailors")}<div class="content"><p class="auth-loading"><span class="gen-spin"></span>Loading…</p></div>${cNav("tailors")}`;
  if (!d || d === "missing") {
    return `${cTop("Tailor not found", "tailors")}<div class="content"><div class="empty">We couldn't find that tailor. They may not be on ${APP_NAME} any more.</div>
      <button class="cta" onclick="go('tailors')">Find tailors near me</button></div>${cNav("tailors")}`;
  }
  const u = Geo.unit(d.country_code);
  const s = tailorSearch;
  const km = s.point && d.public_latitude != null ? Geo.distanceKm(s.point.lat, s.point.lng, d.public_latitude, d.public_longitude) : null;
  const reviews = Cloud.live ? d.page_reviews || [] : recentReviews(5, d.id);
  const rtw = !Cloud.live ? rtwOf(d.id) : [];
  const country = countryByCode(d.country_code);
  const link = new URL(`tailor/${d.slug}/`, location.href.split("#")[0]).href;
  const canOrder = d.admin_status === "approved" && d.custom_orders !== false;

  return `
    ${cTop(escapeHtml(d.business_name), "tailors")}
    <div class="content tailor-page">
      ${d.admin_status !== "approved" ? `<div class="notice warn">Only you can see this page: it's ${escapeHtml((TAILOR_STATUS_LABELS[d.admin_status] || "").toLowerCase())}.</div>` : ""}
      <div class="tailor-hero">
        <img class="tailor-logo big" src="${escapeHtml(photoUrl(d.profile_image) || photoUrl(`logo:${initialsOf(d.business_name)}:1e2a44`))}" alt="${escapeHtml(d.business_name)} logo">
        <div>
          <h1 class="tailor-name">${escapeHtml(d.business_name)}</h1>
          <div class="gold">${tailorRatingText(d)}</div>
          <div class="meta">${country ? country.flag + " " : ""}${escapeHtml(tailorAreaText(d))}${km != null ? ` · <b>${Geo.formatDistance(km, u)} from ${s.mode === "gps" ? "you" : "your search"}</b>` : ""}</div>
          <div class="badges">
            ${d.delivery_available ? `<span class="pill">🚚 Delivery available</span>` : `<span class="pill muted-pill">Collection only</span>`}
            ${d.custom_orders ? `<span class="pill">✂️ Custom orders</span>` : `<span class="pill muted-pill">No custom orders right now</span>`}
          </div>
        </div>
      </div>
      ${canOrder ? `<button class="cta" id="request-quote" onclick="requestQuoteFrom('${d.id}')">Request a quote</button>
        <p class="meta centre">Choose your design, add style photos and measurements, pick a fabric, then send it to ${escapeHtml(d.business_name)}. Nothing to pay until you accept their quote.</p>`
        : `<div class="notice">${escapeHtml(d.business_name)} isn't taking custom orders on ${APP_NAME} right now.</div>`}
      ${d.description ? `<p class="tailor-about">${escapeHtml(d.description)}</p>` : ""}
      ${(d.speciality_tags || []).length ? `<div><b>Specialities</b><div class="spec-tags">${d.speciality_tags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("")}</div></div>` : ""}
      ${(d.portfolio || []).length ? `<div><b>Portfolio</b><div class="portfolio-grid">${d.portfolio.map((p, i) => `
        <button type="button" class="portfolio-item" onclick="openPortfolio('${d.id}', ${i})" aria-label="Open photo ${i + 1}${p.title ? ": " + escapeHtml(p.title) : ""}">
          <img src="${escapeHtml(photoUrl(p.image))}" alt="${escapeHtml(p.title || "Portfolio photo")}" loading="lazy">${p.title ? `<span>${escapeHtml(p.title)}</span>` : ""}</button>`).join("")}</div></div>` : ""}
      ${(d.services || []).length ? `<div><b>Services</b>${d.services.map(sv => `<div class="qline"><span>${escapeHtml(sv.name)}</span><span>${sv.price != null ? money(sv.price) : ""}</span></div>`).join("")}</div>` : ""}
      <div class="mrow"><span>Usual making time</span><span>${escapeHtml(d.delivery_time || "7–14 days")}</span></div>
      <div><b>Reviews</b>${reviews.length ? reviews.map(r => `<div class="review"><span class="gold">${"★".repeat(r.rating)}</span> ${escapeHtml(r.text || r.outfit || "")}<div class="fl">${escapeHtml(r.who || "A customer")}${r.outfit ? " · " + escapeHtml(r.outfit) : ""}</div></div>`).join("")
        : `<p class="meta">No reviews yet — reviews appear after a customer's outfit is delivered.</p>`}</div>
      ${rtw.length ? `<button class="btn-outline" onclick="go('rtw/${d.id}')">View ready to wear (${rtw.length})</button>` : ""}
      <div class="share-row"><span class="meta">Public profile</span> <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link.replace(/^https?:\/\//, ""))}</a>
        <button type="button" class="optbtn" onclick="copyTailorLink('${escapeHtml(link)}')">Copy link</button></div>
    </div>
    ${cNav("tailors")}`;
}

function openPortfolio(designerId, index) {
  const d = designerById(designerId) || tailorCache.get(designerId);
  if (!d) return;
  styleViewer = { photos: d.portfolio.map(p => p.image), index, title: d.business_name, returnFocus: document.activeElement };
  document.addEventListener("keydown", styleViewerKeys);
  drawStyleViewer();
}

function copyTailorLink(link) {
  if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast("Link copied."), () => toast(link));
  else toast(link);
}

// "Request a quote": the usual order flow, sent to THIS tailor
function requestQuoteFrom(designerId) {
  const d = designerById(designerId) || tailorCache.get(designerId);
  if (!d) return;
  if (Cloud.live && !Cloud.me) {
    // Sign in (or create an account) first, then come back to this tailor
    try { sessionStorage.setItem("wearvia-after-sign-in", "tailor/" + d.slug); } catch (e) { /* private browsing */ }
    Auth.flash(`Sign in or create a free account to request a quote from ${d.business_name}.`);
    Auth.show("signIn");
    return;
  }
  const current = db.draft;
  if (current && current.designerId && current.designerId !== d.id && current.designDone
      && !confirm(`Send your ${current.outfit} order to ${d.business_name} instead of ${designerName(current.designerId)}? Your choices are kept.`)) return;
  if (!db.designers.some(x => x.id === d.id)) db.designers.push(Object.assign({}, d, { from_search: true }));
  draft().designerId = d.id;
  const button = document.getElementById("request-quote");
  if (button) { button.disabled = true; button.textContent = "Opening…"; }
  Promise.resolve(Cloud.live ? Cloud.ensurePrices(d.id) : null).then(() => {
    saveData();
    flashMessage = "";
    go("outfit");
  });
}

// ---- Join as a tailor (for someone already signed in, or in the demo) ----

function screenJoinTailor() {
  if (Cloud.live && !Cloud.me) {
    return `${cTop("Join as a tailor", "tailors")}<div class="content">
      <p>Create an account and choose <b>I'm a tailor or designer</b>.</p>
      <button class="cta" onclick="Auth.startSignUp('designer')">Create a tailor account</button></div>`;
  }
  const mine = Cloud.live ? (Cloud.me.designers || []).find(x => x.is_owner) : null;
  if (mine) {
    return `${cTop("Join as a tailor", "tailors")}<div class="content">
      <div class="notice">You already have a tailor business: <b>${escapeHtml(mine.business_name)}</b>.</div>
      <button class="cta" onclick="go('biz/profile')">Open my Business dashboard</button></div>`;
  }
  return `
    ${cTop("Join as a tailor", "tailors")}
    <div class="content">
      <p>Get found by customers near you. Your ${APP_NAME} dashboard handles quote requests, the chat with each customer, orders, payments and your team.</p>
      <ol class="join-steps"><li>Tell us your business name and where you are.</li><li>Add your photo, specialities and portfolio in <b>My profile</b>.</li><li>The ${APP_NAME} team checks and approves you — then customers can find you.</li></ol>
      <form class="stack" onsubmit="return joinAsTailor(event)">
        <label class="field">Business name<input name="business" required minlength="2" maxlength="80" placeholder="e.g. Ade's Tailoring"></label>
        <label class="field">Country<select name="country" required>${countryOptions("", "Choose your country")}</select></label>
        <label class="field">City or town<input name="city" required maxlength="60" placeholder="e.g. Manchester"></label>
        <label class="field">Phone <small>(only the ${APP_NAME} team sees it)</small><input name="phone" type="tel" maxlength="20"></label>
        <p id="join-error" class="form-error" role="alert"></p>
        <button class="cta" type="submit">Create my tailor profile</button>
      </form>
    </div>`;
}

function joinAsTailor(event) {
  event.preventDefault();
  const form = event.target;
  const details = { businessName: form.business.value.trim(), country: form.country.value, city: form.city.value.trim(), phone: form.phone.value.trim() };
  if (details.businessName.length < 2) return formError("join-error", "Enter your business name.");
  if (!details.country) return formError("join-error", "Choose your country.");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Creating…";
  if (Cloud.live) {
    Cloud.registerDesigner(details)
      .then(() => { Auth.drawChrome(); toast("Your tailor profile is made. Add your photo and details, then wait for approval."); go("biz/profile"); })
      .catch(error => { button.disabled = false; button.textContent = "Create my tailor profile"; formError("join-error", error.message); });
    return false;
  }
  // Demo: a new tailor, waiting for the admin (you) to approve it in Business → Tailors
  const id = "D" + (db.designers.reduce((max, d) => Math.max(max, Number(String(d.id).slice(1)) || 0), 0) + 1);
  const d = refreshDesignerPublic({
    id, business_name: details.businessName, country_code: details.country, city: details.city, postcode: "", address_line: "",
    latitude: null, longitude: null, show_exact_address: false, speciality_tags: [], delivery_available: false, custom_orders: true,
    rating: null, review_count: 0, profile_image: null, description: "", delivery_time: "7–14 days", admin_status: "pending",
    admin_note: "", portfolio: [], phone: details.phone, location: "", demo: true
  });
  db.designers.push(d);
  db.prices = db.prices.concat(newPriceListFor(id));
  db.session.designerId = id;
  saveData();
  toast(`${d.business_name} created. It waits for approval in Business → Tailors.`);
  go("biz/profile");
  return false;
}
