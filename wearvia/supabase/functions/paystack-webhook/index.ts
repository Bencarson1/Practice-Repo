// ============================================================
// paystack-webhook — Paystack tells NebedaHub that money moved.
//
// Every request is checked: Paystack signs the body with NebedaHub's secret
// key (x-paystack-signature = HMAC-SHA512), so nobody else can fake a payment.
//   charge.success      → re-checked with Paystack, recorded and split
//                         (10% NebedaHub, 70% now / 30% held), then the 70% is sent
//   transfer.success    → the tailor's / seller's bank transfer arrived
//   transfer.failed /
//   transfer.reversed   → it didn't: the money goes back to "due" and is retried
//
// Deploy WITHOUT JWT verification (Paystack has no Supabase login):
//   supabase functions deploy paystack-webhook --no-verify-jwt
// Needs PAYSTACK_SECRET_KEY in Supabase.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "")
  .trim().replace(/[“”‘’"'\s]/g, "").replace(/[^\x21-\x7E]/g, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

async function verifySignature(payload: string, header: string): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return sameHex(header.trim().toLowerCase(), mac);
}

async function paystackGet(path: string) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    headers: { "Authorization": `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => ({})) as { status?: boolean; message?: string; data?: Record<string, unknown> };
  if (!res.ok || !data.status) throw new Error(data.message || `Paystack error ${res.status}`);
  return data.data ?? {};
}

async function settleOrder(orderId: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/paystack-settle`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId }),
    });
  } catch (_e) { /* retried on the next settle */ }
}

async function recordCharge(event: Record<string, unknown>) {
  const reference = String(event.reference ?? "");
  if (!reference) return { skipped: "no reference" };

  // Never trust the event alone: ask Paystack for the transaction itself
  const tx = await paystackGet(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (tx.status !== "success") return { skipped: `transaction is ${tx.status}` };
  const meta = (tx.metadata ?? {}) as Record<string, unknown>;
  const orderId = String(meta.order_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return { skipped: "not a NebedaHub order" };

  const { data, error } = await admin.rpc("wv_paystack_record_payment", {
    p_order_id: orderId,
    p_amount: Number(tx.amount) / 100,
    p_currency: String(tx.currency ?? "NGN").toUpperCase(),
    p_reference: reference,
    p_transaction_id: tx.id != null ? String(tx.id) : null,
  });
  if (error) throw new Error(error.message);

  await settleOrder(orderId);          // send the 70% now
  return data;
}

async function transferResult(type: string, event: Record<string, unknown>) {
  const reference = String(event.reference ?? "");
  if (!reference) return { skipped: "no reference" };
  const reason = String(event.reason ?? event.gateway_response ?? event.message ?? "");
  const { data, error } = await admin.rpc("wv_paystack_transfer_result", {
    p_reference: reference, p_event: type, p_reason: type === "transfer.success" ? "" : reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!/^sk_(test|live)_/.test(PAYSTACK_SECRET_KEY)) return reply({ error: "PAYSTACK_SECRET_KEY is not set in Supabase." }, 500);

  const payload = await req.text();
  const ok = await verifySignature(payload, req.headers.get("x-paystack-signature") ?? "");
  if (!ok) return reply({ error: "Bad signature" }, 401);

  let event: { event?: string; data?: Record<string, unknown> };
  try { event = JSON.parse(payload); } catch (_e) { return reply({ error: "Bad JSON" }, 400); }

  try {
    const type = event.event ?? "";
    if (type === "charge.success") {
      return reply({ received: true, result: await recordCharge(event.data ?? {}) });
    }
    if (type === "transfer.success" || type === "transfer.failed" || type === "transfer.reversed") {
      return reply({ received: true, result: await transferResult(type, event.data ?? {}) });
    }
    return reply({ received: true, ignored: type });
  } catch (e) {
    // A 500 makes Paystack retry, which is safe: recording is idempotent
    console.error("paystack-webhook:", (e as Error).message);
    return reply({ error: (e as Error).message }, 500);
  }
});
