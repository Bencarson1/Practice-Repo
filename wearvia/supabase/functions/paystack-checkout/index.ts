// ============================================================
// paystack-checkout — the customer pays a naira (Nigerian tailor) order in full.
//
// Same job as stripe-checkout, through Paystack: the signed-in customer asks
// to pay one of their accepted orders, the amount and currency come from the
// DATABASE (never from the browser), and this returns a Paystack payment page.
// Paystack takes international cards too, so diaspora customers can pay.
//
// The payment is only recorded when Paystack tells paystack-webhook it
// succeeded — coming back from the payment page is not proof of payment.
//
// Needs PAYSTACK_SECRET_KEY in Supabase. Self-contained (no shared imports).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Currencies the Paystack (Nigeria) account takes. Add "USD" once Paystack has
// switched on dollar payments for the account.
const PAYSTACK_CURRENCIES = ["NGN"];

const PAYSTACK_SECRET_KEY = (Deno.env.get("PAYSTACK_SECRET_KEY") ?? "")
  .trim().replace(/[“”‘’"'\s]/g, "").replace(/[^\x21-\x7E]/g, "");

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function paystack(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { status?: boolean; message?: string; data?: Record<string, unknown> };
  if (!res.ok || !data.status) {
    const raw = data.message || `Paystack error ${res.status}`;
    throw new Error(/invalid key/i.test(raw) ? "The Paystack secret key saved in Supabase is invalid. Replace PAYSTACK_SECRET_KEY." : raw);
  }
  return data.data ?? {};
}

// Only send people back to NebedaHub itself (or a local test copy)
function safeOrigin(origin: string | null): string {
  if (origin && /^https:\/\/([a-z0-9-]+\.)*nebedahub\.com$/i.test(origin)) return origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  if (origin && /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin)) return origin;
  return "https://nebedahub.com";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!/^sk_(test|live)_/.test(PAYSTACK_SECRET_KEY)) {
      return json({ error: "Naira payments aren't configured yet (PAYSTACK_SECRET_KEY is missing or invalid in Supabase)." }, 400);
    }

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Please sign in and try again." }, 401);
    const user = userData.user;
    if (!user.email) return json({ error: "Your account needs an email address to pay by card." }, 400);

    const { order_id } = await req.json().catch(() => ({ order_id: "" }));
    if (!order_id || !/^[0-9a-f-]{36}$/i.test(String(order_id))) return json({ error: "Order not found." }, 400);

    // The database checks it's this customer's accepted, unpaid order, and gives the amount
    const { data: info, error: infoErr } = await admin.rpc("wv_stripe_checkout_order", { p_order_id: order_id, p_user: user.id });
    if (infoErr) return json({ error: infoErr.message }, 400);
    const order = info as { error?: string; order_id: string; order_number: string; outfit?: string; amount: number; currency: string };
    if (order.error) return json({ error: order.error }, 400);
    if (!PAYSTACK_CURRENCIES.includes(order.currency)) {
      return json({ error: `This order is in ${order.currency}, which is paid through Stripe, not Paystack.` }, 400);
    }
    const minor = Math.round(Number(order.amount) * 100);           // kobo
    if (!(minor >= 10000)) return json({ error: "This order total is too small to pay by card." }, 400);

    const origin = safeOrigin(req.headers.get("origin"));
    const ref = encodeURIComponent(order.order_number);
    // Unique per attempt; the webhook finds the order from the metadata
    const reference = `wv-${order.order_id.replace(/-/g, "").slice(0, 12)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    const tx = await paystack("/transaction/initialize", {
      email: user.email,
      amount: minor,
      currency: order.currency,
      reference,
      // Paystack adds ?trxref=…&reference=… to this, so no #/route here
      callback_url: `${origin}/?checkout=success&order=${ref}`,
      metadata: {
        order_id: order.order_id,
        order_number: order.order_number,
        cancel_action: `${origin}/?checkout=cancelled&order=${ref}`,
        custom_fields: [
          { display_name: "NebedaHub order", variable_name: "order_number", value: order.order_number },
        ],
      },
    });

    return json({ url: tx.authorization_url, reference });
  } catch (e) {
    return json({ error: (e as Error).message ?? "Couldn't start the payment." }, 400);
  }
});
