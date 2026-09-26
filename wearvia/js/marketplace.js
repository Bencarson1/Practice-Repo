// ============================================================
// marketplace.js — the Fabric Marketplace customers browse:
// a photo grid of every approved fabric from every seller, with
// filters, and a page for each fabric with all its photos.
// Used on its own (#/market) and as step 4 of an order (#/fabric).
// ============================================================

let marketFilters = { search: "", type: "All", colour: "All", price: "any", seller: "All", sort: "new", inStock: false };
let marketFiltersOpen = false;
let marketMode = "browse"; // "browse" or "flow" — which screen the grid is on

function setMarketFilter(key, value) {
  marketFilters[key] = value;
  renderAll();
}

function clearMarketFilters() {
  marketFilters = { search: "", type: "All", colour: "All", price: "any", seller: "All", sort: "new", inStock: false };
  renderAll();
}

// Typing in the search box only redraws the results, so the keyboard stays open
function searchMarket(value) {
  marketFilters.search = value;
  const results = document.getElementById("market-results");
  if (results) results.innerHTML = marketResults();
}

function extraFilterCount() {
  const f = marketFilters;
  return [f.colour !== "All", f.price !== "any", f.seller !== "All", f.inStock].filter(Boolean).length;
}

function marketFilterBar() {
  const f = marketFilters;
  const onMarket = activeFabrics().filter(isOnMarket);
  const types = ["All"].concat(FABRIC_TYPES.filter(t => onMarket.some(x => x.category === t)));
  const colours = FABRIC_COLOURS.filter(c => onMarket.some(x => x.colour_name === c.name));
  const sellers = db.suppliers.filter(s => onMarket.some(x => x.supplier_id === s.id)).sort((a, b) => a.name.localeCompare(b.name));
  const option = (value, label, current) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(label)}</option>`;
  const count = extraFilterCount();
  return `
    <div class="market-search">
      <input type="search" placeholder="Search fabrics, colours, sellers…" aria-label="Search fabrics" value="${escapeHtml(f.search)}" oninput="searchMarket(this.value)">
      <button type="button" class="optbtn ${marketFiltersOpen || count ? "sel" : ""}" onclick="marketFiltersOpen=!marketFiltersOpen;renderAll()" aria-expanded="${marketFiltersOpen}">Filters${count ? ` (${count})` : ""}</button>
    </div>
    <div class="optbtns scroll" role="group" aria-label="Fabric type">${types.map(t =>
      `<button class="optbtn ${f.type === t ? "sel" : ""}" onclick="setMarketFilter('type','${escapeHtml(t)}')">${escapeHtml(t)}</button>`).join("")}</div>
    ${marketFiltersOpen ? `
      <div class="market-filters">
        <label class="field">Colour<select onchange="setMarketFilter('colour',this.value)">${option("All", "Any colour", f.colour)}${colours.map(c => option(c.name, c.name, f.colour)).join("")}</select></label>
        <label class="field">Price per yard<select onchange="setMarketFilter('price',this.value)">${PRICE_BANDS.map(p => option(p.key, p.label, f.price)).join("")}</select></label>
        <label class="field">Seller<select onchange="setMarketFilter('seller',this.value)">${option("All", "All sellers", f.seller)}${sellers.map(s => option(s.id, s.name, f.seller)).join("")}</select></label>
        <label class="field">Sort by<select onchange="setMarketFilter('sort',this.value)">${MARKET_SORTS.map(s => option(s.key, s.label, f.sort)).join("")}</select></label>
        <label class="check"><input type="checkbox" ${f.inStock ? "checked" : ""} onchange="setMarketFilter('inStock',this.checked)"> In stock only</label>
        <button type="button" class="linkish" onclick="clearMarketFilters()">Clear all</button>
      </div>` : ""}`;
}

function fabricTile(fabric, selectedId) {
  const seller = findSupplier(fabric.supplier_id);
  const soldOut = isSoldOut(fabric);
  const low = !soldOut && fabric.yards_available < LOW_STOCK_YARDS;
  const photos = fabricPhotoRefs(fabric).length;
  return `<button class="mtile ${fabric.id === selectedId ? "sel" : ""} ${soldOut ? "is-out" : ""}" onclick="go('fabricView/${fabric.id}')">
    <span class="mphoto">
      <img src="${fabricCoverUrl(fabric)}" alt="${escapeHtml(fabric.name)}" loading="lazy">
      ${soldOut ? `<span class="ribbon">Sold out</span>` : ""}
      ${photos > 1 ? `<span class="pcount" aria-label="${photos} photos">▣ ${photos}</span>` : ""}
      ${fabric.id === selectedId ? `<span class="picked">✓ Chosen</span>` : ""}
    </span>
    <span class="mname">${escapeHtml(fabric.name)}</span>
    <span class="mprice">${money(fabric.price_per_yard)}<small> / yard</small></span>
    <span class="mseller">${escapeHtml(seller ? seller.name : "Seller")}</span>
    <span class="mstock ${low ? "low" : ""}">${soldOut ? "Sold out" : `${fabric.yards_available} yd left`}</span>
  </button>`;
}

function marketResults() {
  const list = marketFabrics(marketFilters);
  const selectedId = marketMode === "flow" ? draft().fabricId : null;
  if (!list.length) {
    return `<div class="empty">No fabrics match. <button class="linkish" onclick="clearMarketFilters()">Clear filters</button></div>`;
  }
  return `<div class="meta">${list.length} fabric${list.length === 1 ? "" : "s"} from ${new Set(list.map(f => f.supplier_id)).size} seller${new Set(list.map(f => f.supplier_id)).size === 1 ? "" : "s"}</div>
    <div class="mgrid">${list.map(f => fabricTile(f, selectedId)).join("")}</div>`;
}

// ---- #/market — browse without starting an order ----

function screenMarket() {
  marketMode = "browse";
  return `
    ${cTop("Fabric Marketplace", "home")}
    <div class="content">
      <div class="meta">Fabrics from independent sellers, checked by NebedaHub. Tap a fabric to see every photo.</div>
      ${marketFilterBar()}
      <div id="market-results" class="stack">${marketResults()}</div>
    </div>
    ${cNav("market")}`;
}

// ---- #/fabricView/F12 — one fabric, all its photos ----

// True when the customer is on step 4 of an order and can pick a fabric now
function choosingFabricForOrder() {
  const d = db.draft;
  return !!(d && d.designDone && d.conceptApproved && d.profileId);
}

function screenFabricView(fabricId) {
  const fabric = findFabric(fabricId);
  if (!fabric || !isOnMarket(fabric)) {
    return `${cTop("Fabric", "market")}<div class="content"><div class="empty">This fabric isn't on the marketplace any more.</div>
      <button class="cta" onclick="go('market')">Browse fabrics</button></div>${cNav("market")}`;
  }
  const seller = findSupplier(fabric.supplier_id);
  const refs = fabricPhotoRefs(fabric);
  const soldOut = isSoldOut(fabric);
  const inFlow = choosingFabricForOrder();
  const d = db.draft;
  let action;
  if (soldOut) {
    action = `<button class="cta" disabled>Sold out</button>`;
  } else if (inFlow) {
    action = `<button class="cta" onclick="chooseMarketFabric('${fabric.id}')">${d.fabricId === fabric.id ? "✓ Chosen — continue" : "Choose this fabric"} →</button>
      <div class="meta">Your tailor works out how many yards you need with you. Nothing is bought until you accept their quote.</div>`;
  } else {
    action = `<button class="cta" onclick="chooseMarketFabric('${fabric.id}')">Design an outfit in this fabric →</button>`;
  }
  const others = sellerFabrics(fabric.supplier_id).filter(f => f.id !== fabric.id && isOnMarket(f)).slice(0, 4);
  return `
    ${cTop(escapeHtml(fabric.name), inFlow ? "fabric" : "market")}
    <div class="content">
      <div class="gallery-wrap">
        <div class="gallery" id="gallery" onscroll="galleryScrolled(this)" aria-label="Photos of ${escapeHtml(fabric.name)}">
          ${refs.map((ref, i) => `<img src="${photoUrl(ref)}" alt="${escapeHtml(fabric.name)}, photo ${i + 1} of ${refs.length}">`).join("")}
        </div>
        ${soldOut ? `<span class="ribbon">Sold out</span>` : ""}
      </div>
      ${refs.length > 1 ? `<div class="gallery-thumbs">${refs.map((ref, i) =>
        `<button class="${i === 0 ? "on" : ""}" onclick="showPhoto(${i})" aria-label="Show photo ${i + 1}"><img src="${photoUrl(ref)}" alt=""></button>`).join("")}</div>` : ""}
      <div class="row-between"><span class="name big">${escapeHtml(fabric.name)}</span><span class="price big">${money(fabric.price_per_yard)} / yd</span></div>
      <div class="tags">
        <span class="tag">${escapeHtml(fabric.category)}</span>
        <span class="tag"><span class="dot" style="background:${escapeHtml(fabric.color)}"></span>${escapeHtml(fabric.colour_name)}</span>
        <span class="tag ${soldOut ? "low" : fabric.yards_available < LOW_STOCK_YARDS ? "low" : ""}">${soldOut ? "Sold out" : `${fabric.yards_available} yd in stock`}</span>
        ${fabric.min_order_yards > 1 ? `<span class="tag">Min ${fabric.min_order_yards} yd</span>` : ""}
      </div>
      ${fabric.description ? `<p class="desc">${escapeHtml(fabric.description)}</p>` : ""}
      ${action}
      ${seller ? `
        <div class="seller-card">
          <img class="logo" src="${sellerLogoUrl(seller)}" alt="">
          <div>
            <div class="name">${escapeHtml(seller.name)}</div>
            <div class="meta">${escapeHtml(seller.location)} · ${escapeHtml(sellerRatingText(seller))}</div>
            <div class="meta">Delivers to your tailor in ${escapeHtml(seller.delivery_estimate)}</div>
          </div>
        </div>` : ""}
      ${others.length ? `
        <div class="row-between"><b>More from this seller</b>
          <button class="linkish" onclick="marketFilters.seller='${fabric.supplier_id}';go('${inFlow ? "fabric" : "market"}')">See all</button></div>
        <div class="mgrid">${others.map(f => fabricTile(f, inFlow && d ? d.fabricId : null)).join("")}</div>` : ""}
    </div>
    ${inFlow ? "" : cNav("market")}`;
}

function showPhoto(index) {
  const gallery = document.getElementById("gallery");
  if (gallery) gallery.scrollTo({ left: index * gallery.clientWidth, behavior: "smooth" });
}

function galleryScrolled(gallery) {
  const index = Math.round(gallery.scrollLeft / Math.max(1, gallery.clientWidth));
  document.querySelectorAll(".gallery-thumbs button").forEach((b, i) => b.classList.toggle("on", i === index));
}

// Picks a fabric: straight into the order on step 4, or saved for when the customer gets there
function chooseMarketFabric(fabricId) {
  const fabric = findFabric(fabricId);
  if (!fabric || !isBuyable(fabric)) {
    toast("Sorry, that fabric has just sold out.");
    renderAll();
    return;
  }
  const d = draft();
  d.fabricId = fabricId;
  saveData();
  if (choosingFabricForOrder()) {
    go("fabric");
  } else {
    toast(`${fabric.name} saved for your order. Now choose what to have made.`);
    go("outfit");
  }
}

