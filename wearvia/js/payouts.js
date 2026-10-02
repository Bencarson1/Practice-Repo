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
// when the customer pays and the final 30% once the order passes quality
// control. That split is enforced on the server (Stage 2/3), never here.
// Bank details go straight to Stripe — NebedaHub never sees or stores them.
// ============================================================

let payoutStatusCache = null;      // last { tailor:{...}, seller:{...} } from the server
let payoutStatusLoading = false;

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
    <p class="hint">🔒 Your bank details go straight to Stripe — NebedaHub never sees or stores them. Customer payments aren't switched on yet; this only prepares your payouts.</p>
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
