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

// Payments are intentionally disabled until NebedaHub finishes its payment-provider setup.
const ONLINE_PAYMENTS_ENABLED = false;

// Payout onboarding (Stage 1): lets tailors and fabric sellers connect their
// bank through Stripe. Turn on ONLY after the Stripe Edge Functions are
// deployed and STRIPE_SECRET_KEY is set in Supabase (see supabase/STRIPE-SETUP.md).
// This is separate from ONLINE_PAYMENTS_ENABLED and moves no real money on its own.
const PAYOUTS_ONBOARDING_ENABLED = false;

// Safe transaction simulation. No real money moves while this is true.
const TRANSACTION_TEST_MODE = true;

// Protected transaction rules used by transaction test mode.
const NEBEDAHUB_COMMISSION_RATE = 0.10;
const PAYOUT_INITIAL_RATE = 0.70;
const PAYOUT_HELD_RATE = 0.30;
