// ============================================================
// secure-sign-in — email + password sign-in with account lockout and
// per-IP rate limiting (rules in supabase/login-lockout.sql).
//
//   POST { email, password }
//   200  { access_token, refresh_token, expires_in, expires_at, token_type, user }
//   401  { error, code: "bad_credentials" }        wrong email or password
//   429  { error, code: "account_locked" | "ip_limited", retry_after }
//   other errors from Supabase Auth are passed on with their message
//
// Order: IP limit -> account lock -> Supabase Auth -> record the result.
// A locked account is refused before the password is checked.
//
// Deploy:  supabase functions deploy secure-sign-in --no-verify-jwt
// (no-verify-jwt because people calling it are not signed in yet)
//
// Optional: so Supabase's own per-IP limit sees the real visitor rather than
// this function, set a secret key (starts with sb_secret_) as SIGN_IN_SECRET_KEY
// and turn on "IP Address Forwarding" in Authentication -> Rate Limits.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const SECRET_KEY = (Deno.env.get("SIGN_IN_SECRET_KEY") ?? "").trim();
const ANON_KEY = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function limited(g: { status: string; message: string; retry_after: number }) {
  return json(
    { error: g.message, code: g.status === "locked" ? "account_locked" : "ip_limited", retry_after: g.retry_after },
    429,
    { "Retry-After": String(g.retry_after) },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let body: { email?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
  if (!password || password.length > 200) return json({ error: "Enter your password." }, 400);

  const ip = clientIp(req);

  // 1 + 2. IP limits, then the account lock (before the password is checked).
  const { data: guard, error: guardErr } = await admin.rpc("login_guard_check", { p_email: email, p_ip: ip });
  if (guardErr) {
    console.error("login_guard_check failed", guardErr.message);
    return json({ error: "Sign-in is unavailable right now. Please try again shortly." }, 503);
  }
  if (guard?.status !== "ok") return limited(guard);

  // 3. Ask Supabase Auth.
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SECRET_KEY || ANON_KEY };
  if (SECRET_KEY) headers["Sb-Forwarded-For"] = ip;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;

  if (res.ok) {
    await admin.rpc("login_guard_success", { p_email: email });
    return json(data);
  }

  const code = String(data.error_code ?? data.code ?? "");
  const message = String(data.msg ?? data.message ?? data.error_description ?? data.error ?? "");

  // 4. Wrong email or password: count it (unknown emails too, so nothing is revealed).
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    const { data: fail, error: failErr } = await admin.rpc("login_guard_failure", { p_email: email });
    if (failErr) console.error("login_guard_failure failed", failErr.message);
    if (fail?.status === "locked") return limited(fail);
    return json({ error: "Invalid login credentials", code: "bad_credentials" }, 401);
  }

  // Anything else (email not confirmed, Supabase's own rate limit, ...) passes through unchanged.
  return json({ error: message || "Sign-in failed. Please try again.", code }, res.status || 400);
});
