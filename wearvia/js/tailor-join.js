// ============================================================
// tailor-join.js — NebedaHub Business before someone is a tailor
//   #/welcome  how joining works, why join, and the way in
//   #/join     "Create your tailor profile" for someone already signed in
// Someone new signs up as a tailor on the Business sign-up page. Someone
// with a NebedaHub account from another app (a customer, a fabric seller)
// signs in here and joins with #/join. Approved tailors use the dashboard.
// ============================================================

// The tailor business the signed-in person owns or works for, if any
function myTailorBusiness() {
  if (Cloud.live) {
    const list = (Cloud.me && Cloud.me.designers) || [];
    const mine = list.find(x => x.is_owner) || list[0];
    return mine ? Object.assign({}, mine, designerById(mine.id) || {}) : null;
  }
  // Demo: a tailor made with "Join as a tailor" in this browser
  const d = db.session && db.session.designerId ? designerById(db.session.designerId) : null;
  return d && d.demo ? d : null;
}

function renderTailorJoin(screen) {
  const joining = screen === "join" && !Cloud.isGuest();
  document.getElementById("join-tabs").innerHTML = `<a class="tab ${joining ? "" : "active"}" href="#/welcome">Tailors on ${APP_NAME}</a>
    ${Cloud.isGuest() || myTailorBusiness() ? "" : `<a class="tab ${joining ? "active" : ""}" href="#/join">Create your tailor profile</a>`}`;
  document.getElementById("join-content").innerHTML = joining ? tailorJoinForm() : tailorWelcome();
  document.title = `${joining ? "Create your tailor profile" : "Join as a tailor"} · ${APP.name}`;
}

function startTailorJoin() {
  if (Cloud.isGuest()) Auth.startSignUp();
  else go("join");
}

function tailorWelcome() {
  const mine = myTailorBusiness();
  const status = mine ? mine.admin_status : null;
  let join;
  if (status === "approved") {
    join = `<div class="card">
        <h2>${escapeHtml(mine.business_name)}</h2>
        <p class="hint">You're an approved tailor on ${APP_NAME}. Your quotes, chats, orders and payments are in your Business dashboard.</p>
        <a class="button" href="#/dashboard">Open your Business dashboard</a>
      </div>`;
  } else if (status === "pending") {
    join = `<div class="card">
        <h2>Waiting for approval</h2>
        <p class="hint">Thanks for joining! The ${APP_NAME} team is checking <b>${escapeHtml(mine.business_name)}</b>. We'll approve you as soon as we can — then customers near you can find you.</p>
        <p class="hint">While you wait, add your photo, specialities and portfolio in My profile.</p>
        <a class="button ghost" href="#/profile">Finish your profile</a>
      </div>`;
  } else if (mine) {
    join = `<div class="card">
        <h2>${escapeHtml(mine.business_name)}</h2>
        <p class="hint">Your tailor profile is hidden from customers at the moment. Open My profile to see why and what to change.</p>
        <a class="button ghost" href="#/profile">Open My profile</a>
      </div>`;
  } else {
    join = `<div class="card">
        <h2>New tailor or designer</h2>
        <p class="hint">It takes about two minutes.</p>
        <button class="gold" onclick="startTailorJoin()">Join as a tailor or designer</button>
      </div>`;
  }
  const notYet = Cloud.live && Cloud.me && !Cloud.isTeam();
  return `
    ${bizHeader(`Join ${APP_NAME} as a tailor or designer`, `Get found by customers near you, and run every order from one place.`)}
    ${notYet ? `<div class="notice no-shop">This account (${escapeHtml(Cloud.me.email)}) isn't a tailor yet. <button class="linkish strong" onclick="go('join')">Join as a tailor</button> — or <a href="${escapeHtml(appUrl("customer", ""))}">open the customer app</a>.</div>` : ""}
    <ol class="how-steps">
      <li><b>Create your tailor profile</b><span>Add your business details, address, specialities and the ${APP_NAME} tailor terms.</span></li>
      <li><b>Verify your business</b><span>Upload your ID, proof of address, profile photo and examples of your work.</span></li>
      <li><b>Get approved and quote each job</b><span>The ${APP_NAME} team checks your application, then customers can send you quote requests and you decide your price for each order.</span></li>
    </ol>
    <div class="card">
      <h2>Why join ${APP_NAME}</h2>
      <ul class="benefit-list">
        <li>Customers near you looking for a tailor</li>
        <li>Listed in <b>Find tailors near me</b> and on Google</li>
        <li>Secure payments through ${APP_NAME}</li>
        <li>Quote requests and a chat with each customer</li>
        <li>Order and production tools to keep track of every outfit</li>
      </ul>
    </div>
    <div class="two-col">
      ${join}
      <div class="card">
        <h2>Already a tailor?</h2>
        <p class="hint">Approved tailors and their staff run their business here in ${APP.name}: quote requests, orders, production, payments and your team.${Cloud.isGuest() ? " Sign in to open your dashboard." : ""}</p>
        ${Cloud.isGuest() ? `<button class="ghost" onclick="Auth.show('signIn')">Sign in</button>` : ""}
      </div>
    </div>`;
}

// ---- Create your tailor profile (someone already signed in, or in the demo) ----

function tailorJoinForm() {
  const mine = myTailorBusiness();
  if (mine) {
    return `<div class="card">
      <h2>You already have a tailor business</h2>
      <p class="hint"><b>${escapeHtml(mine.business_name)}</b> is yours on ${APP_NAME}.</p>
      <a class="button" href="#/profile">Open My profile</a></div>`;
  }
  const specs = specialityList().filter(x => x.active !== false);
  const me = Cloud.me || {};
  return `
    ${bizHeader("Create your tailor profile", `Complete your business details and verification before the ${APP_NAME} team can approve your account.`)}
    <div class="card join-form">
      <p class="hint">Your verification documents are private. Customers never see your ID, proof of address, phone number or exact business address.</p>
      <form class="stack" onsubmit="return joinAsTailor(event)" novalidate>
        <h2>Owner and business</h2>
        <div class="form-grid">
          <label class="field">Owner or responsible person's full name<input name="ownerName" required maxlength="100" autocomplete="name" value="${escapeHtml(me.name || "")}"></label>
          <label class="field">Account email<input type="email" value="${escapeHtml(me.email || "")}" readonly></label>
          <label class="field">Business name<input name="business" required minlength="2" maxlength="80" placeholder="e.g. Ade's Tailoring"></label>
          <label class="field">Country<select name="country" required onchange="if (this.form.phone_cc) this.form.phone_cc.value=this.value; if(this.form.currency) this.form.currency.value=countryCurrency(this.value)||'GBP';">${countryOptions(browserCountry(), "Choose your country")}</select></label>
          <label class="field">City or town<input name="city" required maxlength="60" placeholder="e.g. Manchester"></label>
          <label class="field">Business address<input name="address" required maxlength="140" autocomplete="street-address"></label>
          <label class="field">Postcode <small>(if applicable)</small><input name="postcode" maxlength="20" autocomplete="postal-code"></label>
          <label class="field">Phone <small>(private)</small>${phoneFieldHtml("phone", "", browserCountry())}</label>
          <label class="field">Preferred currency<select name="currency" required>${currencyOptions(countryCurrency(browserCountry()) || "GBP")}</select></label>
          <label class="field">Estimated production time<select name="deliveryEstimate" required>${DELIVERY_TIMES.map(t => `<option>${escapeHtml(t)}</option>`).join("")}</select></label>
          <label class="check"><input type="checkbox" name="deliveryAvailable"> I can arrange delivery to customers</label>
        </div>

        <label class="field">About your business<textarea name="description" rows="4" maxlength="700" required placeholder="Tell customers about your experience, the kind of work you do and what makes your business different."></textarea></label>

        <fieldset class="card soft">
          <legend><b>Specialities</b></legend>
          <p class="hint">Choose at least one.</p>
          <div class="spec-tags">${specs.map(sp => `<label class="check"><input type="checkbox" name="speciality" value="${escapeHtml(sp.name)}"> ${escapeHtml(sp.name)}</label>`).join("")}</div>
        </fieldset>

        <h2>Photos of your work</h2>
        <label class="field">Profile or business photo<input name="profilePhoto" type="file" accept="image/*" required></label>
        <label class="field">Portfolio photos <small>(at least 2 clear photos of work you made)</small><input name="portfolioPhotos" type="file" accept="image/*" multiple required></label>

        <h2>Private verification</h2>
        <label class="field">Government-issued ID <small>(passport, driving licence or national ID)</small><input name="identityDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
        <label class="field">Proof of business/home address <small>(utility bill, bank statement or official letter)</small><input name="addressDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
        <label class="field">Business registration document <small>(optional if you are not formally registered)</small><input name="businessDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>

        ${tailorTermsHtml(false)}
        ${tailorTermsCheckbox()}
        <p id="join-error" class="form-error" role="alert"></p>
        <button class="cta" type="submit">Submit my tailor application</button>
      </form>
    </div>`;
}

function joinAsTailor(event) {
  event.preventDefault();
  const form = event.target;
  const specialities = Array.from(form.querySelectorAll('input[name="speciality"]:checked')).map(x => x.value);
  const portfolioFiles = Array.from(form.portfolioPhotos.files || []);
  const details = {
    ownerName: form.ownerName.value.trim(),
    businessName: form.business.value.trim(),
    country: form.country.value,
    city: form.city.value.trim(),
    address: form.address.value.trim(),
    postcode: form.postcode.value.trim(),
    phone: readPhone(form, "phone"),
    currency: form.currency.value,
    deliveryEstimate: form.deliveryEstimate.value,
    deliveryAvailable: form.deliveryAvailable.checked,
    description: form.description.value.trim(),
    specialities,
    acceptTerms: form.acceptTerms.checked
  };
  if (!details.ownerName) return formError("join-error", "Enter the owner's full name.");
  if (details.businessName.length < 2) return formError("join-error", "Enter your business name.");
  if (hideContactDetails(details.businessName).hidden) return formError("join-error", "Your business name can't include a phone number, email, website or social handle.");
  if (!details.country) return formError("join-error", "Choose your country.");
  if (!details.city) return formError("join-error", "Enter your city or town.");
  if (!details.address) return formError("join-error", "Enter your business address.");
  if (!phoneLooksRight(details.phone)) return formError("join-error", "Enter a valid phone number.");
  if (!details.description) return formError("join-error", "Tell us about your business.");
  if (!details.specialities.length) return formError("join-error", "Choose at least one speciality.");
  if (!form.profilePhoto.files[0]) return formError("join-error", "Add a profile or business photo.");
  if (portfolioFiles.length < 2) return formError("join-error", "Add at least 2 portfolio photos of work you made.");
  if (!form.identityDocument.files[0]) return formError("join-error", "Add a government-issued ID.");
  if (!form.addressDocument.files[0]) return formError("join-error", "Add proof of address.");
  if (!details.acceptTerms) return formError("join-error", "Please tick the box to agree to the tailor terms.");

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Uploading and submitting…";

  const profileFile = form.profilePhoto.files[0];
  const idFile = form.identityDocument.files[0];
  const addressFile = form.addressDocument.files[0];
  const businessFile = form.businessDocument.files[0] || null;

  Promise.all([
    resizeImage(profileFile, LOGO_MAX_SIZE, 0.85),
    Cloud.uploadVerificationFile(idFile, "tailor-id"),
    Cloud.uploadVerificationFile(addressFile, "tailor-address"),
    businessFile ? Cloud.uploadVerificationFile(businessFile, "tailor-business-registration") : Promise.resolve(null),
    Promise.all(portfolioFiles.slice(0, 8).map(file => resizeImage(file, PHOTO_MAX_SIZE, 0.82)))
  ])
    .then(([profileImageData, verificationId, verificationAddress, businessRegistration, portfolioData]) => {
      Object.assign(details, { profileImageData, verificationId, verificationAddress, businessRegistration, portfolioData });
      return Cloud.registerDesigner(details);
    })
    .then(() => {
      Auth.drawChrome();
      toast("Your tailor application has been submitted for verification.");
      go("profile");
    })
    .catch(error => {
      button.disabled = false;
      button.textContent = "Submit my tailor application";
      formError("join-error", error.message || "Couldn't submit your application.");
    });
  return false;
}
