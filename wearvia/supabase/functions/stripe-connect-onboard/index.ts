// ============================================================
// stripe-connect-onboard — Stage 1 of payments.
//
// Creates (or reuses) a Stripe Connect Express account for the signed-in
// tailor (designers) or fabric seller (suppliers), and returns a Stripe
// onboarding link where they enter their bank details. NebedaHub never sees
// those details — they go straight to Stripe.
//
// Needs one secret set in Supabase: STRIPE_SECRET_KEY
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//
// NOTE: Stripe Connect only supports connected accounts in certain
// countries. The UK is fully supported. Nigeria and Ghana are NOT currently
// supported by Stripe for payouts — tailors/sellers there will need a
// different payout provider (e.g. Paystack/Flutterwave), which is a separate
// piece of work. See supabase/STRIPE-SETUP.md.
// ============================================================

import Stripe from "https://esm.sh/stripe@17.3.1?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: "2024-06-20",
});

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

// designers/suppliers store a 2-letter country code; Stripe needs ISO-3166.
function isoCountry(code: string | null): string {
  return code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : "GB";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!STRIPE_SECRET_KEY) {
      return json({ error: "Payouts aren't configured yet. (STRIPE_SECRET_KEY is not set in Supabase.)" }, 400);
    }

    // Who is calling?
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Please sign in and try again." }, 401);
    const user = userData.user;

    const { role } = await req.json().catch(() => ({ role: "" }));
    const table = role === "seller" ? "suppliers" : role === "tailor" ? "designers" : null;
    if (!table) return json({ error: "Unknown account type." }, 400);
    const nameCol = table === "suppliers" ? "name" : "business_name";

    // The business this user owns
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

    // Create the connected account the first time
    let accountId = biz.stripe_account_id as string | null;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email ?? undefined,
        country: isoCountry(biz.country_code as string | null),
        business_type: "individual",
        capabilities: { transfers: { requested: true } },
        business_profile: { name: (biz as Record<string, string>)[nameCol] ?? undefined },
        metadata: { nebedahub_role: role, business_id: biz.id, owner_user_id: user.id },
      });
      accountId = account.id;
      const { error: upErr } = await admin.from(table).update({ stripe_account_id: accountId }).eq("id", biz.id);
      if (upErr) return json({ error: upErr.message }, 400);
    }

    // Where Stripe sends them back to afterwards
    const origin = req.headers.get("origin") ?? "https://nebedahub.com";
    const back = role === "seller" ? `${origin}/sellers/#/profile` : `${origin}/business/#/profile`;
    const link = await stripe.accountLinks.create({
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
