// ============================================================
// auth.js — signing in, creating an account, resetting a password,
// and the account bits in the top bar and footer
//
// Each NebedaHub app has its own sign-in page and sign-up: customers sign up
// in NebedaHub, tailors in NebedaHub Business (then wait for approval),
// fabric sellers in NebedaHub Seller. Admins are made in Supabase, so
// NebedaHub Admin only signs in. Tailor staff are added by the owner
// (Business → Tailor Team → Team logins), then create an account with that
// email. The same email works in every app; each app keeps its own sign-in.
// ============================================================

// The kind of account each app's sign-up makes
const SIGN_UP_TYPE = { customer: "customer", business: "designer", seller: "seller", admin: null };
const SIGN_IN_INTRO = {
  customer: "",
  business: "For tailors, designers and their staff.",
  seller: "For fabric sellers.",
  admin: "Only for the NebedaHub team."
};
const SIGN_UP_PROMPT = { customer: `New to NebedaHub?`, business: "New here?", seller: "New here?" };
const SIGN_UP_BUTTON = { customer: "Create an account", business: "Join as a tailor or designer", seller: "Open your fabric shop" };

// "NebedaHub" plus the app's own word: NebedaHub Business, Seller, Admin
function brandHtml() {
  const word = APP.name.slice(APP_NAME.length).trim();
  return escapeHtml(APP_NAME) + (word ? ` <span class="app-word">${escapeHtml(word)}</span>` : "");
}

// Small links to the other apps, under the sign-in and sign-up forms
function otherAppsLine() {
  const links = {
    customer: [["business", "Tailor or designer?", "NebedaHub Business"], ["seller", "Sell fabric?", "NebedaHub Seller"]],
    business: [["customer", "Want an outfit made?", "NebedaHub"]],
    seller: [["customer", "Want an outfit made?", "NebedaHub"]],
    admin: []
  }[APP_KIND];
  return links.length ? `<p class="meta other-apps">${links.map(([kind, question, name]) =>
    `${question} <a href="${escapeHtml(appUrl(kind, kind === "customer" ? "" : "welcome"))}">${name}</a>`).join(" · ")}</p>` : "";
}

const Auth = (() => {
  let screen = "signIn";
  let message = "";         // a note shown above the form (e.g. "check your email")
  let error = "";
  let busy = false;
  const accountType = SIGN_UP_TYPE[APP_KIND];
  let staffSignUp = false;   // NebedaHub Business: "I work for a tailor" instead of starting a business

  function show(which) {
    screen = which || "signIn";
    busy = false;
    document.getElementById("auth-view").hidden = false;
    ["customer-view", "business-view", "seller-view", "join-view", "admin-view"].forEach(id => {
      const view = document.getElementById(id);
      if (view) view.hidden = true;
    });
    document.body.classList.remove("in-business");
    drawChrome();
    draw();
  }

  function hide() {
    const el = document.getElementById("auth-view");
    el.hidden = true;
    el.innerHTML = "";
  }

  function flash(text) { message = text; }

  function loading(text) {
    document.getElementById("auth-view").hidden = false;
    document.getElementById("auth-view").innerHTML = `<div class="auth-card"><p class="auth-loading"><span class="gen-spin"></span>${escapeHtml(text || `Loading ${APP.name}…`)}</p></div>`;
  }

  function field(label, name, type, extra) {
    return `<label class="field">${label}<input name="${name}" type="${type}" ${extra || ""}></label>`;
  }

  function notes() {
    return `${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}
      <div id="auth-error" class="form-error" role="alert">${escapeHtml(error)}</div>`;
  }

  function demoBox() {
    return `<div class="auth-demo">
      <p>Just looking? The demo has sample ${APP_KIND === "customer" ? "tailors, fabrics and orders" : APP_KIND === "seller" ? "fabric shops and orders" : "tailors, customers and orders"}. Nothing you do in it is saved online.</p>
      <button type="button" class="btn-outline" onclick="Cloud.enterDemo()">Try the demo</button>
    </div>`;
  }

  function draw() {
    const el = document.getElementById("auth-view");
    const title = { signIn: "Sign in", signUp: "Create your account", forgot: "Reset your password", newPassword: "Choose a new password" }[screen];
    let body = "";
    if (screen === "signIn") {
      body = `
        ${SIGN_IN_INTRO[APP_KIND] ? `<p class="meta">${SIGN_IN_INTRO[APP_KIND]}</p>` : ""}
        <form class="stack" onsubmit="return Auth.submit(event)">
          ${field("Email", "email", "email", 'required autocomplete="email"')}
          ${field("Password", "password", "password", 'required autocomplete="current-password"')}
          ${notes()}
          <button class="cta" type="submit" ${busy ? "disabled" : ""}>${busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <button class="linkish" onclick="Auth.show('forgot')">Forgot your password?</button>
        ${accountType ? `<p class="auth-switch">${SIGN_UP_PROMPT[APP_KIND]} <button class="linkish strong" onclick="Auth.show('signUp')">${SIGN_UP_BUTTON[APP_KIND]}</button></p>`
          : `<p class="meta auth-staff">Admin accounts are set up by the NebedaHub team in Supabase.</p>`}
        ${otherAppsLine()}`;
    } else if (screen === "signUp") {
      const seller = accountType === "seller";
      const tailor = accountType === "designer" && !staffSignUp;
      const option = (staff, label) => `<button type="button" role="radio" aria-checked="${staffSignUp === staff}" class="optbtn ${staffSignUp === staff ? "sel" : ""}" onclick="Auth.setStaff(${staff})">${label}</button>`;
      body = `
        ${accountType === "designer" ? `<div class="optbtns" role="radiogroup" aria-label="Account type">${option(false, "I'm a tailor or designer")}${option(true, "I work for a tailor")}</div>` : ""}
        <p class="meta">${staffSignUp
          ? `Use the email your tailor added under Tailor Team → Team logins. Once you've confirmed it, you'll see their Business dashboard.`
          : seller
          ? `Put your fabrics in front of customers and tailors on ${APP_NAME}. You'll set up your shop next.`
          : tailor
            ? `Get found by customers near you and run quotes, chats, orders and payments from your own dashboard. New tailors are checked by the ${APP_NAME} team before customers can see them.`
            : `Find tailors near you, then design, order and track your outfits.`}</p>
        <form class="stack" onsubmit="return Auth.submit(event)">
          ${tailor ? field("Business name", "businessName", "text", 'required maxlength="80" autocomplete="organization"') : ""}
          <label class="field">Country <small>${tailor ? "(your prices are in its currency — you can change that later)" : seller ? "" : "(for prices in your currency)"}</small><select name="country" ${tailor || seller ? "required" : ""} onchange="if (this.form.phone_cc) this.form.phone_cc.value = this.value">${countryOptions(browserCountry(), "Choose your country")}</select></label>
          ${tailor ? field("City or town", "city", "text", 'required maxlength="60" autocomplete="address-level2"') : ""}
          ${field("Your name", "name", "text", 'required autocomplete="name" maxlength="80"')}
          <label class="field">Phone <small>(optional)</small>${phoneFieldHtml("phone", "", browserCountry())}</label>
          ${field("Email", "email", "email", 'required autocomplete="email"')}
          ${field("Password <small>(at least 8 characters)</small>", "password", "password", 'required minlength="8" autocomplete="new-password"')}
          ${tailor ? tailorTermsHtml(false) + tailorTermsCheckbox() : ""}
          ${notes()}
          <button class="cta" type="submit" ${busy ? "disabled" : ""}>${busy ? "Creating your account…" : "Create account"}</button>
        </form>
        <p class="auth-switch">Already have a ${APP_NAME} account? <button class="linkish strong" onclick="Auth.show('signIn')">Sign in</button></p>
        ${tailor ? `<p class="meta auth-staff">Work for a tailor on ${APP_NAME}? Ask the owner to add your email under Tailor Team, then choose <b>I work for a tailor</b> above.</p>` : ""}
        ${otherAppsLine()}`;
    } else if (screen === "forgot") {
      body = `
        <form class="stack" onsubmit="return Auth.submit(event)">
          <p class="meta">We'll email you a link to choose a new password.</p>
          ${field("Email", "email", "email", 'required autocomplete="email"')}
          ${notes()}
          <button class="cta" type="submit" ${busy ? "disabled" : ""}>${busy ? "Sending…" : "Send the link"}</button>
        </form>
        <button class="linkish" onclick="Auth.show('signIn')">Back to sign in</button>`;
    } else {
      body = `
        <form class="stack" onsubmit="return Auth.submit(event)">
          ${field("New password <small>(at least 8 characters)</small>", "password", "password", 'required minlength="8" autocomplete="new-password"')}
          ${notes()}
          <button class="cta" type="submit" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save password"}</button>
        </form>`;
    }
    el.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">${brandHtml()}</div>
        <div class="auth-tag">${APP_KIND === "customer" ? APP_TAGLINE : `For ${APP.who}`}</div>
        <h1>${title}</h1>
        ${body}
      </div>
      ${screen === "newPassword" ? "" : APP_KIND === "customer" ? `<button type="button" class="btn-outline find-tailors-link" onclick="Auth.browseTailors()">📍 Just looking? Find tailors near me</button>`
        : APP_KIND !== "admin" ? `<button type="button" class="btn-outline find-tailors-link" onclick="Auth.browseWelcome()">How ${APP.name} works</button>` : ""}
      ${screen === "newPassword" ? "" : demoBox()}`;
    document.title = `${title} · ${APP.name}`;
  }

  function startSignUp() {
    show(accountType ? "signUp" : "signIn");
  }

  function setStaff(staff) {
    const form = document.querySelector("#auth-view form");
    const kept = form ? { name: form.name.value, phone: form.phone.value, phone_cc: form.phone_cc.value, email: form.email.value, country: form.country.value } : null;
    staffSignUp = !!staff;
    draw();
    if (kept) {
      const again = document.querySelector("#auth-view form");
      Object.keys(kept).forEach(k => { again[k].value = kept[k]; });
    }
  }

  // Look at tailors without an account
  function browseTailors() {
    const open = () => { hide(); drawChrome(); go("tailors"); };
    if (db) return open();
    Cloud.startGuest().then(open);
  }

  // The Business or Seller welcome page, without an account
  function browseWelcome() {
    const open = () => { hide(); drawChrome(); go("welcome"); };
    if (db) return open();
    Cloud.startGuest().then(open);
  }

  function setError(text) {
    error = text || "";
    const el = document.getElementById("auth-error");
    if (el) el.textContent = error;
  }

  function submit(event) {
    event.preventDefault();
    if (busy) return false;
    const form = event.target;
    const values = {};
    Array.from(form.elements).forEach(input => { if (input.name) values[input.name] = input.value.trim(); });
    if (values.password !== undefined) values.password = form.password.value; // passwords may start or end with spaces
    if (form.phone_cc) values.phone = readPhone(form, "phone");            // "+234 803 555 0142"
    if (form.acceptTerms) values.acceptTerms = form.acceptTerms.checked;
    if ((screen === "signUp" || screen === "newPassword") && values.password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return false;
    }
    busy = true;
    error = "";
    message = "";
    const button = form.querySelector("button[type=submit]");
    if (button) { button.disabled = true; button.textContent = "Please wait…"; }

    let work;
    if (screen === "signIn") {
      work = Cloud.signIn(values.email, values.password).then(() => enterApp());
    } else if (screen === "signUp") {
      const type = accountType === "designer" && staffSignUp ? "customer" : accountType;   // staff are added to their tailor when they confirm
      if (type === "designer" && (!values.businessName || !values.country || !values.city)) {
        busy = false;
        setError("Enter your business name, country and city.");
        if (button) { button.disabled = false; button.textContent = "Create account"; }
        return false;
      }
      if (type === "designer" && (!values.acceptTerms || hideContactDetails(values.businessName).hidden)) {
        busy = false;
        setError(values.acceptTerms ? "Your business name can't include a phone number, email, website or social handle."
          : "Please tick the box to agree to the tailor terms.");
        if (button) { button.disabled = false; button.textContent = "Create account"; }
        return false;
      }
      work = Cloud.signUp({ email: values.email, password: values.password, name: values.name, phone: values.phone, accountType: type,
                            businessName: values.businessName, country: values.country, city: values.city, acceptTerms: !!values.acceptTerms,
                            unit: customerBodyUnit({ country_code: values.country }) })
        .then(result => {
          if (result.needsConfirmation) {
            message = `Nearly done! We've sent a link to ${values.email}. Open it to confirm your email, then sign in here.`;
            show("signIn");
            const email = document.querySelector("#auth-view [name=email]");
            if (email) email.value = values.email;
          } else {
            enterApp();
          }
        });
    } else if (screen === "forgot") {
      work = Cloud.sendPasswordReset(values.email).then(() => {
        message = `If there's an account for ${values.email}, a reset link is on its way. Open it on this device.`;
        show("signIn");
      });
    } else {
      work = Cloud.setNewPassword(values.password).then(() => {
        toast("Password changed.");
        enterApp();
      });
    }
    work.catch(problem => {
      busy = false;
      error = problem.message || String(problem);
      draw();
      const again = document.querySelector("#auth-view form");
      if (again) Object.keys(values).forEach(k => { if (again[k] && k !== "password") again[k].value = values[k]; });
    });
    return false;
  }

  // Signed in: open the part of the app this person uses
  function enterApp() {
    busy = false;
    message = "";
    error = "";
    hide();
    drawChrome();
    const route = currentRoute();
    let after = null;
    try { after = sessionStorage.getItem("wearvia-after-sign-in"); sessionStorage.removeItem("wearvia-after-sign-in"); } catch (e) { /* private browsing */ }
    // Landing pages (the app's home, or the welcome page) open where this person starts in this app
    const landing = ["", "#", "#/", "#/home", "#/welcome", "#/" + APP.home].includes(location.hash);
    if (after && APP_KIND === "customer") go(after, true);
    else if (landing || (APP_KIND === "business" && route.screen === "join" && Cloud.isTeam())) go(Cloud.homeRoute(), true);
    else renderAll();
  }

  // Top bar and footer: who is signed in, demo mode, which areas they can open
  function drawChrome() {
    const account = document.getElementById("account");
    const footer = document.getElementById("footer-text");
    if (!Cloud.live) {
      account.innerHTML = `<span class="demo-pill" title="Sample data in this browser only">Demo mode</span>
        <button class="chip-button" onclick="Cloud.leaveDemo()">Sign in</button>`;
      footer.innerHTML = `Demo mode: sample data, saved in this browser only.
        <button class="link-button" onclick="resetSampleData()">Reset to sample data</button> ·
        <button class="link-button" onclick="Cloud.leaveDemo()">Leave demo</button>`;
    } else if (Cloud.isGuest()) {
      account.innerHTML = `<button class="chip-button" onclick="Auth.show('signIn')">Sign in</button>`;
      footer.innerHTML = `${APP.name} · ${APP_KIND === "customer" ? "Tailors near you" : "For " + APP.who}. <button class="link-button" onclick="Auth.show('signIn')">Sign in</button>${APP_KIND === "customer" ? " to order" : ""}.`;
    } else if (Cloud.me) {
      const me = Cloud.me;
      const role = APP_KIND === "admin" ? (me.is_admin ? "Admin" : "")
        : APP_KIND === "business" ? (me.is_admin ? "Admin" : me.is_team ? (me.is_owner ? "Owner" : "Team") : "") : "";
      account.innerHTML = `<span class="who" title="${escapeHtml(me.email)}">${escapeHtml(me.name || me.email)}${role ? ` · <b>${role}</b>` : ""}</span>
        <button class="chip-button" onclick="Auth.signOut()">Sign out</button>`;
      footer.innerHTML = `Signed in as ${escapeHtml(me.email)}. Your data is saved securely online and shared across your devices.
        <button class="link-button" onclick="Cloud.enterDemo()">Open the demo</button>`;
    } else {
      account.innerHTML = "";
      footer.innerHTML = `${APP.name} · ${APP_KIND === "customer" ? APP_TAGLINE : "For " + APP.who}`;
    }
  }

  // The app's name in the top bar and on the sign-in card: "NebedaHub Business"
  function drawBrand() {
    document.getElementById("app-name").innerHTML = brandHtml();
  }

  function signOut() {
    Cloud.signOut().catch(problem => toast(problem.message));
  }

  return { show, hide, flash, loading, submit, startSignUp, setStaff, browseTailors, browseWelcome, enterApp, drawChrome, drawBrand, signOut };
})();
