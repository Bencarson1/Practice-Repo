// ============================================================
// payouts.js — tailor & fabric-seller payout onboarding (Stripe Connect).
//
// Shown on My profile (tailor, NebedaHub Business) and Shop & application
// (fabric seller, NebedaHub Sellers). It lets each business connect their
// bank through Stripe so NebedaHub can pay them for orders / fabric sales.
//
// Gated by PAYOUTS_ONBOARDING_ENABLED in config.js — OFF by default, so
// nothing changes until the Stripe Edge Functions are deployed and the flag
// is switched on (see supabase/STRIPE-SETUP.md).
//
// Money model (Option 1): NebedaHub keeps 10%. The seller/tailor gets 70%
// when the customer pays and the final 30% when the customer confirms the
// outfit, or automatically 7 days after delivery (supabase/auto-release.sql).
// That split is enforced on the server (Stage 2/3), never here.
// Bank details go straight to Stripe — NebedaHub never sees or stores them.
// ============================================================

let payoutStatusCache = null;      // last { tailor:{...}, seller:{...} } from the server
let payoutStatusLoading = false;
let payoutsSettledThisVisit = false; // send due payouts at most once per visit

function payoutsOnboardingOn() {
  return typeof PAYOUTS_ONBOARDING_ENABLED !== "undefined" && PAYOUTS_ONBOARDING_ENABLED
    && typeof Cloud !== "undefined" && Cloud.live;
}

// The "Payments & payouts" card. role = "tailor" | "seller".
function payoutCardHtml(role) {
  if (!payoutsOnboardingOn()) {
    return role === "seller" ? payoutsClosedHtml("fabric sellers", "customers or tailors")
                             : payoutsClosedHtml("tailors", "customers");
  }
  const sales = role === "seller" ? "fabric sales" : "orders";
  return `<div class="card" id="payout-card">
    <h2>Payments & payouts</h2>
    <p>Connect your bank through Stripe so NebedaHub can pay you for your ${sales}. You carry on working as normal — this just sets up where your money arrives.</p>
    <p class="hint">NebedaHub keeps <b>10%</b>. You receive <b>70% when the customer pays</b>, and the final <b>30% once the order passes quality control</b>.</p>
    <div id="payout-status" class="payout-status" data-role="${role}">Checking your payout status…</div>
    <div class="form-actions">
      <button class="gold" id="payout-setup-btn" onclick="startPayoutSetup('${role}', this)">Set up / manage payouts</button>
      <button type="button" class="ghost small" onclick="refreshPayoutStatus('${role}')">Refresh status</button>
    </div>
    <p class="hint">🔒 Your bank details go straight to Stripe — NebedaHub never sees or stores them.${realPaymentsOn() ? "" : " Customer payments aren't switched on yet; this only prepares your payouts."}</p>
  </div>`;
}

function payoutsClosedHtml(who, payers) {
  return `<div class="card"><h2>Payments & payouts</h2>
    <p><b>Not open yet.</b> NebedaHub is completing its protected payment and payout setup before ${who} can receive customer money.</p>
    <p class="hint">Do not ask ${payers} to pay you directly. Payout setup will be enabled here when it is ready.</p></div>`;
}

// Called after each Business/Seller render. No-op unless the card is on screen.
function schedulePayoutCheck() {
  if (!payoutsOnboardingOn()) return;
  const box = document.getElementById("payout-status");
  if (!box) return;
  const role = box.getAttribute("data-role");
  if (payoutStatusCache) { paintPayoutStatus(role); return; }
  refreshPayoutStatus(role, true);
}

function refreshPayoutStatus(role, quiet) {
  const box = document.getElementById("payout-status");
  if (box && !quiet) box.textContent = "Checking your payout status…";
  if (payoutStatusLoading) return;
  payoutStatusLoading = true;
  // Naira businesses (Nigeria) are paid through Paystack into a Nigerian bank;
  // everyone else through Stripe.
  paystackPayoutStatus(role)
    .then(handled => {
      if (handled) { payoutStatusLoading = false; return; }
      loadStripePayoutStatus(role);
    });
}

function loadStripePayoutStatus(role) {
  Cloud.payoutStatus()
    .then(data => { payoutStatusCache = data; paintPayoutStatus(role); })
    .catch(err => {
      const b = document.getElementById("payout-status");
      if (b) b.innerHTML = `<span class="owed">Couldn't check payout status: ${escapeHtml(err.message || "please try again")}.</span>`;
    })
    .finally(() => { payoutStatusLoading = false; });
}

function paintPayoutStatus(role) {
  const box = document.getElementById("payout-status");
  if (!box) return;
  const s = (payoutStatusCache && payoutStatusCache[role]) || null;
  const btn = document.getElementById("payout-setup-btn");
  const sales = role === "seller" ? "fabric sales" : "orders";
  if (!s || !s.has_account) {
    box.innerHTML = `<span class="owed">● Not set up yet.</span> Press “Set up payouts” to connect your bank through Stripe.`;
    if (btn) btn.textContent = "Set up payouts";
  } else if (s.payouts_enabled && s.details_submitted) {
    box.innerHTML = `<span class="paid">● Payouts connected.</span> You're ready to be paid for your ${sales}.`;
    if (btn) btn.textContent = "Manage payout details";
    // Anything that became due before payouts were connected is sent now
    if (!payoutsSettledThisVisit && typeof Cloud.settlePayouts === "function") {
      payoutsSettledThisVisit = true;
      Cloud.settlePayouts({ scope: "mine" });
    }
  } else {
    box.innerHTML = `<span class="owed">● Almost there.</span> Stripe still needs a few details before you can be paid. Press “Finish payout setup”.`;
    if (btn) btn.textContent = "Finish payout setup";
  }
}

function startPayoutSetup(role, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Opening Stripe…"; }
  Cloud.startPayoutOnboarding(role)
    .then(url => { window.location.href = url; })
    .catch(err => {
      if (btn) { btn.disabled = false; btn.textContent = "Set up / manage payouts"; }
      alert(err.message || "Couldn't start payout setup. Please try again.");
    });
}

// ---- Nigerian bank payouts (Paystack) ----

let paystackStatusCache = null;   // { tailor:{currency, bank}, seller:{currency, bank} }
let paystackBanks = null;         // [{ name, code }]

// Resolves true when this business is paid through Paystack (and the card was drawn)
function paystackPayoutStatus(role) {
  if (typeof Cloud.paystackStatus !== "function") return Promise.resolve(false);
  return Cloud.paystackStatus()
    .then(data => {
      paystackStatusCache = data || {};
      const s = paystackStatusCache[role];
      if (!s || paymentProviderFor(s.currency) !== "paystack") return false;
      paintPaystackCard(role);
      return true;
    })
    .catch(() => false);   // paystack-payments.sql not run yet: use Stripe
}

function paintPaystackCard(role, editing) {
  const card = document.getElementById("payout-card");
  if (!card) return;
  const s = (paystackStatusCache && paystackStatusCache[role]) || {};
  const sales = role === "seller" ? "fabric sales" : "orders";
  const bank = s.bank;
  const top = `<h2>Payments & payouts</h2>
    <p>Add the Nigerian bank account NebedaHub pays you into for your ${sales}. Customers in Nigeria and abroad pay by card through Paystack; you receive naira.</p>
    <p class="hint">NebedaHub keeps <b>10%</b>. You receive <b>70% ${role === "seller" ? "when you send the fabric" : "when the customer pays"}</b>, and the final <b>30% ${role === "seller" ? "when the tailor approves the fabric" : "when the customer confirms the outfit"}</b>${role === "seller" ? "" : " — or automatically 7 days after delivery if the customer doesn't respond"}.</p>`;
  if (bank && !editing) {
    card.innerHTML = top + `<div id="payout-status" class="payout-status" data-role="${role}">
        <span class="paid">● Payouts connected.</span> ${escapeHtml(bank.bank_name)} ••••${escapeHtml(bank.last4)} — ${escapeHtml(bank.account_name)}</div>
      <div class="form-actions"><button type="button" class="ghost small" onclick="paintPaystackCard('${role}', true)">Change bank account</button></div>
      <p class="hint">🔒 Payments and transfers are handled by Paystack.${realPaymentsOn() ? "" : " Customer payments aren't switched on yet; this only prepares your payouts."}</p>`;
    if (!payoutsSettledThisVisit && typeof Cloud.settlePayouts === "function") {
      payoutsSettledThisVisit = true;
      Cloud.settlePayouts({ scope: "mine" });
    }
    return;
  }
  card.innerHTML = top + `<div id="payout-status" class="payout-status" data-role="${role}">${bank ? "Enter your new bank account." : `<span class="owed">● Not set up yet.</span> Add your bank account to be paid.`}</div>
    <form class="form-grid" onsubmit="return savePaystackBank(event, '${role}')">
      <label>Bank<select name="bank" id="ps-bank" required><option value="">Loading banks…</option></select></label>
      <label>Account number (NUBAN)<input name="account" id="ps-account" inputmode="numeric" maxlength="10" pattern="\\d{10}" required placeholder="10 digits" oninput="paystackAccountChanged()"></label>
      <div class="hint" id="ps-name"></div>
      <div class="form-error" id="ps-error"></div>
      <div class="form-actions">
        <button type="button" class="ghost" id="ps-check" onclick="checkPaystackAccount()">Check account</button>
        <button type="submit" class="gold" id="ps-save" disabled>Save this account</button>
        ${bank ? `<button type="button" class="ghost small" onclick="paintPaystackCard('${role}')">Cancel</button>` : ""}
      </div>
    </form>
    <p class="hint">We check the account with Paystack and show you the account holder's name before saving. NebedaHub keeps only the last 4 digits.</p>`;
  loadPaystackBanks();
}

function loadPaystackBanks() {
  const fill = () => {
    const sel = document.getElementById("ps-bank");
    if (!sel) return;
    sel.innerHTML = `<option value="">Choose your bank</option>` +
      paystackBanks.map(b => `<option value="${escapeHtml(b.code)}">${escapeHtml(b.name)}</option>`).join("");
    sel.onchange = paystackAccountChanged;
  };
  if (paystackBanks) { fill(); return; }
  Cloud.paystackBank("banks")
    .then(data => { paystackBanks = (data && data.banks) || []; fill(); })
    .catch(err => {
      const e = document.getElementById("ps-error");
      if (e) e.textContent = err.message || "Couldn't load the list of banks.";
    });
}

// Any change means the account must be checked again before saving
function paystackAccountChanged() {
  const save = document.getElementById("ps-save");
  const name = document.getElementById("ps-name");
  if (save) save.disabled = true;
  if (name) name.textContent = "";
}

function checkPaystackAccount() {
  const bank = (document.getElementById("ps-bank") || {}).value || "";
  const account = ((document.getElementById("ps-account") || {}).value || "").replace(/\D/g, "");
  const err = document.getElementById("ps-error");
  const name = document.getElementById("ps-name");
  const btn = document.getElementById("ps-check");
  if (err) err.textContent = "";
  if (!bank) { if (err) err.textContent = "Choose your bank."; return; }
  if (account.length !== 10) { if (err) err.textContent = "A Nigerian account number has 10 digits."; return; }
  if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
  Cloud.paystackBank("resolve", { bank_code: bank, account_number: account })
    .then(data => {
      if (name) name.innerHTML = `Account name: <b>${escapeHtml(data.account_name || "")}</b>. Is this you or your business?`;
      const save = document.getElementById("ps-save");
      if (save) save.disabled = false;
    })
    .catch(e => { if (err) err.textContent = e.message || "We couldn't check that account."; })
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = "Check account"; } });
}

function savePaystackBank(event, role) {
  event.preventDefault();
  const bank = (document.getElementById("ps-bank") || {}).value || "";
  const account = ((document.getElementById("ps-account") || {}).value || "").replace(/\D/g, "");
  const err = document.getElementById("ps-error");
  const save = document.getElementById("ps-save");
  if (save) { save.disabled = true; save.textContent = "Saving…"; }
  Cloud.paystackBank("save", { role, bank_code: bank, account_number: account })
    .then(() => {
      payoutsSettledThisVisit = false;     // send anything that was waiting for a bank
      return paystackPayoutStatus(role);
    })
    .then(() => toast("Bank account saved. NebedaHub will pay you here."))
    .catch(e => {
      if (err) err.textContent = e.message || "Couldn't save the bank account.";
      if (save) { save.disabled = false; save.textContent = "Save this account"; }
    });
  return false;
}
