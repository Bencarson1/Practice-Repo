// ============================================================
// stripe-settle — Stages 2 and 3 of payments: send the money that is due.
//
// The database decides who is owed what (supabase/stripe-payments.sql) and
// marks those rows 'released'. This function only ever sends released rows:
//   • tailor / fabric seller → a Stripe transfer to their connected account,
//     linked to the customer's charge (source_transaction), so it can't
//     run before the customer's money is in NebedaHub's Stripe balance
//   • customer → a Stripe refund (when a problem was reported)
// Every attempt uses an idempotency key, so a retry can never pay twice.
// If a tailor/seller hasn't finished payout setup, the row simply stays due
// and is sent the next time this runs (e.g. when they press Refresh status).
//
// Who can run it:
//   • stripe-webhook (with the service key), for any order
//   • any signed-in user, for one order ({ order_id }) or for their own
//     businesses ({ scope: "mine" }). That's safe: it can only send money the
//     database has already released, to the people it belongs to.
//
// Deploy: supabase functions deploy stripe-settle --no-verify-jwt
// (it checks the sign-in itself). Needs STRIPE_SECRET_KEY.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET_KEY = (Deno.env.get("STRIPE_SECRET_KEY") ?? "")
  .trim().replace(/[“”‘’"'\s]/g, "").replace(/[^\x21-\x7E]/g, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function encodeForm(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) parts.push(encodeForm(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join("&");
}

async function stripePost(path: string, params: Record<string, unknown>, idempotencyKey: string) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: encodeForm(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: { message?: string } })?.error?.message || `Stripe error ${res.status}`);
  return data as Record<string, unknown>;
}

type Due = {
  payout_id: string; order_id: string; order_number: string; recipient_type: string; amount: number;
  currency_code: string; destination: string | null; charge_id: string | null; payment_intent_id: string | null; attempts: number;
};

async function mark(id: string, transfer: string | null, refund: string | null, error: string | null) {
  await admin.rpc("wv_stripe_mark_payout", { p_payout_id: id, p_transfer: transfer, p_refund: refund, p_error: error });
}

async function settle(orderId: string | null, owner: string | null) {
  const { data, error } = await admin.rpc("wv_stripe_due_payouts", { p_order_id: orderId, p_owner: owner });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Due[];
  const out = { sent: 0, refunded: 0, waiting: 0, messages: [] as string[] };

  for (const r of rows) {
    const minor = Math.round(Number(r.amount) * 100);
    // A failed attempt is stored by Stripe under its key, so each retry needs a new one
    const attempt = `${r.payout_id}_${r.attempts ?? 0}`;
    try {
      if (r.recipient_type === "customer") {
        if (!r.payment_intent_id) throw new Error("No Stripe payment to refund.");
        const refund = await stripePost("/refunds", {
          payment_intent: r.payment_intent_id,
          amount: minor,
          metadata: { payout_id: r.payout_id, order_id: r.order_id, order_number: r.order_number },
        }, `refund_${attempt}`);
        await mark(r.payout_id, null, refund.id as string, null);
        out.refunded++;
      } else {
        if (!r.destination) throw new Error("Payouts aren't set up yet for this business.");
        const transfer = await stripePost("/transfers", {
          amount: minor,
          currency: r.currency_code.toLowerCase(),
          destination: r.destination,
          source_transaction: r.charge_id ?? undefined,
          transfer_group: `order_${r.order_id}`,
          description: `NebedaHub order ${r.order_number}`,
          metadata: { payout_id: r.payout_id, order_id: r.order_id, order_number: r.order_number, recipient: r.recipient_type },
        }, `transfer_${attempt}`);
        await mark(r.payout_id, transfer.id as string, null, null);
        out.sent++;
      }
    } catch (e) {
      const msg = (e as Error).message || "Stripe error";
      await mark(r.payout_id, null, null, msg);
      out.waiting++;
      out.messages.push(`${r.order_number} ${r.recipient_type}: ${msg}`);
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!/^sk_(test|live)_/.test(STRIPE_SECRET_KEY)) {
      return json({ error: "Payments aren't configured yet (STRIPE_SECRET_KEY is missing or invalid in Supabase)." }, 400);
    }
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const body = await req.json().catch(() => ({})) as { order_id?: string; scope?: string };
    const orderId = body.order_id && /^[0-9a-f-]{36}$/i.test(body.order_id) ? body.order_id : null;

    if (SERVICE_KEY && token === SERVICE_KEY) {
      return json(await settle(orderId, null));
    }

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Please sign in and try again." }, 401);
    if (orderId) return json(await settle(orderId, null));
    if (body.scope === "mine") return json(await settle(null, userData.user.id));
    return json({ error: "Say which order to settle." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "Couldn't send payouts." }, 400);
  }
});
