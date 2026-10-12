// ============================================================
// paystack-bank — a Nigerian tailor or fabric seller adds the bank account
// NebedaHub pays them into (the Paystack rail).
//
// Actions (all need a signed-in user):
//   { action: "banks" }                                   → list of Nigerian banks
//   { action: "resolve", bank_code, account_number }      → the account holder's name
//   { action: "save", role, bank_code, account_number }   → checks the account
//       again with Paystack, creates a Paystack transfer recipient, and saves it
//       for the business this user OWNS (role "tailor" or "seller").
//
// Only the last 4 digits and the account name are kept by NebedaHub; the full
// account number lives with Paystack.
//
// Needs PAYSTACK_SECRET_KEY in Supabase.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

async function paystack(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { "Authorization": `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({})) as { status?: boolean; message?: string; data?: unknown };
  if (!res.ok || !data.status) throw new Error(data.message || `Paystack error ${res.status}`);
  return data.data;
}

const cleanDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

async function resolveAccount(bankCode: string, accountNumber: string) {
  if (!/^\d{3,9}$/.test(bankCode)) throw new Error("Choose your bank.");
  if (!/^\d{10}$/.test(accountNumber)) throw new Error("A Nigerian account number has 10 digits.");
  try {
    const r = await paystack("GET", `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`) as Record<string, unknown>;
    const name = String(r.account_name ?? "").trim();
    if (!name) throw new Error("no name");
    return name;
  } catch (_e) {
    throw new Error("We couldn't find that account. Check the bank and the 10-digit account number.");
  }
}

let bankCache: { at: number; list: Array<{ name: string; code: string }> } | null = null;

async function getBanks() {
  if (!bankCache || Date.now() - bankCache.at > 6 * 3600 * 1000) {
    const list = await paystack("GET", "/bank?country=nigeria&currency=NGN&perPage=200") as Array<Record<string, unknown>>;
    bankCache = {
      at: Date.now(),
      list: (list ?? []).filter(b => b.active !== false && !b.is_deleted)
        .map(b => ({ name: String(b.name), code: String(b.code) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  return bankCache.list;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!/^sk_(test|live)_/.test(PAYSTACK_SECRET_KEY)) {
      return json({ error: "Nigerian bank payouts aren't configured yet (PAYSTACK_SECRET_KEY is missing in Supabase)." }, 400);
    }
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Please sign in and try again." }, 401);
    const user = userData.user;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "banks") return json({ banks: await getBanks() });

    const bankCode = cleanDigits(body.bank_code);
    const accountNumber = cleanDigits(body.account_number);

    if (action === "resolve") {
      return json({ account_name: await resolveAccount(bankCode, accountNumber) });
    }

    if (action === "save") {
      const role = String(body.role ?? "");
      if (role !== "tailor" && role !== "seller") return json({ error: "Unknown business type." }, 400);
      const accountName = await resolveAccount(bankCode, accountNumber);
      const bankName = (await getBanks()).find(b => b.code === bankCode)?.name ?? bankCode;

      const recipient = await paystack("POST", "/transferrecipient", {
        type: "nuban",
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "NGN",
        description: `NebedaHub ${role} payouts`,
        metadata: { user_id: user.id, role },
      }) as Record<string, unknown>;

      const { data, error } = await admin.rpc("wv_paystack_save_bank", {
        p_user: user.id, p_role: role, p_bank_code: bankCode, p_bank_name: bankName,
        p_last4: accountNumber.slice(-4), p_account_name: accountName,
        p_recipient_code: String(recipient.recipient_code ?? ""),
      });
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "Something went wrong." }, 400);
  }
});
