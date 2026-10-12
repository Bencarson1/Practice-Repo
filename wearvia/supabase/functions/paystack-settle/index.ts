// ============================================================
// paystack-settle — send the naira money that is due (Paystack rail).
//
// Same job as stripe-settle. The database decides who is owed what and marks
// those rows 'released'; this function only ever sends released rows that
// were paid through Paystack:
//   • tailor / fabric seller → a Paystack transfer to their Nigerian bank
//     (the bank they added under "Payments & payouts")
//   • customer → a Paystack refund (after an admin decided a problem report)
// A transfer is first 'sending'; paystack-webhook marks it paid, or puts it
// back to due if the bank rejected it. Each attempt has its own reference, and
// before a retry we ask Paystack whether the last one went through, so a
// tailor is never paid twice.
//
// Who can run it:
//   • paystack-webhook (with the service key), for any order
//   • any signed-in user, for one order ({ order_id }) or for their own
//     businesses ({ scope: "mine" }). It can only send money the database
//     has already released, to the people it belongs to.
//
// Deploy: supabase functions deploy paystack-settle --no-verify-jwt
// Needs PAYSTACK_SECRET_KEY. In Paystack, transfers must be enabled and the
// "confirm transfers with OTP" setting switched OFF (see PAYSTACK-SETUP.md).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "")
  .trim().replace(/[“”‘’"'\s]/g, "").replace(/[^\x21-\x7E]/g, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type PaystackReply = { status?: boolean; message?: string; data?: Record<string, unknown> };

async function paystack(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { "Authorization": `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({})) as PaystackReply;
  if (!res.ok || !data.status) throw new Error(data.message || `Paystack error ${res.status}`);
  return data.data ?? {};
}

type Due = {
  payout_id: string; order_id: string; order_number: string; recipient_type: string; amount: number;
  currency_code: string; recipient_code: string | null; payment_reference: string | null; attempts: number;
};

async function mark(id: string, status: string, transferCode: string | null, reference: string | null,
                    refund: string | null, error: string | null) {
  await admin.rpc("wv_paystack_mark_payout", {
    p_payout_id: id, p_status: status, p_transfer_code: transferCode,
    p_transfer_reference: reference, p_refund: refund, p_error: error,
  });
}

// Did a transfer with this reference already reach Paystack?
async function existingTransfer(reference: string) {
  try {
    const t = await paystack("GET", `/transfer/verify/${encodeURIComponent(reference)}`);
    return t && t.transfer_code ? t : null;
  } catch (_e) { return null; }
}

function transferState(status: unknown) {
  return status === "success" ? "paid" : "sending";
}

async function settle(orderId: string | null, owner: string | null) {
  const { data, error } = await admin.rpc("wv_paystack_due_payouts", { p_order_id: orderId, p_owner: owner });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Due[];
  const out = { sent: 0, refunded: 0, waiting: 0, messages: [] as string[] };

  for (const r of rows) {
    const minor = Math.round(Number(r.amount) * 100);       // kobo
    const reference = `wvp-${r.payout_id}-${r.attempts ?? 0}`; // a new one for each attempt
    try {
      if (r.recipient_type === "customer") {
        if (!r.payment_reference) throw new Error("No Paystack payment to refund.");
        const refund = await paystack("POST", "/refund", {
          transaction: r.payment_reference,
          amount: minor,
          merchant_note: `NebedaHub order ${r.order_number}: problem report decided by NebedaHub`,
          customer_note: `Refund for NebedaHub order ${r.order_number}`,
        });
        await mark(r.payout_id, "refunded", null, null, String(refund.id ?? "refund"), null);
        out.refunded++;
        continue;
      }

      if (!r.recipient_code) throw new Error("Payouts aren't set up yet: add a Nigerian bank account under Payments & payouts.");
      if (r.currency_code !== "NGN") throw new Error(`Paystack pays out in naira only (this is ${r.currency_code}).`);

      // A previous attempt may have reached Paystack even though we didn't hear back
      const earlier = await existingTransfer(reference);
      const t = earlier ?? await paystack("POST", "/transfer", {
        source: "balance",
        amount: minor,
        currency: "NGN",
        recipient: r.recipient_code,
        reference,
        reason: `NebedaHub order ${r.order_number}`,
      });
      await mark(r.payout_id, transferState(t.status), String(t.transfer_code ?? ""), reference, null, null);
      if (t.status === "otp") out.messages.push(`${r.order_number}: Paystack is waiting for an OTP. Switch off transfer OTP in Paystack settings.`);
      out.sent++;
    } catch (e) {
      const msg = (e as Error).message || "Paystack error";
      // Before giving up on this reference, make sure Paystack really didn't take it
      // (a timeout can hide a transfer that went through). Otherwise the next try
      // would use a new reference and could pay twice.
      if (r.recipient_type !== "customer") {
        const landed = await existingTransfer(reference);
        if (landed) {
          await mark(r.payout_id, transferState(landed.status), String(landed.transfer_code ?? ""), reference, null, null);
          out.sent++;
          continue;
        }
      }
      await mark(r.payout_id, "error", null, null, null, msg);
      out.waiting++;
      out.messages.push(`${r.order_number} ${r.recipient_type}: ${msg}`);
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!/^sk_(test|live)_/.test(PAYSTACK_SECRET_KEY)) {
      return json({ error: "Naira payouts aren't configured yet (PAYSTACK_SECRET_KEY is missing or invalid in Supabase)." }, 400);
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
