# NebedaHub payments — setup guide

Real payments are built in **three stages**. Each one is tested in Stripe
**test mode** (fake money, test cards) before going live.

- **Stage 1 — payout onboarding (this guide).** Tailors and fabric sellers
  connect their bank through Stripe, so NebedaHub can pay them later.
- **Stage 2 — taking payment.** Customer pays the full amount; NebedaHub keeps
  10% and sends the tailor/seller their 70%.
- **Stage 3 — the held 30%.** Released automatically once the order passes
  quality control.

The money rule (set in `wearvia/js/config.js`): **NebedaHub keeps 10%. The
tailor/seller gets 70% when the customer pays and the final 30% once the order
passes quality control.**

---

## ⚠️ Important: which countries Stripe can pay

Stripe Connect can only pay out to businesses in **countries Stripe supports**.
The **UK is fully supported**. **Nigeria and Ghana are NOT currently supported
by Stripe for receiving payouts.**

So Stage 1 works today for **UK** tailors and sellers. Tailors/sellers in
Nigeria or Ghana will need a **different payout provider** (such as Paystack or
Flutterwave), which is separate work we can add later. Nothing here breaks for
them — they just won't be able to finish Stripe onboarding until then.

---

## Stage 1 — step by step

Everything below is **test mode**. No real money moves.

### 1. Turn on Stripe Connect (once)
1. Sign in to Stripe → make sure the top-left toggle says **Test mode**.
2. Go to **Connect** in the left menu → **Get started** → choose **Platform
   or marketplace**. This lets you pay other people.

### 2. Run the database migration
Supabase → **SQL Editor** → paste all of `wearvia/supabase/stripe-connect.sql`
→ **Run**. (Adds the Stripe columns and a read helper. Changes no data.)

### 3. Give Supabase your Stripe test secret key
1. Stripe → **Developers → API keys** → copy the **Secret key** (it starts
   with `sk_test_` in test mode).
2. Supabase → **Edge Functions → Secrets** (or **Project Settings → Edge
   Functions**) → add a secret:
   - Name: `STRIPE_SECRET_KEY`
   - Value: the `sk_test_` key you just copied.
3. Never put this key in the app code — only here. (`SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` are already provided to functions automatically.)

### 4. Deploy the two Edge Functions
They live in `wearvia/supabase/functions/`:
`stripe-connect-onboard` and `stripe-connect-status`.

With the Supabase CLI (from the repo root):
```bash
supabase functions deploy stripe-connect-onboard
supabase functions deploy stripe-connect-status
```
(If you haven't linked the project yet: `supabase link --project-ref ylngxdwywqteanpelsqb` first.)

No CLI? You can also create each function in the Supabase dashboard
(**Edge Functions → Create a function**) and paste in the code from each
`index.ts`, plus the shared `_shared/cors.ts`.

### 5. Switch the button on
In `wearvia/js/config.js` change:
```js
const PAYOUTS_ONBOARDING_ENABLED = false;   // → true
```
Commit and push. (Until this is `true`, tailors/sellers just see the old
"not open yet" notice, so it's safe to do steps 1–4 ahead of time.)

### 6. Test it
1. Sign in as a **tailor** → **NebedaHub Business → My profile** →
   **Payments & payouts** → **Set up payouts**.
2. You go to Stripe's test onboarding. Use Stripe's test values (e.g. sort
   code `10-80-00`, account `00012345`, and the test personal details Stripe
   suggests). Finish.
3. Back on the profile, press **Refresh status** — it should say
   **"Payouts connected."**
4. Do the same as a **fabric seller** in **NebedaHub Sellers → Shop &
   application → Payments & payouts**.

If a tailor/seller is in Nigeria or Ghana, Stripe will stop them in onboarding —
that's the country limitation above, not a bug.

---

## What Stage 1 does NOT do yet
- It does **not** charge customers or move any money. `ONLINE_PAYMENTS_ENABLED`
  stays `false`.
- Taking the customer's payment and splitting it (10% / 70% / 30%) is **Stage 2
  and Stage 3** — built next, once Stage 1 is tested.

## Going live later (not yet)
When all three stages are built and tested in test mode, going live means:
switch Stripe to **Live mode**, put the **live** secret key (starts with
`sk_live_ `) into Supabase, redeploy, and only then set
`ONLINE_PAYMENTS_ENABLED = true`. Do a small real payment to yourself first.
