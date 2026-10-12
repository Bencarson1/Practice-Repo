-- ============================================================
-- paystack-payments.sql — the Nigeria payment rail (Paystack).
--
-- Orders priced in naira (NGN), i.e. orders with a Nigerian tailor, are paid
-- through Paystack instead of Stripe. Customers anywhere can pay by card
-- (Paystack accepts international Visa / Mastercard), and tailors and fabric
-- sellers are paid straight into their Nigerian bank account.
--
-- The money rule is EXACTLY the same as Stripe's (stripe-payments.sql):
-- 10% NebedaHub, 70% released / 30% held, problem reports reviewed by an admin.
-- This file reuses that ledger (payment_payouts) and those rules; it only adds
-- what Paystack needs:
--   • the Paystack reference on each payment
--   • each tailor's / seller's Nigerian bank (as a Paystack "transfer recipient")
--   • functions the paystack-* Edge Functions call (service role only)
--
-- Run AFTER stripe-payments.sql. Safe to run more than once.
-- Supabase → SQL Editor → paste → Run. See supabase/PAYSTACK-SETUP.md.
-- ============================================================

-- ---- 1. Link payments to Paystack ----
alter table public.payments
  add column if not exists paystack_reference      text,
  add column if not exists paystack_transaction_id text;
create unique index if not exists payments_paystack_ref_key
  on public.payments (paystack_reference) where paystack_reference is not null;
revoke insert (paystack_reference, paystack_transaction_id) on public.payments from anon, authenticated;
revoke update (paystack_reference, paystack_transaction_id) on public.payments from anon, authenticated;

-- ---- 2. Payout rows sent through Paystack ----
alter table public.payment_payouts
  add column if not exists paystack_transfer_code      text,
  add column if not exists paystack_transfer_reference text,
  add column if not exists paystack_refund_id          text;
create index if not exists payment_payouts_paystack_ref_idx
  on public.payment_payouts (paystack_transfer_reference) where paystack_transfer_reference is not null;

-- Paystack transfers aren't instant: 'sending' = Paystack accepted the transfer
-- and is sending it to the bank. Its webhook then says paid, or failed (and the
-- row goes back to 'released' to be tried again).
alter table public.payment_payouts drop constraint if exists payment_payouts_status_check;
alter table public.payment_payouts add constraint payment_payouts_status_check
  check (status in ('secured', 'released', 'sending', 'paid', 'refunded', 'kept', 'cancelled'));

-- ---- 3. Nigerian bank accounts of tailors and fabric sellers ----
-- Saved ONLY by the paystack-bank Edge Function after Paystack has checked the
-- account number and returned the account holder's name. The full account
-- number is never stored here — just the last 4 digits to show the owner.
create table if not exists public.payout_bank_accounts (
  id                      uuid primary key default gen_random_uuid(),
  owner_type              text not null check (owner_type in ('tailor', 'seller')),
  owner_id                uuid not null,             -- designers.id / suppliers.id
  provider                text not null default 'paystack',
  currency_code           text not null default 'NGN',
  bank_code               text not null,
  bank_name               text not null,
  account_last4           text not null,
  account_name            text not null,
  paystack_recipient_code text not null,
  saved_by                uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (owner_type, owner_id, provider)
);
alter table public.payout_bank_accounts enable row level security;
-- No direct access from the app at all: read through wv_my_paystack_status()
revoke all on public.payout_bank_accounts from anon, authenticated;

drop policy if exists "payout_bank_accounts: admin reads" on public.payout_bank_accounts;
create policy "payout_bank_accounts: admin reads" on public.payout_bank_accounts
  for select to authenticated using (public.is_admin());
grant select on public.payout_bank_accounts to authenticated;   -- the policy above limits it to admins

-- ---- 4. The owner's payout set-up, for the "Payments & payouts" card ----
create or replace function public.wv_my_paystack_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tailor', (
      select jsonb_build_object(
        'currency', upper(coalesce(d.currency_code, 'GBP')),
        'bank', (select jsonb_build_object('bank_name', b.bank_name, 'last4', b.account_last4, 'account_name', b.account_name)
                   from public.payout_bank_accounts b
                  where b.owner_type = 'tailor' and b.owner_id = d.id and b.provider = 'paystack'))
        from public.designers d where d.owner_user_id = auth.uid() order by d.created_at limit 1),
    'seller', (
      select jsonb_build_object(
        'currency', upper(coalesce(s.currency_code, 'GBP')),
        'bank', (select jsonb_build_object('bank_name', b.bank_name, 'last4', b.account_last4, 'account_name', b.account_name)
                   from public.payout_bank_accounts b
                  where b.owner_type = 'seller' and b.owner_id = s.id and b.provider = 'paystack'))
        from public.suppliers s where s.owner_user_id = auth.uid() order by s.created_at limit 1))
$$;

-- Called by paystack-bank (service role) with the signed-in user's id.
-- Only the OWNER of the business can change where its money goes.
create or replace function public.wv_paystack_save_bank(
  p_user uuid, p_role text, p_bank_code text, p_bank_name text,
  p_last4 text, p_account_name text, p_recipient_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if p_role = 'tailor' then
    select d.id into v_owner from public.designers d where d.owner_user_id = p_user order by d.created_at limit 1;
  elsif p_role = 'seller' then
    select s.id into v_owner from public.suppliers s where s.owner_user_id = p_user order by s.created_at limit 1;
  else
    raise exception 'Unknown business type.';
  end if;
  if v_owner is null then raise exception 'Only the owner of the business can add its bank account.'; end if;
  if coalesce(p_recipient_code, '') !~ '^RCP_' then raise exception 'Paystack did not accept this bank account.'; end if;

  insert into public.payout_bank_accounts (owner_type, owner_id, provider, currency_code, bank_code, bank_name,
                                           account_last4, account_name, paystack_recipient_code, saved_by)
  values (p_role, v_owner, 'paystack', 'NGN', p_bank_code, left(p_bank_name, 120),
          right(p_last4, 4), left(p_account_name, 160), p_recipient_code, p_user)
  on conflict (owner_type, owner_id, provider) do update
     set bank_code = excluded.bank_code, bank_name = excluded.bank_name, account_last4 = excluded.account_last4,
         account_name = excluded.account_name, paystack_recipient_code = excluded.paystack_recipient_code,
         saved_by = excluded.saved_by, updated_at = now();

  -- Anything that waited for a bank account can go now: clear the old reason
  update public.payment_payouts pp set last_error = null, updated_at = now()
   where pp.status = 'released' and pp.recipient_type = p_role and pp.recipient_id = v_owner;

  return jsonb_build_object('ok', true, 'bank_name', p_bank_name, 'last4', right(p_last4, 4), 'account_name', p_account_name);
end $$;

-- ---- 5. The webhook records a successful Paystack charge ----
create or replace function public.wv_paystack_record_payment(
  p_order_id uuid, p_amount numeric, p_currency text, p_reference text, p_transaction_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
  v_pay_id   uuid := gen_random_uuid();
begin
  -- Paystack can send the same event more than once: record it once
  select id into v_existing from public.payments where paystack_reference = p_reference;
  if found then return jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', v_existing); end if;

  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;

  begin
    insert into public.payments (id, order_id, amount, method, kind, status, paid_on, note, provider,
                                 paystack_reference, paystack_transaction_id)
    values (v_pay_id, p_order_id, round(p_amount, 2), 'Card', 'Full payment', 'awaiting_confirmation', current_date,
            'Paid online with Paystack', 'paystack', p_reference, p_transaction_id);
  exception when check_violation then
    insert into public.payments (id, order_id, amount, method, kind, status, paid_on, note, provider,
                                 paystack_reference, paystack_transaction_id)
    values (v_pay_id, p_order_id, round(p_amount, 2), 'Card', 'Deposit', 'awaiting_confirmation', current_date,
            'Paid online with Paystack (full payment)', 'paystack', p_reference, p_transaction_id);
  end;

  return public.wv_split_payment(p_order_id, v_pay_id, p_amount, p_currency, 'Paystack');
end $$;

-- ---- 6. For paystack-settle: what is due, and record what was sent ----
create or replace function public.wv_paystack_due_payouts(p_order_id uuid default null, p_owner uuid default null)
returns table (payout_id uuid, order_id uuid, order_number text, recipient_type text, amount numeric,
               currency_code text, recipient_code text, payment_reference text, attempts integer)
language sql stable security definer set search_path = public as $$
  select pp.id, pp.order_id, o.order_number, pp.recipient_type, pp.amount, pp.currency_code,
         b.paystack_recipient_code, p.paystack_reference, pp.attempts
    from public.payment_payouts pp
    join public.orders o on o.id = pp.order_id
    join public.payments p on p.id = pp.payment_id and p.provider = 'paystack'
    left join public.designers d on pp.recipient_type = 'tailor' and d.id = pp.recipient_id
    left join public.suppliers s on pp.recipient_type = 'seller' and s.id = pp.recipient_id
    left join public.payout_bank_accounts b
           on b.provider = 'paystack' and b.owner_type = pp.recipient_type and b.owner_id = pp.recipient_id
   where pp.status = 'released' and pp.amount > 0
     and pp.recipient_type in ('tailor', 'seller', 'customer')
     and (p_order_id is null or pp.order_id = p_order_id)
     and (p_owner is null or d.owner_user_id = p_owner or s.owner_user_id = p_owner)
   order by pp.created_at
   limit 200
$$;

-- p_status: 'sending' (transfer accepted), 'paid', 'refunded', or 'error'
create or replace function public.wv_paystack_mark_payout(
  p_payout_id uuid, p_status text, p_transfer_code text, p_transfer_reference text, p_refund text, p_error text)
returns void
language sql security definer set search_path = public as $$
  update public.payment_payouts
     set status                      = case when p_status in ('sending', 'paid', 'refunded') then p_status else status end,
         paystack_transfer_code      = coalesce(p_transfer_code, paystack_transfer_code),
         paystack_transfer_reference = coalesce(p_transfer_reference, paystack_transfer_reference),
         paystack_refund_id          = coalesce(p_refund, paystack_refund_id),
         last_error                  = case when p_status = 'error' then left(p_error, 500) end,
         attempts                    = attempts + case when p_status = 'error' then 1 else 0 end,
         paid_at                     = case when p_status in ('paid', 'refunded') then now() else paid_at end,
         updated_at                  = now()
   where id = p_payout_id and status = 'released'
$$;

-- Paystack's webhook reports how a transfer ended
--   success          → paid
--   failed/reversed  → back to 'released' (tried again next time, with a new reference)
create or replace function public.wv_paystack_transfer_result(p_reference text, p_event text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.payment_payouts%rowtype;
begin
  select * into v_row from public.payment_payouts
   where paystack_transfer_reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown transfer'); end if;

  if p_event = 'transfer.success' then
    update public.payment_payouts set status = 'paid', paid_at = coalesce(paid_at, now()), last_error = null, updated_at = now()
     where id = v_row.id and status in ('sending', 'paid');
  elsif p_event in ('transfer.failed', 'transfer.reversed') then
    update public.payment_payouts
       set status = 'released', paid_at = null, attempts = attempts + 1,
           last_error = left(coalesce(nullif(p_reason, ''), 'The bank transfer did not go through.'), 500), updated_at = now()
     where id = v_row.id and status in ('sending', 'paid');
  end if;
  return jsonb_build_object('ok', true, 'payout_id', v_row.id, 'order_id', v_row.order_id);
end $$;

-- ---- 7. Who may call what ----
revoke execute on function public.wv_paystack_save_bank(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.wv_paystack_record_payment(uuid, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function public.wv_paystack_due_payouts(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.wv_paystack_mark_payout(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.wv_paystack_transfer_result(text, text, text) from public, anon, authenticated;
grant execute on function public.wv_paystack_save_bank(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.wv_paystack_record_payment(uuid, numeric, text, text, text) to service_role;
grant execute on function public.wv_paystack_due_payouts(uuid, uuid) to service_role;
grant execute on function public.wv_paystack_mark_payout(uuid, text, text, text, text, text) to service_role;
grant execute on function public.wv_paystack_transfer_result(text, text, text) to service_role;

revoke execute on function public.wv_my_paystack_status() from public, anon;
grant execute on function public.wv_my_paystack_status() to authenticated;

notify pgrst, 'reload schema';
