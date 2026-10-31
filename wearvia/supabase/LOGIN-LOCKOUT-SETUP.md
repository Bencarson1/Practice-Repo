# Sign-in lockout — setup

Protects NebedaHub sign-in with two layers:

- **Account lockout:** 3 wrong passwords for one email pause sign-in for 15 minutes. After that, every 2 more wrong pause it for 30 minutes. It never locks permanently. A correct sign-in, a password reset, or a day with no wrong attempts starts the count afresh. Unknown emails are treated the same way, so the lockout never reveals who has an account.
- **IP rate limit:** 20 sign-in attempts per 15 minutes and 100 per day from one IP address.

Do the steps **in this order** (the app falls back to normal sign-in until step 2 is done).

## 1. Run the SQL

Supabase dashboard → **SQL Editor** → New query → paste all of `login-lockout.sql` → **Run**.

## 2. Deploy the Edge Function

Either with the CLI:

```bash
supabase functions deploy secure-sign-in --no-verify-jwt
```

or in the dashboard: **Edge Functions** → **Deploy a new function** → **Via Editor**, name it `secure-sign-in`, paste `functions/secure-sign-in/index.ts`, and turn **off** "Verify JWT" in the function's settings.

## 3. Turn on the access-token hook

**Authentication** → **Hooks** → **Customize Access Token (JWT) Claims** → type **Postgres** → schema `public`, function `nebedahub_access_token_hook` → **Create hook**.

This makes Supabase refuse a session while an account is locked, even if someone calls the Supabase sign-in API directly instead of using the app.

## 4. Merge the app change

Merge the pull request so the NebedaHub apps sign in through `secure-sign-in`.

## Check it works

Sign in with a wrong password 3 times: the 3rd attempt shows "Too many failed sign-in attempts… paused for about 15 minutes". Reset the password to unlock straight away.

## Optional: Supabase's own IP limit

Because sign-in now goes through the function, Supabase's built-in per-IP limit sees the function rather than each visitor. To pass the real visitor's IP through, create a secret API key (Settings → API Keys, starts with `sb_secret_`), save it as an Edge Function secret named `SIGN_IN_SECRET_KEY`, and turn on **IP Address Forwarding** in Authentication → Rate Limits. NebedaHub's own IP limit (step above) works either way.

## Known limit (Free plan)

Wrong passwords are counted when people sign in through NebedaHub. Someone scripting Supabase's sign-in API directly isn't counted, only slowed by Supabase's IP limit, though a lock that's already in place still blocks them. Counting every attempt needs Supabase's Password Verification hook, which is Team plan only.
