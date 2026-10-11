# NebedaHub payments — setup guide

Real payments are built in **three stages**. Each one is tested in Stripe
**test mode** (fake money, test cards) before going live.

- **Stage 1 — payout onboarding.** Tailors and fabric sellers
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

## Stages 2 and 3 — step by step

Do Stage 1 first (and check a tailor can reach "Payouts connected").
Everything here is still **test mode**: Stripe test cards, no real money.

How the money moves (all decided by the database, never by the browser):

| When | Who gets what |
|---|---|
| Customer pays the full amount by card | NebedaHub keeps 10% of the tailor's portion and 10% of the fabric seller's portion. Tailor is sent **70%** of the rest straight away. |
| Fabric seller marks the fabric **dispatched** | Seller is sent **70%** of their share. |
| Tailor presses **Confirm fabric received & quality accepted** | Seller is sent their final **30%**. |
| Tailor marks the order delivered, customer presses **I received it and I am happy** | Tailor is sent their final **30%**. |
| …or customer presses **I have a problem with the outfit** | Of the tailor's held 30%: 20% is refunded to the customer's card, 10% goes to the tailor. |

If a tailor or seller hasn't finished payout setup, their money waits safely
in NebedaHub's Stripe balance and is sent as soon as they connect (when they
open **Payments & payouts**).

### 1. Allow NebedaHub to split payments (once)
Stripe → **Settings → Connect → Platform profile**. Complete the
**loss-liability** acknowledgement. NebedaHub takes card payments itself and
then pays tailors and sellers ("separate charges and transfers"), so Stripe
asks the platform to accept responsibility for refunds and disputes.

### 2. Run the database migration
Supabase → **SQL Editor** → paste all of `wearvia/supabase/stripe-payments.sql`
→ **Run**. It adds the payout ledger and the payment rules. It changes no
existing data and is safe to run again.

### 3. Deploy the three new Edge Functions
From the repo root with the Supabase CLI:
```bash
supabase functions deploy stripe-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy stripe-settle  --no-verify-jwt
```
No CLI? In the dashboard create each function (**Edge Functions → Deploy a
new function → Via editor**), name it exactly as above, and paste its
`index.ts`. For **stripe-webhook** and **stripe-settle**, open the function's
**Details** and turn **Verify JWT** **off** (Stripe has no Supabase login;
both functions check who is calling themselves).

### 4. Connect the Stripe webhook
1. Stripe (Test mode) → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL:
   `https://ylngxdwywqteanpelsqb.supabase.co/functions/v1/stripe-webhook`
3. Events: `checkout.session.completed` and
   `checkout.session.async_payment_succeeded`. Save.
4. Open the endpoint → **Signing secret → Reveal** → copy it (it starts with
   `whsec` and an underscore).
5. Supabase → **Edge Functions → Secrets** → add `STRIPE_WEBHOOK_SECRET` with
   that value. Never put it in the app code.

### 5. Switch real payments on
In `wearvia/js/config.js`:
```js
const ONLINE_PAYMENTS_ENABLED = true;   // was false
const TRANSACTION_TEST_MODE = false;    // was true
```
Commit and push. (While the Stripe key in Supabase is `sk_test_…`, Stripe
only accepts test cards, so this is still safe.)

### 6. Test the whole journey
Use a UK tailor and a UK fabric seller who both show **Payouts connected**.
1. As a customer, request a quote; as the tailor, send it; as the customer,
   accept it and press **Pay … securely**.
2. On Stripe's page use card `4000 0000 0000 0077` (test money that is
   available straight away), any future date, any CVC.
3. Back on NebedaHub the order shows as paid within a few seconds. In Stripe
   → **Payments** you'll see the charge, and under **Connect → Transfers** the
   tailor's 70%.
4. As the seller, dispatch the fabric → a transfer for the seller's 70%.
5. As the tailor, confirm the fabric quality → the seller's 30%.
6. As the tailor, move the order to delivered; as the customer, press
   **I received it and I am happy** → the tailor's 30%.
7. Repeat with **I have a problem** on a second order → a refund appears on
   the payment in Stripe.

The tailor's order page and the seller's order card show "⏳ … is due and
waiting to be sent" if a payout couldn't go yet, with the reason.

---

## What is not covered yet
- **Pounds only.** Checkout is open for GBP orders. Other currencies show
  "not open yet".
- **Nigeria and Ghana** tailors/sellers need Paystack or Flutterwave (see the
  country note above). Their money stays held until that is added.
- **Cancelling a whole order** before work starts: refund it in the Stripe
  dashboard for now.
- **A customer who never confirms the outfit:** the tailor's 30% stays held.
  An admin "release" button is a sensible next addition.
- **Ready-to-wear shop items** still have checkout switched off.

## Going live later (not yet)
When everything above passes in test mode: switch Stripe to **Live mode**,
repeat steps 1 and 4 in live mode (live webhook, live signing secret), put the
**live** secret key (starts with `sk_live_`) into Supabase as
`STRIPE_SECRET_KEY`, and do a small real payment to yourself first.
