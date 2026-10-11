// ============================================================
// stripe-webhook — Stage 2 of payments: Stripe tells NebedaHub a customer paid.
//
// Stripe calls this URL (no user sign-in). Every request is checked against
// STRIPE_WEBHOOK_SECRET, so nobody else can fake a payment. On a paid
// Checkout it records the payment in the database, which marks the order paid
// and splits the money (10% NebedaHub, 70% now / 30% held). Then it asks
// stripe-settle to send whatever is due straight away.
//
// Deploy WITHOUT JWT verification (Stripe has no Supabase login):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Supabase.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const clean = (v: string) => v.trim().replace(/[“”‘’"'\s]/g, "").replace(/[^\x21-\x7E]/g, "");
const STRIPE_SECRET_KEY = clean(Deno.env.get("STRIPE_SECRET_KEY") ?? "");
const WEBHOOK_SECRET = clean(Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TOLERANCE_SECONDS = 300;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare of two hex strings
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stripe-Signature: t=timestamp,v1=hex(HMAC_SHA256(secret, `${t}.${body}`))
async function verifySignature(payload: string, header: string): Promise<boolean> {
  const parts = header.split(",").map(p => p.trim().split("="));
  const t = parts.find(p => p[0] === "t")?.[1];
  const sigs = parts.filter(p => p[0] === "v1").map(p => p[1]);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return sigs.some(s => sameHex(s, mac));
}

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: { message?: string } })?.error?.message || `Stripe error ${res.status}`);
  return data as Record<string, unknown>;
}

async function recordPaidSession(session: Record<string, unknown>) {
  if (session.payment_status !== "paid") return { skipped: "not paid yet" };
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const orderId = meta.order_id || (session.client_reference_id as string);
  const piId = session.payment_intent as string;
  if (!orderId || !piId) return { skipped: "not a NebedaHub order" };

  const pi = await stripeGet(`/payment_intents/${piId}`);
  const chargeId = (pi.latest_charge as string) ?? null;
  const amount = Number(session.amount_total) / 100;
  const currency = String(session.currency ?? "gbp").toUpperCase();

  const { data, error } = await admin.rpc("wv_stripe_record_payment", {
    p_order_id: orderId, p_amount: amount, p_currency: currency,
    p_payment_intent: piId, p_charge: chargeId, p_session: session.id as string,
  });
  if (error) throw new Error(error.message);

  // Send the 70% now. If this fails the money stays due and is retried later.
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/stripe-settle`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId }),
    });
  } catch (_e) { /* retried on the next settle */ }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!WEBHOOK_SECRET.startsWith("whsec_")) return reply({ error: "STRIPE_WEBHOOK_SECRET is not set in Supabase." }, 500);

  const payload = await req.text();
  const ok = await verifySignature(payload, req.headers.get("Stripe-Signature") ?? "");
  if (!ok) return reply({ error: "Bad signature" }, 400);

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try { event = JSON.parse(payload); } catch (_e) { return reply({ error: "Bad JSON" }, 400); }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const result = await recordPaidSession(event.data?.object ?? {});
      return reply({ received: true, result });
    }
    return reply({ received: true, ignored: event.type });
  } catch (e) {
    // A 500 makes Stripe retry, which is safe: recording is idempotent
    console.error("stripe-webhook:", (e as Error).message);
    return reply({ error: (e as Error).message }, 500);
  }
});
