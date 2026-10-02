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

// Shown on every Business screen except My profile (which has the full checklist)
function tailorStatusBanner(d) {
  if (!d) return "";
  if (d.admin_status === "approved") return "";
  if (d.admin_status === "hidden") {
    return `<div class="card attention"><b>Your profile is hidden from customers.</b> ${d.admin_note ? `The ${APP_NAME} team says: “${escapeHtml(d.admin_note)}”.` : ""} Update it and contact ${APP_NAME} to be shown again.</div>`;
  }
  const left = tailorApplicationSteps(d).filter(s => !s.done);
  if (!left.length) {
    return `<div class="card attention"><b>Waiting for approval.</b> Your application is complete — there's nothing more to do. The ${APP_NAME} team is checking it, and customers can find you once you're approved.</div>`;
  }
  return `<div class="card attention"><b>Your tailor application isn't finished yet.</b> Next: <b>${escapeHtml(left[0].label)}</b>.
    <a class="button small gold" href="#/profile">Continue my application</a></div>`;
}

// ---- The tailor application: what's done and what's next ----
// Mirrors what the database needs before the admin can approve a tailor
// (wearvia_set_designer_status in supabase/registration-verification.sql).

function tailorApplicationSteps(d) {
  const portfolio = (d.portfolio || []).length;
  return [
    { label: "Accept the tailor terms", done: !!d.tailor_terms_accepted_at, where: "tailor-terms" },
    { label: "Owner's full name", done: !!String(d.owner_name || "").trim(), where: "tailor-verification" },
    { label: "Upload your government-issued ID", done: !!d.verification_id, where: "tailor-verification" },
    { label: "Upload proof of address", done: !!d.verification_address, where: "tailor-verification" },
    { label: "Add a profile or business photo", done: !!d.profile_image, where: "profile-logo" },
    { label: "Write about your business", done: !!String(d.description || "").trim(), where: "profile-about" },
    { label: "Choose at least one speciality", done: (d.speciality_tags || []).length > 0, where: "profile-specs" },
    { label: "Add your business address", done: !!String(d.address_line || "").trim(), where: "profile-where" },
    { label: `Add at least 2 portfolio photos (${Math.min(portfolio, 2)} of 2)`, done: portfolio >= 2, where: "profile-portfolio" }
  ];
}

function goToApplicationStep(where) {
  const el = document.getElementById(where);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("step-flash");
  setTimeout(() => el.classList.remove("step-flash"), 1600);
  const input = el.matches("input, textarea, select") ? el : el.querySelector("input:not([type=checkbox]):not([readonly]), textarea, input");
  if (input) setTimeout(() => input.focus({ preventScroll: true }), 400);
}

function tailorChecklistCard(d, canEdit) {
  if (!d || d.admin_status === "approved" || d.admin_status === "hidden") return "";
  const steps = tailorApplicationSteps(d);
  const left = steps.filter(s => !s.done);
  const done = steps.length - left.length;
  if (!left.length) {
    return `<div class="card attention app-steps" id="tailor-application">
      <h2>✓ Application complete</h2>
      <p><b>There's nothing more you need to do.</b> The ${APP_NAME} team is now checking your documents and profile.</p>
      <p class="hint">Once you're approved, this message goes away, your Business dashboard opens and customers near you can find you and send quote requests. Check back here to see when you're approved.</p>
    </div>`;
  }
  const step = s => !s.done && canEdit
    ? `<button type="button" class="linkish strong" onclick="goToApplicationStep('${s.where}')">${escapeHtml(s.label)}</button>`
    : escapeHtml(s.label);
  return `<div class="card attention app-steps" id="tailor-application">
    <h2>Finish your tailor application <span class="total">${done} of ${steps.length} done</span></h2>
    <div class="app-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}"><span style="width:${Math.round(done / steps.length * 100)}%"></span></div>
    <p class="next-step"><b>Next step:</b> ${escapeHtml(left[0].label)}
      ${canEdit ? `<button type="button" class="gold small" onclick="goToApplicationStep('${left[0].where}')">Do this now</button>` : ""}</p>
    <ol class="app-checklist">
      ${steps.map(s => `<li class="${s.done ? "done" : ""}"><span class="tick" aria-hidden="true">${s.done ? "✓" : ""}</span>${step(s)}${s.done ? ' <span class="sr-only">(done)</span>' : ""}</li>`).join("")}
      <li class="final"><span class="tick" aria-hidden="true"></span>Then the ${APP_NAME} team checks everything and approves you</li>
    </ol>
    <p class="hint">Customers can't find you until every step is done and you're approved. Your ID, proof of address, phone and exact address are private — only the ${APP_NAME} team sees them.</p>
    ${canEdit ? "" : `<p class="hint"><b>Only the owner can finish the application.</b> Ask them to sign in and open My profile.</p>`}
  </div>`;
}

// ---- Private verification documents (owner only) ----

function tailorVerificationCard(d, canEdit) {
  if (!d || d.admin_status === "approved" || !canEdit) return "";
  const status = (ref, label) => {
    if (!ref) return `<span class="small-text owed">Not uploaded yet</span>`;
    const url = photoUrl(ref);
    return url ? `<a class="small-text paid" href="${escapeHtml(url)}" target="_blank" rel="noopener">✓ ${escapeHtml(label)} uploaded — view</a>`
      : `<span class="small-text paid">✓ ${escapeHtml(label)} uploaded</span>`;
  };
  const accept = "image/*,application/pdf";
  return `<form id="tailor-verification" class="card verification-form" onsubmit="return saveTailorVerification(event)" novalidate>
    <h2>Private verification</h2>
    <p class="hint">🔒 Only the ${APP_NAME} team sees these — never customers. A clear photo taken with your phone camera is fine (or a PDF), up to 10 MB each. You can save one document now and add the other later.</p>
    <label class="field">Owner or responsible person's full name
      <input name="ownerName" maxlength="100" autocomplete="name" value="${escapeHtml(d.owner_name || (Cloud.me && Cloud.me.name) || "")}"></label>
    <label class="field">Government-issued ID <small>(passport, driving licence or national ID card)</small>
      ${status(d.verification_id, "ID")}
      <input name="identityDocument" type="file" accept="${accept}"></label>
    <label class="field">Proof of address <small>(utility bill, bank statement or official letter from the last 3 months)</small>
      ${status(d.verification_address, "Proof of address")}
      <input name="addressDocument" type="file" accept="${accept}"></label>
    <label class="field">Business registration document <small>(optional — skip it if you aren't formally registered)</small>
      ${d.business_registration ? status(d.business_registration, "Business registration") : ""}
      <input name="businessDocument" type="file" accept="${accept}"></label>
    <p id="verification-error" class="form-error" role="alert"></p>
    <div class="form-actions"><button type="submit" class="gold" id="save-verification">Save verification</button></div>
  </form>`;
}

// Phone photos (any image type, including iPhone HEIC where the browser can
// open it) become a JPEG no bigger than 2400px; PDFs are kept as they are.
function prepareVerificationFile(file) {
  const name = file.name || "document";
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    return Promise.resolve(file.type === "application/pdf" ? file : new File([file], name, { type: "application/pdf" }));
  }
  if (file.size > 30 * 1024 * 1024) return Promise.reject(new Error(`${name} is too big. Take a new photo of the document, or upload a smaller file.`));
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
  const typed = file.type ? file : new File([file], name, { type: "image/" + (ext ? ext.toLowerCase().replace("jpg", "jpeg") : "jpeg") });
  return resizeImage(typed, 2400, 0.88)
    .then(dataUrl => {
      const bytes = atob(dataUrl.split(",")[1]);
      const array = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
      return new Blob([array], { type: "image/jpeg" });
    })
    .then(blob => new File([blob], name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" }))
    .catch(() => { throw new Error(`We couldn't open ${name}. Take a clear photo of the document with your phone camera, or upload a JPG, PNG or PDF.`); });
}

function uploadTailorDocument(file, purpose) {
  if (!file) return Promise.resolve(null);
  return prepareVerificationFile(file).then(ready => Cloud.live ? Cloud.uploadVerificationFile(ready, purpose) : `demo:${purpose}:${ready.name}`);
}

function saveTailorVerification(event) {
  event.preventDefault();
  const d = bizDesigner();
  const form = event.target;
  const ownerName = form.ownerName.value.trim();
  const idFile = form.identityDocument.files[0] || null;
  const addressFile = form.addressDocument.files[0] || null;
  const businessFile = form.businessDocument.files[0] || null;
  if (!ownerName) return formError("verification-error", "Enter the owner's full name.");
  if (!idFile && !addressFile && !businessFile && ownerName === (d.owner_name || "")) {
    return formError("verification-error", d.verification_id ? "Choose your proof of address to upload." : "Choose a photo or PDF of your government-issued ID to upload.");
  }
  formError("verification-error", "");
  const button = document.getElementById("save-verification");
  if (button) { button.disabled = true; button.textContent = "Uploading…"; }
  Promise.all([uploadTailorDocument(idFile, "tailor-id"), uploadTailorDocument(addressFile, "tailor-address"), uploadTailorDocument(businessFile, "tailor-business-registration")])
    .then(([idRef, addressRef, businessRef]) => {
      if (Cloud.live) return Cloud.saveDesignerVerification(d.id, { ownerName, verificationId: idRef, verificationAddress: addressRef, businessRegistration: businessRef });
      Object.assign(d, { owner_name: ownerName }, idRef ? { verification_id: idRef } : {}, addressRef ? { verification_address: addressRef } : {},
        businessRef ? { business_registration: businessRef } : {}, { verification_submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      saveData();
    })
    .then(() => {
      profileForm = null;
      const next = tailorApplicationSteps(bizDesigner() || d).find(s => !s.done);
      toast(next ? `Saved. Next: ${next.label}.` : "Saved — your application is complete!");
      renderAll();
      setTimeout(() => goToApplicationStep("tailor-application"), 50);
    })
    .catch(error => {
      formError("verification-error", error.message || "Couldn't upload your documents. Check your connection and try again.");
      const again = document.getElementById("save-verification");
      if (again) { again.disabled = false; again.textContent = "Save verification"; }
    });
  return false;
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
    ${d.admin_status === "hidden" ? tailorStatusBanner(d) : tailorChecklistCard(d, canEdit)}
    ${canEdit ? "" : `<div class="card"><p class="hint">Only the owner can change the profile. Ask them to update it.</p></div>`}
    ${tailorTermsCard(d, canEdit)}
    ${tailorVerificationCard(d, canEdit)}
    ${canEdit ? designerPaymentsCard() : ""}
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
        <label class="wide" id="profile-about">About your business<textarea name="description" rows="4" maxlength="1200" placeholder="What you make, how long it takes, how fittings work…">${escapeHtml(d.description || "")}</textarea></label>
      </div>

      <h2 id="profile-specs">Specialities</h2>
      <div class="spec-picker">${specialityList().map(sp => `<label class="check"><input type="checkbox" name="spec" value="${escapeHtml(sp.name)}" ${(d.speciality_tags || []).includes(sp.name) ? "checked" : ""}> ${escapeHtml(sp.name)}</label>`).join("")}</div>

      <h2>Orders</h2>
      <div class="form-grid">
        <label class="check"><input type="checkbox" name="delivery" ${d.delivery_available ? "checked" : ""}> Delivery available</label>
        <label class="check"><input type="checkbox" name="custom" ${d.custom_orders !== false ? "checked" : ""}> Taking custom orders (customers can request a quote)</label>
        <label>Usual making time<select name="making">${times.map(t => `<option ${t === d.delivery_time ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
      </div>

      <h2 id="profile-where">Where you are</h2>
      <p class="hint">Customers search by distance. We look up your map position from your postcode (or address) when you save. Customers see your area (e.g. “SE15”) and a position rounded to about 1 km. Your full address is shared with a customer only once their deposit is confirmed, in “Delivery and fitting details” — for delivery and fittings.</p>
      <div class="form-grid">
        <label>Country<select name="country" required>${countryOptions(d.country_code, "Choose your country")}</select></label>
        <label>City or town<input name="city" required maxlength="60" value="${escapeHtml(d.city || "")}"></label>
        <label>Postcode<input name="postcode" maxlength="12" value="${escapeHtml(d.postcode || "")}" autocomplete="postal-code"></label>
        <label class="wide">Full business address <small class="muted">(private — needed for approval)</small><input name="address" maxlength="120" value="${escapeHtml(d.address_line || "")}" autocomplete="street-address"></label>
        <label>Phone <small class="muted">(only the ${APP_NAME} team sees it)</small>${phoneFieldHtml("phone", d.phone || "", d.country_code)}</label>
      </div>
      <div id="profile-location" class="location-row">${profileLocationRow()}</div>

      <h2>Currency and fabric</h2>
      <p class="hint">Your quotes, orders, invoices and prices are in your currency. Fabric from a seller in another currency is converted into yours at the day's exchange rate when you send a quote (the rate is saved on the order). You measure fabric in <b>${unitWord(designerFabricUnit(d), true)}</b>, as ${escapeHtml((countryByCode(d.country_code) || { name: "your country" }).name)} does.</p>
      <div class="form-grid">
        <label>Your currency<select name="currency">${currencyOptions(designerCurrency(d))}</select></label>
        <p class="hint">Changing it converts your price list and ready-to-wear prices at today's rate${ratesDate() ? ` (${formatDate(ratesDate())})` : ""}. Orders already placed keep their currency.</p>
      </div>
      </fieldset>
      <p id="profile-error" class="form-error" role="alert"></p>
      ${canEdit ? `<div class="form-actions"><button type="submit" class="gold" id="save-profile">Save profile</button></div>` : ""}
    </form>

    <div class="card" id="profile-portfolio">
      <h2>Portfolio <span class="total">${(d.portfolio || []).length} of ${PORTFOLIO_MAX}</span></h2>
      <p class="hint">Photos of outfits you've made. The first few show on your page and in search.${d.admin_status === "approved" ? "" : " You need at least 2 to be approved."}</p>
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

function designerPaymentsCard() {
  // payouts.js renders the Stripe onboarding card; falls back to the closed notice.
  if (typeof payoutCardHtml === "function") return payoutCardHtml("tailor");
  return `<div class="card"><h2>Payments & payouts</h2>
    <p><b>Not open yet.</b> NebedaHub is completing its protected payment and payout setup before tailors can receive customer money.</p>
    <p class="hint">Do not ask customers to pay you directly. Payment setup will be enabled here when it is ready.</p></div>`;
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
  v.currency_code = form.currency.value || designerCurrency(d);
  v.phone = readPhone(form, "phone");
  if (v.phone && !phoneLooksRight(v.phone)) return formError("profile-error", "That phone number doesn't look right.");
  if (v.currency_code !== designerCurrency(d)) {
    const rate = fxRate(designerCurrency(d), v.currency_code);
    if (rate == null) return formError("profile-error", `There's no exchange rate for ${v.currency_code} yet. Try again tomorrow.`);
    if (!confirm(`Change your currency from ${designerCurrency(d)} to ${v.currency_code}? Your prices are converted at today's rate (${rateText(rate, designerCurrency(d), v.currency_code)}) and rounded. Check them in Business → Prices afterwards.`)) return false;
  }
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
          show_exact_address: v.show_exact_address, latitude: v.latitude, longitude: v.longitude, profile_image_url: v.profile_image,
          currency_code: v.currency_code, phone: v.phone || null
        });
      }
      // Local fallback: convert prices only when the live database path is unavailable
      if (v.currency_code !== designerCurrency(d)) convertLocalDesignerPrices(d, designerCurrency(d), v.currency_code);
      const oldLogo = d.profile_image;
      Object.assign(d, v, { location: "" });
      refreshDesignerPublic(d);
      d.updated_at = new Date().toISOString();
      if (oldLogo && oldLogo !== v.profile_image) PhotoStore.remove(oldLogo);
      saveData();
    })
    .then(() => {
      profileForm = null;
      const fresh = bizDesigner() || d;
      const next = fresh.admin_status === "approved" || fresh.admin_status === "hidden" ? null : tailorApplicationSteps(fresh).find(s => !s.done);
      toast(warning ? "Saved — but your map position isn't set." : hidDetails ? "Saved. " + CONTACT_HIDDEN_NOTICE
        : next ? `Profile saved. Next: ${next.label}.` : "Profile saved.");
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

function convertLocalDesignerPrices(d, from, to) {
  pricesOf(d.id).forEach(p => {
    const converted = convertMoney(p.price, p.currency_code || from, to);
    if (converted != null) { p.price = nicePrice(converted, to); p.currency_code = to; }
  });
  db.ready_to_wear.filter(i => (i.designer_id || (mainDesigner() || {}).id) === d.id).forEach(i => {
    const price = convertMoney(i.price, i.currency_code || from, to);
    const cost = convertMoney(i.cost, i.currency_code || from, to);
    if (price != null) Object.assign(i, { price: nicePrice(price, to), cost, currency_code: to });
  });
  if (d.starting_price) d.starting_price = nicePrice(convertMoney(d.starting_price, from, to) || d.starting_price, to);
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
  return `<form class="card attention" id="tailor-terms" onsubmit="return acceptTermsFromProfile(event, '${d.id}')">
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
  const groups = { pending: "Waiting", approved: "Approved", hidden: "Suspended" };
  const all = db.designers.filter(d => !d.from_search || d.is_mine);
  const shown = all.filter(d => d.admin_status === tailorAdminFilter)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const rows = shown.map(d => {
    const country = countryByCode(d.country_code);
    return `<div class="tailor-admin-row">
      <img class="tailor-logo" src="${escapeHtml(photoUrl(d.profile_image) || photoUrl(`logo:${initialsOf(d.business_name)}:1e2a44`))}" alt="">
      <div class="grow">
        <b>${escapeHtml(d.business_name)}</b>
        <div class="muted small-text">${country ? country.flag + " " + escapeHtml(country.name) : "No country yet"}${d.city ? " · " + escapeHtml(d.city) : ""}${d.postcode ? " · " + escapeHtml(d.postcode) : ""}
          ${d.public_latitude == null ? ` · <span class="owed">no map position</span>` : ""}${d.phone ? ` · 📞 ${escapeHtml(d.phone)}` : ""}</div>
        <div class="small-text">${escapeHtml(d.owner_name || "Owner name missing")}${d.address_line ? " · " + escapeHtml(d.address_line) : " · address missing"}</div>
        <div class="small-text">${escapeHtml((d.speciality_tags || []).join(", ") || "No specialities yet")} · ${(d.portfolio || []).length} portfolio photo${(d.portfolio || []).length === 1 ? "" : "s"}${d.description ? "" : " · no description"}</div>
        <div class="small-text verification-links">
          ${typeof adminVerificationLink === "function" ? adminVerificationLink(d.verification_id, "Government ID") : ""}
          · ${typeof adminVerificationLink === "function" ? adminVerificationLink(d.verification_address, "Proof of address") : ""}
          ${d.business_registration && typeof adminVerificationLink === "function" ? " · " + adminVerificationLink(d.business_registration, "Business registration") : " · business registration not supplied"}
        </div>
        ${d.admin_note ? `<div class="small-text owed">Hidden because: ${escapeHtml(d.admin_note)}</div>` : ""}
        ${d.tailor_terms_accepted_at ? `<div class="small-text paid">✓ Accepted the tailor terms ${formatDate(String(d.tailor_terms_accepted_at).slice(0, 10))}</div>`
          : d.is_mine === false ? "" : `<div class="small-text owed">Hasn't accepted the tailor terms yet</div>`}
      </div>
      <div class="nowrap job-buttons">
        <a class="button small ghost" href="${escapeHtml(appUrl("customer", "tailor/" + d.slug))}" target="_blank" rel="noopener">View page</a>
        ${d.admin_status === "hidden" ? `<button class="small gold" onclick="setTailorStatus('${d.id}', 'approved')">Restore</button>`
          : d.admin_status !== "approved" ? `<button class="small gold" onclick="setTailorStatus('${d.id}', 'approved')">✓ Approve</button>` : ""}
        ${d.admin_status !== "hidden" && d.id !== (mainDesigner() || {}).id ? `<button class="small danger" onclick="setTailorStatus('${d.id}', 'hidden')">Suspend</button>` : ""}
      </div>
    </div>`;
  }).join("");
  return `
    ${bizHeader("Tailors", `Approve new tailors before customers can find them. Suspend a profile to remove it from customer search and public pages, then restore it later if needed.`)}
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
    note = prompt(`Why suspend ${d.business_name}? They'll see this note.`, "");
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
