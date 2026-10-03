// ============================================================
// stripe-connect-onboard — Stage 1 of payments.
//
// Creates (or reuses) a Stripe Connect Express account for the signed-in
// tailor (designers) or fabric seller (suppliers), and returns a Stripe
// onboarding link. Talks to Stripe over plain fetch (no Stripe SDK), which
// the Supabase edge runtime fully supports.
//
// Needs STRIPE_SECRET_KEY set in Supabase (SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically).
//
// NOTE: Stripe Connect only supports connected accounts in certain
// countries. The UK is fully supported. Nigeria/Ghana are NOT yet, and will
// need a different provider (Paystack/Flutterwave) — separate work.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RAW_STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

// Secrets are sometimes pasted from a password manager or rich-text source with
// a trailing newline or smart quote. Header values must be ASCII ByteStrings.
// Normalise only accidental surrounding/whitespace characters, then validate
// the Stripe key shape before it is ever placed in an Authorization header.
function stripeSecretKey(): string {
  return RAW_STRIPE_SECRET_KEY
    .trim()
    .replace(/[“”‘’"'\s]/g, "")
    .replace(/[^\x21-\x7E]/g, "");
}

const STRIPE_SECRET_KEY = stripeSecretKey();
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

// Stripe wants form-encoded bodies with bracketed nested keys.
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

async function stripe(path: string, method: string, params?: Record<string, unknown>) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? encodeForm(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: { message?: string } })?.error?.message || `Stripe error ${res.status}`);
  return data as Record<string, unknown>;
}

function isoCountry(code: string | null): string {
  return code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : "GB";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!STRIPE_SECRET_KEY) {
      return json({ error: "Payouts aren't configured yet. (STRIPE_SECRET_KEY is not set in Supabase.)" }, 400);
    }
    if (!/^sk_(test|live)_/.test(STRIPE_SECRET_KEY)) {
      return json({ error: "The Stripe secret key saved in Supabase is not valid. Please replace STRIPE_SECRET_KEY with the Stripe secret key only." }, 400);
    }

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Please sign in and try again." }, 401);
    const user = userData.user;

    const { role } = await req.json().catch(() => ({ role: "" }));
    const table = role === "seller" ? "suppliers" : role === "tailor" ? "designers" : null;
    if (!table) return json({ error: "Unknown account type." }, 400);
    const nameCol = table === "suppliers" ? "name" : "business_name";

    const { data: biz, error: bizErr } = await admin
      .from(table)
      .select(`id, ${nameCol}, country_code, stripe_account_id`)
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (bizErr) return json({ error: bizErr.message }, 400);
    if (!biz) {
      return json({ error: role === "seller"
        ? "We couldn't find a fabric shop on your account."
        : "We couldn't find a tailor business on your account." }, 404);
    }

    const row = biz as Record<string, unknown>;
    let accountId = row.stripe_account_id as string | null;
    if (!accountId) {
      const account = await stripe("/accounts", "POST", {
        type: "express",
        email: user.email ?? undefined,
        country: isoCountry(row.country_code as string | null),
        business_type: "individual",
        capabilities: { transfers: { requested: true } },
        business_profile: { name: row[nameCol] ?? undefined },
        metadata: { nebedahub_role: role, business_id: row.id, owner_user_id: user.id },
      });
      accountId = account.id as string;
      const { error: upErr } = await admin.from(table).update({ stripe_account_id: accountId }).eq("id", row.id);
      if (upErr) return json({ error: upErr.message }, 400);
    }

    const origin = req.headers.get("origin") ?? "https://nebedahub.com";
    const back = role === "seller" ? `${origin}/sellers/#/profile` : `${origin}/business/#/profile`;
    const link = await stripe("/account_links", "POST", {
      account: accountId,
      refresh_url: back,
      return_url: back,
      type: "account_onboarding",
    });

    return json({ url: link.url });
  } catch (e) {
    return json({ error: (e as Error).message ?? "Something went wrong setting up payouts." }, 400);
  }
});
