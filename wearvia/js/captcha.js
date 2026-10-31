// ============================================================
// captcha.js — Cloudflare Turnstile on sign-in, sign-up and "forgot password".
//
// Off until TURNSTILE_SITE_KEY is set in config.js. Once Supabase's CAPTCHA
// protection is switched on (Authentication -> Attack Protection), Supabase
// refuses those requests without a valid token, even when someone calls
// Supabase directly instead of using the app.
// Usually invisible: Turnstile only shows a checkbox if it's unsure.
// ============================================================

const Captcha = (() => {
  let token = "";
  let widgetId = null;
  let loading = null;

  function enabled() {
    return typeof TURNSTILE_SITE_KEY === "string" && TURNSTILE_SITE_KEY.trim().length > 0;
  }

  function load() {
    if (window.turnstile) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error("captcha script failed to load")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // Placeholder for the widget, to put inside a form just above its button.
  function html() {
    return enabled() ? `<div id="auth-captcha" class="captcha"></div>` : "";
  }

  // Draw the widget into the placeholder (call after the form is on the page).
  function mount(selector) {
    token = "";
    if (!enabled()) return;
    const el = document.querySelector(selector || "#auth-captcha");
    if (!el) return;
    load().then(() => {
      if (!el.isConnected) return;
      if (widgetId !== null) { try { window.turnstile.remove(widgetId); } catch (_e) { /* already gone */ } }
      widgetId = window.turnstile.render(el, {
        sitekey: TURNSTILE_SITE_KEY.trim(),
        appearance: "interaction-only",
        size: "flexible",
        callback: (t) => { token = t; },
        "expired-callback": () => { token = ""; },
        "error-callback": () => { token = ""; },
      });
    }).catch(() => { /* shown as "please try again" when the form is sent */ });
  }

  function get() { return token; }

  // Tokens work once: get a fresh one after every attempt.
  function reset() {
    token = "";
    if (widgetId !== null && window.turnstile) { try { window.turnstile.reset(widgetId); } catch (_e) { /* ignore */ } }
  }

  return { enabled, html, mount, get, reset };
})();
