-- ============================================================
-- stripe-connect.sql — Stage 1 of real payments: payout onboarding.
--
-- Lets each tailor (designers) and fabric seller (suppliers) connect their
-- bank through Stripe Connect, so NebedaHub can later pay them for orders /
-- fabric sales. This migration only adds the columns + a read helper; the
-- actual money movement is Stage 2/3.
--
-- Safe to run more than once. Apply in Supabase → SQL Editor → Run.
-- See supabase/STRIPE-SETUP.md for the full deploy steps.
-- ============================================================

-- The connected Stripe account for each business, and whether Stripe has
-- cleared them to be paid. Written ONLY by the Stripe Edge Functions
-- (service role) — never by the app's users.
alter table public.designers
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false;

alter table public.suppliers
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false;

-- Make sure no signed-in user can write these directly (so nobody can mark
-- their own payouts "enabled" and skip Stripe's checks). Harmless if the
-- privilege was never granted.
revoke update (stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted)
  on public.designers from anon, authenticated;
revoke update (stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted)
  on public.suppliers from anon, authenticated;

-- The signed-in owner reads their own payout readiness (booleans only — the
-- Stripe account id is never exposed to the browser).
create or replace function public.wv_my_payout_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tailor', (
      select jsonb_build_object(
        'has_account',       d.stripe_account_id is not null,
        'charges_enabled',   d.stripe_charges_enabled,
        'payouts_enabled',   d.stripe_payouts_enabled,
        'details_submitted', d.stripe_details_submitted,
        'business_name',     d.business_name)
      from public.designers d
      where d.owner_user_id = auth.uid()
      order by d.created_at
      limit 1
    ),
    'seller', (
      select jsonb_build_object(
        'has_account',       s.stripe_account_id is not null,
        'charges_enabled',   s.stripe_charges_enabled,
        'payouts_enabled',   s.stripe_payouts_enabled,
        'details_submitted', s.stripe_details_submitted,
        'business_name',     s.name)
      from public.suppliers s
      where s.owner_user_id = auth.uid()
      order by s.created_at
      limit 1
    )
  )
$$;

revoke execute on function public.wv_my_payout_status() from anon;
grant execute on function public.wv_my_payout_status() to authenticated;

notify pgrst, 'reload schema';
