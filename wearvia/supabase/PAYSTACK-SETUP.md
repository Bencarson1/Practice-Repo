# NebedaHub naira payments (Paystack): setup guide

Orders from **Nigerian tailors** are priced in naira (NGN) and paid through
**Paystack**. All other orders (UK / Europe / US tailors) still go through
Stripe (`STRIPE-SETUP.md`). The app picks the provider automatically from the
order's currency (`PAYSTACK_CURRENCIES` in `wearvia/js/config.js`).

- **Customers anywhere** pay by card on Paystack's page. Paystack accepts
  international Visa and Mastercard, so the diaspora in the UK, Europe and the
  US can pay. Their bank converts the naira amount.
- **Tailors and fabric sellers** add their Nigerian bank account under
  **My profile → Payments & payouts** (Business app) or **Shop & application**
  (Sellers app). Paystack checks the account and shows the account name before
  it is saved.
- **The money rule is identical to Stripe's**: NebedaHub keeps 10%. The tailor
  gets 70% when the customer pays and 30% when the customer confirms the outfit.
  The seller gets 70% on dispatch and 30% when the tailor approves the fabric.
  A problem report needs photos, then an admin decides.

Do everything in **Test mode** first: test keys, test cards, no real money.

---

## 1. Run the database changes

In Supabase, go to **SQL Editor**. Run these files **in this order**:

1. `stripe-payments.sql`. Run it again even if you already have. It now holds
   the split shared by Stripe and Paystack.
2. `paystack-payments.sql`

Both files are safe to run more than once.

## 2. Add the secret key to Supabase

Go to Supabase → **Edge Functions** → **Secrets** → **Add new secret**:

| Name | Value |
|---|---|
| `PAYSTACK_SECRET_KEY` | your **`sk_test_…`** key from Paystack → Settings → API Keys & Webhooks |

Never put this key in the app's code or in GitHub. When you go live, replace
it with the `sk_live_…` key.

## 3. Deploy the four functions

You can deploy from the Supabase dashboard (Edge Functions → Deploy a new
function → paste the file) or with the CLI:

```
supabase functions deploy paystack-checkout
supabase functions deploy paystack-bank
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy paystack-settle  --no-verify-jwt
```

In the dashboard, **turn off "Verify JWT"** for `paystack-webhook` and
`paystack-settle`. Each of them checks who is calling it itself.

## 4. Tell Paystack where to send events (webhook)

Go to Paystack → **Settings → API Keys & Webhooks**. With **Test mode** on, set
the **Test Webhook URL** to:

```
https://ylngxdwywqteanpelsqb.supabase.co/functions/v1/paystack-webhook
```

Save. You don't need a separate webhook secret: Paystack signs every event
with your secret key, and the function checks that signature. It also asks
Paystack to confirm every payment before recording it.

## 5. Paystack settings for paying tailors (transfers)

- **Turn off OTP for transfers.** Go to Settings → **Preferences** and untick
  *"Confirm transfers before sending"* (OTP). If you leave it on, every payout
  waits for a code and sits as "on its way to the bank".
- **Keep money in the Paystack balance.** Transfers are paid from your
  Paystack balance. By default Paystack sends your takings to your bank the
  next day, which would leave nothing to pay tailors from. Ask Paystack
  support to settle to your **Paystack balance**, or top the balance up
  yourself.
- **Live transfers** only work once Paystack has activated your business
  (CAC documents, TIN and so on). Test mode works straight away.

## 6. Test it (Test mode)

1. In `wearvia/js/config.js`, set `ONLINE_PAYMENTS_ENABLED = true` and
   `TRANSACTION_TEST_MODE = false`. Real payments then switch on for **both**
   Stripe and Paystack, so do this once the Stripe setup is done as well.
2. As a Nigerian tailor, open **Payments & payouts** and add a bank account.
   - In test mode, Paystack's account check only works with its test bank
     details. Choose **Zenith Bank** or **Access Bank** (the bank list shows
     test banks) and use account number `0000000000`. If the check still
     fails, try test bank code `001`, or test with a real account number.
3. As a customer, accept a quote from that tailor and press **Pay**. On
   Paystack's page, use a test card:
   - Card: `4084 0840 8408 4081`
   - Expiry: any future date
   - CVV: `408`
   - PIN: `0000`
   - OTP: `123456`
4. Back in the app, the order shows as paid within a few seconds. The tailor's
   70% is sent by transfer, so check Paystack → **Transfers**.
5. Report a problem on a delivered order and decide it in the admin app.
   - A refund appears under Paystack → **Refunds**.
   - A tailor payout appears under **Transfers**.

## 7. Going live

1. Finish Paystack's business activation.
2. Replace `PAYSTACK_SECRET_KEY` in Supabase with your **`sk_live_…`** key.
3. Set the **Live Webhook URL** in Paystack to the same address as in step 4.
4. In Paystack, enable international cards (Settings → Preferences).

---

### How it fits together

| Step | What happens |
|---|---|
| Customer presses Pay | `paystack-checkout` reads the amount from the database and opens Paystack's page. |
| Customer pays | Paystack calls `paystack-webhook`. It checks the signature and asks Paystack to confirm the payment. Then `wv_paystack_record_payment` records it and splits the money. |
| Money is due | `paystack-settle` sends transfers to tailors and sellers, and refunds to customers. |
| Bank confirms | `paystack-webhook` marks the transfer as paid. If it failed, the money goes back to "due" and is tried again. |

Every row is kept in the same `payment_payouts` ledger as Stripe, so the app,
the problem reports and the admin review work the same for both.
