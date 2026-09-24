// ============================================================
// auth.js — signing in, creating an account, resetting a password,
// and the account bits in the top bar and footer
//
// Customers and fabric sellers create their own accounts here.
// Nebeda Threads staff are added by the owner (Business → Tailor Team →
// Team logins), then create an account with that email.
// ============================================================

const Auth = (() => {
  let screen = "signIn";
  let message = "";         // a note shown above the form (e.g. "check your email")
  let error = "";
  let busy = false;
  let accountType = "customer";

  function show(which) {
    screen = which || "signIn";
    busy = false;
    document.getElementById("auth-view").hidden = false;
    ["customer-view", "business-view", "seller-view"].forEach(id => { document.getElementById(id).hidden = true; });
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
    document.getElementById("auth-view").innerHTML = `<div class="auth-card"><p class="auth-loading"><span class="gen-spin"></span>${escapeHtml(text || "Loading Wearvia…")}</p></div>`;
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
      <p>Just looking? The demo has sample customers, orders and fabric sellers. Nothing you do in it is saved online.</p>
      <button type="button" class="btn-outline" onclick="Cloud.enterDemo()">Try the demo</button>
    </div>`;
  }

  function draw() {
    const el = document.getElementById("auth-view");
    const title = { signIn: "Sign in", signUp: "Create your account", forgot: "Reset your password", newPassword: "Choose a new password" }[screen];
    let body = "";
    if (screen === "signIn") {
      body = `
        <form class="stack" onsubmit="return Auth.submit(event)">
          ${field("Email", "email", "email", 'required autocomplete="email"')}
          ${field("Password", "password", "password", 'required autocomplete="current-password"')}
          ${notes()}
          <button class="cta" type="submit" ${busy ? "disabled" : ""}>${busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <button class="linkish" onclick="Auth.show('forgot')">Forgot your password?</button>
        <p class="auth-switch">New to ${APP_NAME}? <button class="linkish strong" onclick="Auth.show('signUp')">Create an account</button></p>`;
    } else if (screen === "signUp") {
      const seller = accountType === "seller";
      body = `
        <div class="optbtns two" role="radiogroup" aria-label="Account type">
          <button type="button" role="radio" aria-checked="${!seller}" class="optbtn ${seller ? "" : "sel"}" onclick="Auth.setType('customer')">I want outfits made</button>
          <button type="button" role="radio" aria-checked="${seller}" class="optbtn ${seller ? "sel" : ""}" onclick="Auth.setType('seller')">I sell fabric</button>
        </div>
        <p class="meta">${seller
          ? `Fabric sellers put their fabrics on ${APP_NAME} for ${escapeHtml(SHOP_NAME)}'s customers. You'll set up your shop next.`
          : `Design, order and track outfits from ${escapeHtml(SHOP_NAME)}.`}</p>
        <form class="stack" onsubmit="return Auth.submit(event)">
          ${field("Your name", "name", "text", 'required autocomplete="name" maxlength="80"')}
          ${field("Phone <small>(optional)</small>", "phone", "tel", 'autocomplete="tel" maxlength="20"')}
          ${field("Email", "email", "email", 'required autocomplete="email"')}
          ${field("Password <small>(at least 8 characters)</small>", "password", "password", 'required minlength="8" autocomplete="new-password"')}
          ${notes()}
          <button class="cta" type="submit" ${busy ? "disabled" : ""}>${busy ? "Creating your account…" : "Create account"}</button>
        </form>
        <p class="auth-switch">Already have an account? <button class="linkish strong" onclick="Auth.show('signIn')">Sign in</button></p>
        <p class="meta auth-staff">Work at ${escapeHtml(SHOP_NAME)}? Ask the owner to add your email under Tailor Team, then create an account here with that email.</p>`;
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
        <div class="auth-brand">WEARVIA</div>
        <div class="auth-tag">Bespoke · Ready to Wear · ${escapeHtml(SHOP_NAME)}</div>
        <h1>${title}</h1>
        ${body}
      </div>
      ${screen === "newPassword" ? "" : demoBox()}`;
    document.title = `${title} · ${APP_NAME}`;
  }

  function setType(type) {
    const form = document.querySelector("#auth-view form");
    const kept = form ? { name: form.name.value, phone: form.phone.value, email: form.email.value } : null;
    accountType = type;
    draw();
    if (kept) {
      const again = document.querySelector("#auth-view form");
      Object.keys(kept).forEach(k => { again[k].value = kept[k]; });
    }
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
      work = Cloud.signUp({ email: values.email, password: values.password, name: values.name, phone: values.phone, accountType })
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
    if (!location.hash || location.hash === "#/home" || !Cloud.canOpen(route.area)) go(Cloud.homeRoute(), true);
    else renderAll();
  }

  // Top bar and footer: who is signed in, demo mode, which areas they can open
  function drawChrome() {
    const account = document.getElementById("account");
    const footer = document.getElementById("footer-text");
    document.getElementById("mode-business").hidden = !Cloud.canOpen("business") || (Cloud.live && !Cloud.me);
    document.querySelector(".modes").hidden = Cloud.live && !Cloud.me;
    if (!Cloud.live) {
      account.innerHTML = `<span class="demo-pill" title="Sample data in this browser only">Demo mode</span>
        <button class="chip-button" onclick="Cloud.leaveDemo()">Sign in</button>`;
      footer.innerHTML = `Demo mode: sample data, saved in this browser only.
        <button class="link-button" onclick="resetSampleData()">Reset to sample data</button> ·
        <button class="link-button" onclick="Cloud.leaveDemo()">Leave demo</button>`;
    } else if (Cloud.me) {
      const me = Cloud.me;
      account.innerHTML = `<span class="who" title="${escapeHtml(me.email)}">${escapeHtml(me.name || me.email)}${me.is_team ? ` · <b>${me.is_owner ? "Owner" : "Team"}</b>` : ""}</span>
        <button class="chip-button" onclick="Auth.signOut()">Sign out</button>`;
      footer.innerHTML = `Signed in as ${escapeHtml(me.email)}. Your data is saved securely online and shared across your devices.
        <button class="link-button" onclick="Cloud.enterDemo()">Open the demo</button>`;
    } else {
      account.innerHTML = "";
      footer.innerHTML = `${APP_NAME} · ${escapeHtml(SHOP_NAME)}`;
    }
  }

  function signOut() {
    Cloud.signOut().catch(problem => toast(problem.message));
  }

  return { show, hide, flash, loading, submit, setType, enterApp, drawChrome, signOut };
})();
