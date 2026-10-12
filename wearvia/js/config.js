// ============================================================
// config.js — which Supabase project the app talks to
//
// The publishable key is meant to be public: it only lets the app ask
// for data, and the database's security rules (supabase/setup.sql)
// decide what each signed-in person may see and change.
// NEVER put the secret key (sb_secret_…) in this file or anywhere in the app.
// ============================================================

const SUPABASE_URL = "https://ylngxdwywqteanpelsqb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_79DT7izyjA7R_VsIPlfkTQ_z14fm6Kr";

// Real customer payments through Stripe and, for naira orders, Paystack
// (see supabase/STRIPE-SETUP.md and supabase/PAYSTACK-SETUP.md).
// To switch them on: set ONLINE_PAYMENTS_ENABLED = true AND TRANSACTION_TEST_MODE = false
// below — only after stripe-payments.sql is run and the Stripe functions + webhook
// are set up (and paystack-payments.sql + the Paystack functions for naira orders).
// With sk_test_ keys in Supabase, only test cards work.
const ONLINE_PAYMENTS_ENABLED = false;

// Which payment company handles an order, by the order's currency (the tailor's).
// Naira orders (Nigerian tailors) go through Paystack: it takes international
// cards and pays tailors and sellers into Nigerian banks. Everything else goes
// through Stripe. See supabase/PAYSTACK-SETUP.md.
const PAYSTACK_CURRENCIES = ["NGN"];

// Payout onboarding (Stage 1): lets tailors and fabric sellers connect their
// bank through Stripe. Turn on ONLY after the Stripe Edge Functions are
// deployed and STRIPE_SECRET_KEY is set in Supabase (see supabase/STRIPE-SETUP.md).
// This is separate from ONLINE_PAYMENTS_ENABLED and moves no real money on its own.
const PAYOUTS_ONBOARDING_ENABLED = true;

// Safe transaction simulation. No real money moves while this is true.
const TRANSACTION_TEST_MODE = true;

// Protected transaction rules used by transaction test mode.
const NEBEDAHUB_COMMISSION_RATE = 0.10;
const PAYOUT_INITIAL_RATE = 0.70;
const PAYOUT_HELD_RATE = 0.30;

// Which payment mode the app is in (used by the customer, tailor and seller screens):
//   test mode  → the safe simulation, no money moves
//   real mode  → Stripe Checkout, transfers and refunds
// Both take the full amount upfront and protect the final 30%.
function paymentsTestMode() { return typeof TRANSACTION_TEST_MODE !== "undefined" && TRANSACTION_TEST_MODE; }
function realPaymentsOn() { return typeof ONLINE_PAYMENTS_ENABLED !== "undefined" && ONLINE_PAYMENTS_ENABLED && !paymentsTestMode(); }
function payInFullMode() { return paymentsTestMode() || realPaymentsOn(); }
function paymentProviderFor(currency) {
  return PAYSTACK_CURRENCIES.includes(String(currency || "").toUpperCase()) ? "paystack" : "stripe";
}
function paymentProviderName(currency) { return paymentProviderFor(currency) === "paystack" ? "Paystack" : "Stripe"; }
