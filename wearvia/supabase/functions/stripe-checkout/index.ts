// ============================================================
// stripe-checkout — Stage 2 of payments: the customer pays in full.
//
// The signed-in customer asks to pay one of their accepted orders. The amount
// and currency come from the DATABASE (never from the browser), and the
// function returns a Stripe Checkout link. Card details go straight to Stripe.
//
// The payment is only recorded when Stripe tells the stripe-webhook function
// it succeeded — returning from Checkout is not proof of payment.
//
// Needs STRIPE_SECRET_KEY set in Supabase. Self-contained (no shared imports)
// so it can be pasted into the Supabase dashboard.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Currencies Checkout is open for. Payouts go out of NebedaHub's UK Stripe
// balance, so start with pounds only. Add more once tested.
const CHECKOUT_CURRENCIES = ["GBP"];

const STRIPE_SECRET_KEY = (Deno.env.get("STRIPE_SECRET_KEY") ?? "")
  .trim().replace(/[“”‘’"'\s]/g, "").replace(/[^\x21-\x7E]/g, "");
const STRIPE_API = "https://api.stripe.com/v1";

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

// Stripe wants form-encoded bodies with bracketed nested keys (arrays as [0], [1]…).
function encodeForm(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") parts.push(encodeForm(item as Record<string, unknown>, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      parts.push(encodeForm(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

async function stripe(path: string, params: Record<string, unknown>) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = (data as { error?: { message?: string } })?.error?.message || `Stripe error ${res.status}`;
    throw new Error(/Invalid API Key/i.test(raw)
      ? "The Stripe secret key saved in Supabase is invalid. Replace STRIPE_SECRET_KEY."
      : raw);
  }
  return data as Record<string, unknown>;
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
    if (!/^sk_(test|live)_/.test(STRIPE_SECRET_KEY)) {
      return json({ error: "Payments aren't configured yet (STRIPE_SECRET_KEY is missing or invalid in Supabase)." }, 400);
    }

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Please sign in and try again." }, 401);
    const user = userData.user;

    const { order_id } = await req.json().catch(() => ({ order_id: "" }));
    if (!order_id || !/^[0-9a-f-]{36}$/i.test(String(order_id))) return json({ error: "Order not found." }, 400);

    // The database checks it's this customer's accepted, unpaid order, and gives the amount
    const { data: info, error: infoErr } = await admin.rpc("wv_stripe_checkout_order", { p_order_id: order_id, p_user: user.id });
    if (infoErr) return json({ error: infoErr.message }, 400);
    const order = info as { error?: string; order_id: string; order_number: string; outfit?: string; amount: number; currency: string };
    if (order.error) return json({ error: order.error }, 400);
    if (!CHECKOUT_CURRENCIES.includes(order.currency)) {
      return json({ error: `Card payment in ${order.currency} isn't open yet. NebedaHub will let you know when it is.` }, 400);
    }
    const minor = Math.round(Number(order.amount) * 100);
    if (!(minor >= 30)) return json({ error: "This order total is too small to pay by card." }, 400);

    const origin = safeOrigin(req.headers.get("origin"));
    const ref = encodeURIComponent(order.order_number);
    const session = await stripe("/checkout/sessions", {
      mode: "payment",
      customer_email: user.email ?? undefined,
      client_reference_id: order.order_id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: minor,
          product_data: {
            name: `NebedaHub order ${order.order_number}`,
            description: order.outfit ? `${order.outfit} — paid in full, protected by NebedaHub` : "Paid in full, protected by NebedaHub",
          },
        },
      }],
      payment_intent_data: {
        transfer_group: `order_${order.order_id}`,
        description: `NebedaHub order ${order.order_number}`,
        metadata: { order_id: order.order_id, order_number: order.order_number },
      },
      metadata: { order_id: order.order_id, order_number: order.order_number },
      success_url: `${origin}/?checkout=success#/tracking/${ref}`,
      cancel_url: `${origin}/?checkout=cancelled#/pay/${ref}`,
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: (e as Error).message ?? "Couldn't start the payment." }, 400);
  }
});
