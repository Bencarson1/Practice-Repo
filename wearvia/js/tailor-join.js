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
      <li><b>Create your tailor profile</b><span>Your business name, where you are, and the ${APP_NAME} tailor terms.</span></li>
      <li><b>Show your work and set your prices</b><span>Add your photo, specialities and portfolio, and your prices for each outfit.</span></li>
      <li><b>Get approved and receive orders</b><span>The ${APP_NAME} team checks your profile, then customers can find you and send quote requests.</span></li>
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
  return `
    ${bizHeader("Create your tailor profile", `Get found by customers near you. Your ${APP.name} dashboard handles quote requests, the chat with each customer, orders, payments and your team.`)}
    <div class="card join-form">
      <ol class="join-steps"><li>Tell us your business name and where you are.</li><li>Add your photo, specialities and portfolio in <b>My profile</b>.</li><li>The ${APP_NAME} team checks and approves you — then customers can find you.</li></ol>
      <form class="stack" onsubmit="return joinAsTailor(event)">
        <label class="field">Business name<input name="business" required minlength="2" maxlength="80" placeholder="e.g. Ade's Tailoring"></label>
        <label class="field">Country <small>(your prices are in its currency — you can change that later)</small><select name="country" required onchange="if (this.form.phone_cc) this.form.phone_cc.value = this.value">${countryOptions(browserCountry(), "Choose your country")}</select></label>
        <label class="field">City or town<input name="city" required maxlength="60" placeholder="e.g. Manchester"></label>
        <label class="field">Phone <small>(only the ${APP_NAME} team sees it)</small>${phoneFieldHtml("phone", "", browserCountry())}</label>
        ${tailorTermsHtml(false)}
        ${tailorTermsCheckbox()}
        <p id="join-error" class="form-error" role="alert"></p>
        <button class="cta" type="submit">Create my tailor profile</button>
      </form>
    </div>`;
}

function joinAsTailor(event) {
  event.preventDefault();
  const form = event.target;
  const details = { businessName: form.business.value.trim(), country: form.country.value, city: form.city.value.trim(), phone: readPhone(form, "phone"),
                    acceptTerms: form.acceptTerms.checked };
  if (details.businessName.length < 2) return formError("join-error", "Enter your business name.");
  if (hideContactDetails(details.businessName).hidden) return formError("join-error", "Your business name can't include a phone number, email, website or social handle.");
  if (!details.acceptTerms) return formError("join-error", "Please tick the box to agree to the tailor terms.");
  if (!details.country) return formError("join-error", "Choose your country.");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Creating…";
  if (Cloud.live) {
    Cloud.registerDesigner(details)
      .then(() => { Auth.drawChrome(); toast("Your tailor profile is made. Add your photo and details, then wait for approval."); go("profile"); })
      .catch(error => { button.disabled = false; button.textContent = "Create my tailor profile"; formError("join-error", error.message); });
    return false;
  }
  // Demo: a new tailor, waiting for the admin (you) to approve it in NebedaHub Admin → Tailors
  const id = "D" + (db.designers.reduce((max, d) => Math.max(max, Number(String(d.id).slice(1)) || 0), 0) + 1);
  const d = refreshDesignerPublic({
    id, business_name: details.businessName, country_code: details.country, city: details.city, postcode: "", address_line: "",
    latitude: null, longitude: null, show_exact_address: false, speciality_tags: [], delivery_available: false, custom_orders: true,
    rating: null, review_count: 0, profile_image: null, description: "", delivery_time: "7–14 days", admin_status: "pending",
    admin_note: "", portfolio: [], phone: details.phone, location: "", demo: true, tailor_terms_accepted_at: new Date().toISOString()
  });
  db.designers.push(d);
  d.currency_code = countryCurrency(details.country) || "GBP";   // their country's currency; they can change it in My profile
  db.prices = db.prices.concat(newPriceListFor(id, null, d.currency_code));
  db.session.designerId = id;
  saveData();
  toast(`${d.business_name} created. It waits for approval in ${APPS.admin.name} → Tailors.`);
  go("profile");
  return false;
}
