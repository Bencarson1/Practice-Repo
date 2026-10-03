// ============================================================
// stripe-connect-status — Stage 1 of payments.
//
// For the signed-in tailor and/or fabric seller, re-checks their Stripe
// account, updates the stored booleans, and returns payout status for both.
// Talks to Stripe over plain fetch (no Stripe SDK).
//
// Needs STRIPE_SECRET_KEY set in Supabase (SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RAW_STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

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

async function stripeGet(path: string) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = (data as { error?: { message?: string } })?.error?.message || `Stripe error ${res.status}`;
    const safe = /Invalid API Key provided/i.test(raw)
      ? "The Stripe secret key saved in Supabase is invalid or no longer active. Replace STRIPE_SECRET_KEY with a current Stripe test secret key."
      : raw;
    throw new Error(safe);
  }
  return data as Record<string, unknown>;
}

async function refreshOne(table: "designers" | "suppliers", userId: string) {
  const nameCol = table === "suppliers" ? "name" : "business_name";
  const { data: biz } = await admin
    .from(table)
    .select(`id, ${nameCol}, stripe_account_id, stripe_payouts_enabled, stripe_charges_enabled, stripe_details_submitted`)
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!biz) return null;

  const row = biz as Record<string, unknown>;
  const accountId = row.stripe_account_id as string | null;
  let charges = !!row.stripe_charges_enabled;
  let payouts = !!row.stripe_payouts_enabled;
  let details = !!row.stripe_details_submitted;

  if (accountId) {
    try {
      const acct = await stripeGet(`/accounts/${accountId}`);
      charges = !!acct.charges_enabled;
      payouts = !!acct.payouts_enabled;
      details = !!acct.details_submitted;
      await admin.from(table).update({
        stripe_charges_enabled: charges,
        stripe_payouts_enabled: payouts,
        stripe_details_submitted: details,
      }).eq("id", row.id);
    } catch (_e) {
      // Keep stored values if Stripe can't be reached this moment.
    }
  }

  return {
    has_account: !!accountId,
    charges_enabled: charges,
    payouts_enabled: payouts,
    details_submitted: details,
    business_name: row[nameCol] ?? null,
  };
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

    const [tailor, seller] = await Promise.all([
      refreshOne("designers", userData.user.id),
      refreshOne("suppliers", userData.user.id),
    ]);
    return json({ tailor, seller });
  } catch (e) {
    return json({ error: (e as Error).message ?? "Couldn't check payout status." }, 400);
  }
});
