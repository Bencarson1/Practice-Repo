# NebedaHub End-to-End Acceptance Test

Date: 2026-09-26
Stripe/payment collection: intentionally disabled

## Cross-app transaction test

PASS - Tailor can send a quote for a customer order.
PASS - Customer can accept the exact current quote.
PASS - Fabric stock is reserved when the quote is accepted.
PASS - A fabric seller order line is created automatically.
PASS - An invoice is created automatically.
PASS - Seller can confirm the fabric order.
PASS - Seller cannot dispatch before deposit confirmation.
PASS - After a trusted deposit confirmation is simulated, seller can dispatch with tracking.
PASS - Tailor can progress the order into production after payment confirmation.
PASS - Customer can still read their own order.
PASS - Customer can read the order chat after cross-app updates.
PASS - Test transaction was rolled back, so no fake seller, fabric, messages, or order changes remain in the live database.

## Security and role separation already verified

PASS - Ordinary users cannot approve tailors.
PASS - Ordinary users cannot approve fabric sellers.
PASS - Sellers cannot approve their own fabrics.
PASS - Sellers cannot change fabric order totals.
PASS - Tailor approval does not automatically grant seller permissions.
PASS - Seller approval requires a separate seller application.
PASS - Normal staff cannot perform owner/manager-only business actions.
PASS - Customer measurements, chats, style photos, and seller evidence remain private.
PASS - Ordinary users cannot promote themselves to admin.
PASS - Only admin can resolve marketplace disputes.
PASS - Ownerless sellers and tailors cannot be approved.
PASS - Public supplier fields are readable while private seller contact fields remain blocked.

## Project package checks

PASS - All JavaScript files pass syntax checks.
PASS - No missing local CSS, JavaScript, or image references were found in HTML files.
PASS - No common Stripe secret key, Supabase secret key, GitHub token, service-role key, or private-key pattern was found in browser/source files.
PASS - ONLINE_PAYMENTS_ENABLED is false.
PASS - Customer live payment buttons are hidden while payments are disabled.
PASS - Business payment controls are disabled while payments are disabled.
PASS - Seller and tailor payout cards state that payments are not open yet.

## Still required before calling the product launch-ready

MANUAL - Deploy this latest front-end package to the production GitHub branch/site. Database security changes are already live in Supabase, but the latest front-end package is not automatically deployed by this acceptance test.
MANUAL - Open the deployed production site in Chrome desktop, iPhone/Safari, and Android/Chrome and complete the visible journey using test accounts.
MANUAL - Check spacing, buttons, menus, text wrapping, image upload previews, and responsive layouts on real screen sizes.
MANUAL - Turn on Supabase Leaked Password Protection.
LATER - Register the payment provider and perform real payment/webhook tests before enabling ONLINE_PAYMENTS_ENABLED.

## Result

The tested non-payment application logic and cross-app database flow passed the acceptance test. This does not mean every visual detail is guaranteed perfect on every device. Final production deployment and real-device UI testing are still required before launch.
