// ============================================================
// tailor-admin.js — Business → My profile (each tailor edits their own
// public profile) and NebedaHub Admin → Tailors (the admin approves or hides
// tailors and looks after the list of specialities)
//
// Saving a postcode or address looks up its map position automatically
// (geo.js: postcodes.io for UK postcodes, OpenStreetMap Nominatim
// elsewhere). "Use my current location" sets it from the device instead.
// The database decides what the public sees: every tailor is shown about
// 1 km away, with only the postcode district, and phone numbers, emails,
// links and social handles are hidden from descriptions and captions
// (supabase/no-leakage.sql). The full address is shared with a customer
// only once their deposit is confirmed.
// ============================================================

const PORTFOLIO_MAX = 12;
const MAKING_TIMES = ["3–5 days", "1 week", "7–14 days", "2–3 weeks", "3–4 weeks", "4–6 weeks"];
let profileForm = null;     // { key, logo, lat, lng, source, adding } while My profile is open
let profileSaving = false;

function tailorStatusBanner(d) {
  if (!d) return "";
  if (d.admin_status === "approved") return "";
  if (d.admin_status === "hidden") {
    return `<div class="card attention"><b>Your profile is hidden from customers.</b> ${d.admin_note ? `The ${APP_NAME} team says: “${escapeHtml(d.admin_note)}”.` : ""} Update it and contact ${APP_NAME} to be shown again.</div>`;
  }
  return `<div class="card attention"><b>Waiting for approval.</b>${d.tailor_terms_accepted_at ? "" : " Accept the tailor terms below first."} Customers can't find you yet. Add your photo, specialities, location and a few portfolio photos — the ${APP_NAME} team checks new tailors and approves them.</div>`;
}

// ---- My profile ----

function renderMyProfile() {
  const d = bizDesigner();
  if (!d) return bizHeader("My profile", "No tailor business found.");
  const canEdit = ownsBizDesigner();
  const key = d.id + ":" + (d.updated_at || "");
  if (!profileForm || profileForm.key !== key) {
    profileForm = { key, logo: d.profile_image ? { ref: d.profile_image, url: photoUrl(d.profile_image) } : null,
                    lat: d.latitude, lng: d.longitude, source: d.latitude != null ? "saved" : "", adding: 0 };
  }
  const link = new URL(`tailor/${d.slug}/`, location.href.split("#")[0]).href;
  const times = MAKING_TIMES.includes(d.delivery_time) ? MAKING_TIMES : MAKING_TIMES.concat(d.delivery_time || []);
  const dis = canEdit ? "" : "disabled";
  return `
    ${bizHeader("My profile", `What customers see when they find ${escapeHtml(d.business_name)} on ${APP_NAME}.`)}
    ${tailorStatusBanner(d)}
    ${canEdit ? "" : `<div class="card"><p class="hint">Only the owner can change the profile. Ask them to update it.</p></div>`}
    ${tailorTermsCard(d, canEdit)}
    <div class="card">
      <p class="share-row">Your public page: <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link.replace(/^https?:\/\//, ""))}</a>
        ${d.admin_status === "approved" ? `· <a href="${escapeHtml(appUrl("customer", "tailor/" + d.slug))}" target="_blank" rel="noopener">see it in ${APP_NAME}</a>` : "(live once you're approved)"}</p>
    </div>
    <form id="profile-form" class="card profile-form" onsubmit="return saveMyProfile(event)" novalidate>
      <fieldset ${dis}>
      <div id="profile-logo" class="logo-row">${profileLogoRow(d)}</div>
      <div class="form-grid">
        <label>Business name<input name="business" required maxlength="80" value="${escapeHtml(d.business_name)}"></label>
        <label>Web address <small class="muted">nebedahub.com/tailor/<b>this</b>/</small><input name="slug" maxlength="60" pattern="[a-z0-9-]+" value="${escapeHtml(d.slug || "")}"></label>
        <p class="hint wide">🔒 Customers contact you through ${APP_NAME}: phone numbers, emails, websites and social handles are hidden from your profile and portfolio automatically.</p>
        <label class="wide">About your business<textarea name="description" rows="4" maxlength="1200" placeholder="What you make, how long it takes, how fittings work…">${escapeHtml(d.description || "")}</textarea></label>
      </div>

      <h2>Specialities</h2>
      <div class="spec-picker">${specialityList().map(sp => `<label class="check"><input type="checkbox" name="spec" value="${escapeHtml(sp.name)}" ${(d.speciality_tags || []).includes(sp.name) ? "checked" : ""}> ${escapeHtml(sp.name)}</label>`).join("")}</div>

      <h2>Orders</h2>
      <div class="form-grid">
        <label class="check"><input type="checkbox" name="delivery" ${d.delivery_available ? "checked" : ""}> Delivery available</label>
        <label class="check"><input type="checkbox" name="custom" ${d.custom_orders !== false ? "checked" : ""}> Taking custom orders (customers can request a quote)</label>
        <label>Usual making time<select name="making">${times.map(t => `<option ${t === d.delivery_time ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
      </div>

      <h2>Where you are</h2>
      <p class="hint">Customers search by distance. We look up your map position from your postcode (or address) when you save. Customers see your area (e.g. “SE15”) and a position rounded to about 1 km. Your full address is shared with a customer only once their deposit is confirmed, in “Delivery and fitting details” — for delivery and fittings.</p>
      <div class="form-grid">
        <label>Country<select name="country" required>${countryOptions(d.country_code, "Choose your country")}</select></label>
        <label>City or town<input name="city" required maxlength="60" value="${escapeHtml(d.city || "")}"></label>
        <label>Postcode<input name="postcode" maxlength="12" value="${escapeHtml(d.postcode || "")}" autocomplete="postal-code"></label>
        <label class="wide">Full address <small class="muted">(optional)</small><input name="address" maxlength="120" value="${escapeHtml(d.address_line || "")}" autocomplete="street-address"></label>
      </div>
      <div id="profile-location" class="location-row">${profileLocationRow()}</div>
      </fieldset>
      <p id="profile-error" class="form-error" role="alert"></p>
      ${canEdit ? `<div class="form-actions"><button type="submit" class="gold" id="save-profile">Save profile</button></div>` : ""}
    </form>

    <div class="card">
      <h2>Portfolio <span class="total">${(d.portfolio || []).length} of ${PORTFOLIO_MAX}</span></h2>
      <p class="hint">Photos of outfits you've made. The first few show on your page and in search.</p>
      <div class="portfolio-grid edit">${(d.portfolio || []).map(p => `
        <div class="portfolio-item"><img src="${escapeHtml(photoUrl(p.image))}" alt="${escapeHtml(p.title || "Portfolio photo")}">
          ${p.title ? `<span>${escapeHtml(p.title)}</span>` : ""}
          ${canEdit ? `<button type="button" class="small danger" onclick="removePortfolioPhoto('${p.id}')" aria-label="Remove photo">Remove</button>` : ""}</div>`).join("")}
        ${Array.from({ length: profileForm.adding }, () => `<div class="portfolio-item busy"><span class="gen-spin"></span></div>`).join("")}
      </div>
      ${canEdit && (d.portfolio || []).length < PORTFOLIO_MAX ? `<div class="inline-form">
        <input id="portfolio-title" maxlength="60" placeholder="Caption (optional), e.g. Wedding agbada" aria-label="Caption">
        <label class="button file-button">Add photos<input type="file" accept="image/*" multiple onchange="addPortfolioPhotos(this)"></label></div>` : ""}
    </div>`;
}

function profileLogoRow(d) {
  const url = profileForm.logo ? profileForm.logo.url : photoUrl(`logo:${initialsOf(d.business_name)}:1e2a44`);
  return `<img class="logo big" src="${escapeHtml(url)}" alt="Logo or profile photo">
    <div class="stack">
      <label class="button small file-button">${profileForm.logo ? "Change photo" : "Upload logo or photo"}<input type="file" accept="image/*" onchange="setProfileLogo(this)"></label>
      ${profileForm.logo ? `<button type="button" class="small ghost" onclick="profileForm.logo=null;redrawProfileLogo()">Remove</button>` : `<small class="muted">A clear logo or a photo of you at work.</small>`}
    </div>`;
}

function redrawProfileLogo() {
  const el = document.getElementById("profile-logo");
  if (el) el.innerHTML = profileLogoRow(bizDesigner());
}

function setProfileLogo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  resizeImage(file, 480, 0.85)
    .then(url => { profileForm.logo = { ref: null, url }; redrawProfileLogo(); })
    .catch(error => toast(error.message));
}

function profileLocationRow() {
  const f = profileForm;
  const where = f.lat != null
    ? `📍 Map position set${f.source === "gps" ? " from your current location" : f.source === "nominatim" ? " from your address" : f.source === "postcodes.io" ? " from your postcode" : ""}: ${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)}`
    : "📍 No map position yet — it's looked up from your postcode when you save.";
  return `<span class="meta">${where}</span>
    <button type="button" class="small" onclick="useMyLocationForShop()">Use my current location</button>
    <small class="osm-credit">Postcode lookups: postcodes.io (UK) · ${Geo.OSM_CREDIT}</small>`;
}

function redrawProfileLocation() {
  const el = document.getElementById("profile-location");
  if (el) el.innerHTML = profileLocationRow();
}

function useMyLocationForShop() {
  const el = document.getElementById("profile-location");
  if (el) el.querySelector(".meta").textContent = "Finding your location…";
  Geo.locate()
    .then(point => {
      Object.assign(profileForm, { lat: Math.round(point.lat * 1e6) / 1e6, lng: Math.round(point.lng * 1e6) / 1e6, source: "gps" });
      redrawProfileLocation();
      toast("Shop location set from where you are now. Press Save profile to keep it.");
    })
    .catch(error => { redrawProfileLocation(); toast(error.message); });
}

function saveMyProfile(event) {
  event.preventDefault();
  if (profileSaving) return false;
  const d = bizDesigner();
  const form = event.target;
  const v = {
    business_name: form.business.value.trim(),
    slug: slugify(form.slug.value || form.business.value),
    description: form.description.value.trim(),
    speciality_tags: Array.from(form.querySelectorAll("input[name=spec]:checked")).map(x => x.value),
    delivery_available: form.delivery.checked,
    custom_orders: form.custom.checked,
    delivery_time: form.making.value,
    country_code: form.country.value,
    city: form.city.value.trim(),
    postcode: form.postcode.value.trim().toUpperCase(),
    address_line: form.address.value.trim(),
    show_exact_address: false
  };
  if (v.business_name.length < 2) return formError("profile-error", "Enter your business name.");
  if (!v.country_code) return formError("profile-error", "Choose your country.");
  if (!v.city) return formError("profile-error", "Enter your city or town.");
  if (hideContactDetails(v.business_name).hidden) return formError("profile-error", "Your business name can't include a phone number, email, website or social handle.");
  const hidDetails = hideContactDetails(v.description).hidden;
  if (!Cloud.live && db.designers.some(x => x.slug === v.slug && x.id !== d.id)) return formError("profile-error", "Another tailor uses that web address. Try another.");

  profileSaving = true;
  const button = document.getElementById("save-profile");
  if (button) { button.disabled = true; button.textContent = "Saving…"; }
  formError("profile-error", "");

  // A new postcode or address: look up where it is (unless the location was just set from the device)
  const placeChanged = v.country_code !== d.country_code || v.city !== (d.city || "") || v.postcode !== (d.postcode || "") || v.address_line !== (d.address_line || "");
  const lookUp = (placeChanged || profileForm.lat == null) && profileForm.source !== "gps"
    ? Geo.geocode({ country: v.country_code, city: v.city, postcode: v.postcode, address: v.address_line })
    : Promise.resolve(null);

  let warning = "";
  lookUp
    .then(found => {
      if (found) Object.assign(profileForm, { lat: Math.round(found.lat * 1e6) / 1e6, lng: Math.round(found.lng * 1e6) / 1e6, source: found.source });
      else if (placeChanged || profileForm.lat == null) warning = "We couldn't find that postcode or address on the map. Check it, or use “Use my current location” at your shop — customers searching by distance can't find you until your map position is set.";
      return profileForm.logo && !profileForm.logo.ref ? PhotoStore.put(profileForm.logo.url, "designer") : profileForm.logo ? profileForm.logo.ref : null;
    })
    .then(logoRef => {
      v.latitude = profileForm.lat;
      v.longitude = profileForm.lng;
      v.profile_image = logoRef;
      if (Cloud.live) {
        return Cloud.saveDesignerProfile(d.id, {
          business_name: v.business_name, slug: v.slug, description: v.description, speciality_tags: v.speciality_tags,
          delivery_available: v.delivery_available, custom_orders: v.custom_orders, delivery_estimate: v.delivery_time,
          country_code: v.country_code, city: v.city, postcode: v.postcode || null, address_line: v.address_line || null,
          show_exact_address: v.show_exact_address, latitude: v.latitude, longitude: v.longitude, profile_image_url: v.profile_image
        });
      }
      const oldLogo = d.profile_image;
      Object.assign(d, v, { location: "" });
      refreshDesignerPublic(d);
      d.updated_at = new Date().toISOString();
      if (oldLogo && oldLogo !== v.profile_image) PhotoStore.remove(oldLogo);
      saveData();
    })
    .then(() => {
      profileForm = null;
      toast(warning ? "Saved — but your map position isn't set." : hidDetails ? "Saved. " + CONTACT_HIDDEN_NOTICE : "Profile saved.");
      renderAll();
      if (warning) formError("profile-error", warning);
    })
    .catch(error => formError("profile-error", error.message || "Couldn't save your profile."))
    .finally(() => {
      profileSaving = false;
      const again = document.getElementById("save-profile");
      if (again) { again.disabled = false; again.textContent = "Save profile"; }
    });
  return false;
}

function addPortfolioPhotos(input) {
  const d = bizDesigner();
  const room = PORTFOLIO_MAX - (d.portfolio || []).length;
  const files = Array.from(input.files || []).slice(0, room);
  const titleBox = document.getElementById("portfolio-title");
  const title = titleBox ? hideContactDetails(titleBox.value.trim()).text : "";
  if (titleBox && hideContactDetails(titleBox.value).hidden) toast(CONTACT_HIDDEN_NOTICE);
  if (!files.length) return;
  profileForm.adding += files.length;
  renderAll();
  files.reduce((chain, file) => chain.then(() =>
    resizeImage(file, PHOTO_MAX_SIZE, 0.82)
      .then(url => PhotoStore.put(url, "designer"))
      .then(ref => {
        if (Cloud.live) return Cloud.addPortfolioItem(d.id, ref, title);
        if (!d.portfolio) d.portfolio = [];
        d.portfolio.push({ id: `${d.id}-P${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, image: ref, title });
        saveData();
      })
      .catch(error => toast(error.message))
      .finally(() => { profileForm.adding = Math.max(0, profileForm.adding - 1); renderAll(); })), Promise.resolve());
}

function removePortfolioPhoto(itemId) {
  const d = bizDesigner();
  const item = (d.portfolio || []).find(p => p.id === itemId);
  if (!item || !confirm("Remove this photo from your portfolio?")) return;
  if (Cloud.live) {
    Cloud.removePortfolioItem(item).then(renderAll, error => toast(error.message));
    return;
  }
  d.portfolio = d.portfolio.filter(p => p.id !== itemId);
  PhotoStore.remove(item.image);
  saveData();
  renderAll();
}

// The tailor terms: shown until the owner ticks them
function tailorTermsCard(d, canEdit) {
  if (d.tailor_terms_accepted_at) return "";
  return `<form class="card attention" onsubmit="return acceptTermsFromProfile(event, '${d.id}')">
    <h2>Tailor terms</h2>
    <p class="hint">${d.admin_status === "approved" ? "" : `The ${APP_NAME} team approves you once you've accepted them. `}They protect you and your customers: orders, chats and payments stay on ${APP_NAME}.</p>
    ${tailorTermsHtml(true)}
    ${canEdit ? `${tailorTermsCheckbox()}<div class="form-actions"><button type="submit" class="gold">Accept the tailor terms</button></div>`
      : `<p class="hint">Only the owner can accept them.</p>`}
  </form>`;
}

function acceptTermsFromProfile(event, designerId) {
  event.preventDefault();
  if (!event.target.acceptTerms.checked) { toast("Tick the box to agree to the tailor terms."); return false; }
  if (Cloud.live) {
    Cloud.acceptTailorTerms(designerId).then(() => { toast("Thank you — tailor terms accepted."); renderAll(); }, error => alert(error.message));
    return false;
  }
  const d = designerById(designerId);
  d.tailor_terms_accepted_at = new Date().toISOString();
  saveData();
  toast("Thank you — tailor terms accepted.");
  renderAll();
  return false;
}

// ---- Tailors (NebedaHub Admin) ----

let tailorAdminFilter = "pending";

function renderTailorAdmin() {
  const groups = { pending: "Waiting", approved: "Approved", hidden: "Hidden" };
  const all = db.designers.filter(d => !d.from_search || d.is_mine);
  const shown = all.filter(d => d.admin_status === tailorAdminFilter)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const rows = shown.map(d => {
    const country = countryByCode(d.country_code);
    return `<div class="tailor-admin-row">
      <img class="tailor-logo" src="${escapeHtml(photoUrl(d.profile_image) || photoUrl(`logo:${initialsOf(d.business_name)}:1e2a44`))}" alt="">
      <div class="grow">
        <b>${escapeHtml(d.business_name)}</b> ${d.demo ? `<span class="pill muted-pill">demo</span>` : ""}
        <div class="muted small-text">${country ? country.flag + " " + escapeHtml(country.name) : "No country yet"}${d.city ? " · " + escapeHtml(d.city) : ""}${d.postcode ? " · " + escapeHtml(d.postcode) : ""}
          ${d.public_latitude == null ? ` · <span class="owed">no map position</span>` : ""}${d.phone ? ` · 📞 ${escapeHtml(d.phone)}` : ""}</div>
        <div class="small-text">${escapeHtml((d.speciality_tags || []).join(", ") || "No specialities yet")} · ${(d.portfolio || []).length} portfolio photo${(d.portfolio || []).length === 1 ? "" : "s"}${d.description ? "" : " · no description"}</div>
        ${d.admin_note ? `<div class="small-text owed">Hidden because: ${escapeHtml(d.admin_note)}</div>` : ""}
        ${d.tailor_terms_accepted_at ? `<div class="small-text paid">✓ Accepted the tailor terms ${formatDate(String(d.tailor_terms_accepted_at).slice(0, 10))}</div>`
          : d.is_mine === false ? "" : `<div class="small-text owed">Hasn't accepted the tailor terms yet</div>`}
      </div>
      <div class="nowrap job-buttons">
        <a class="button small ghost" href="${escapeHtml(appUrl("customer", "tailor/" + d.slug))}" target="_blank" rel="noopener">View page</a>
        ${d.admin_status !== "approved" ? `<button class="small gold" onclick="setTailorStatus('${d.id}', 'approved')">✓ Approve</button>` : ""}
        ${d.admin_status !== "hidden" && d.id !== (mainDesigner() || {}).id ? `<button class="small danger" onclick="setTailorStatus('${d.id}', 'hidden')">Hide</button>` : ""}
      </div>
    </div>`;
  }).join("");
  return `
    ${bizHeader("Tailors", `Approve new tailors before customers can find them, or hide one. Approved tailors appear in “Find tailors near me” and on the public tailor pages.`)}
    <div class="card">
      <div class="chips">${Object.keys(groups).map(k => `<button class="chip ${k === tailorAdminFilter ? "active" : ""}" onclick="tailorAdminFilter='${k}';renderAll()">${groups[k]} (${all.filter(d => d.admin_status === k).length})</button>`).join("")}</div>
      ${rows || `<p class="empty">No ${groups[tailorAdminFilter].toLowerCase()} tailors.</p>`}
    </div>`;
}

// ---- Specialities (admin): the list tailors choose from and customers filter by ----

function renderSpecialities() {
  return `
    ${bizHeader("Specialities", "Tailors choose their specialities from this list in My profile, and customers filter by it in Find tailors near me.")}
    <div class="card">
      <div class="spec-tags">${specialityList().map(sp => `<span class="pill">${escapeHtml(sp.name)}</span>`).join("")}</div>
      <form class="inline-form" onsubmit="return addSpecialityFromForm(event)">
        <input name="name" required minlength="2" maxlength="40" placeholder="e.g. Kids' outfits" aria-label="New speciality">
        <button type="submit">Add speciality</button>
      </form>
    </div>`;
}

function setTailorStatus(id, status) {
  const d = designerById(id);
  if (status === "approved" && !d.tailor_terms_accepted_at && d.id !== (mainDesigner() || {}).id && !Cloud.live) {
    alert(`${d.business_name} hasn't accepted the ${APP_NAME} tailor terms yet. They'll see them in Business → My profile.`);
    return;
  }
  let note = "";
  if (status === "hidden") {
    note = prompt(`Why hide ${d.business_name}? They'll see this note.`, "");
    if (note === null) return;
  }
  if (Cloud.live) {
    Cloud.setDesignerStatus(id, status, note).then(() => { toast(`${d.business_name}: ${TAILOR_STATUS_LABELS[status].toLowerCase()}.`); renderAll(); }, error => alert(error.message));
    return;
  }
  d.admin_status = status;
  d.admin_note = status === "hidden" ? note.trim() : "";
  saveData();
  toast(`${d.business_name}: ${TAILOR_STATUS_LABELS[status].toLowerCase()}.`);
  renderAll();
}

function addSpecialityFromForm(event) {
  event.preventDefault();
  const name = event.target.name.value.trim().replace(/\s+/g, " ");
  if (specialityList().some(sp => sp.name.toLowerCase() === name.toLowerCase())) { toast(`"${name}" is already on the list.`); return false; }
  if (Cloud.live) {
    Cloud.addSpeciality(name).then(() => { toast(`${name} added.`); renderAll(); }, error => alert(error.message));
    return false;
  }
  if (!db.specialities) db.specialities = DEMO_SPECIALITIES.map(sp => Object.assign({}, sp));
  db.specialities.push({ id: "SP" + (db.specialities.length + 1), name, sort_order: 100, active: true });
  saveData();
  toast(`${name} added.`);
  renderAll();
  return false;
}
