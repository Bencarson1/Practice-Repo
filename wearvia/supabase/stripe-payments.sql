-- ============================================================
-- stripe-payments.sql — Stages 2 and 3 of real payments.
--
-- Stage 2: the customer pays the FULL order amount through Stripe Checkout.
--          The Stripe webhook records the payment here and splits it.
-- Stage 3: the held 30% is released at the protected steps below, and the
--          stripe-settle Edge Function sends what is due through Stripe.
--
-- The money rule (fixed here, nobody can edit it from the app):
--   NebedaHub keeps 10% of each portion (tailor portion, fabric seller portion).
--   Of what is left (90%):
--     Tailor        70% released when the customer pays
--                   30% held until the customer confirms the outfit
--                       (if the customer reports a problem: 1/3 of the held
--                        amount goes to the tailor and 2/3 is refunded)
--     Fabric seller 70% released when the seller dispatches the fabric
--                   30% held until the tailor confirms fabric quality
--
-- This file only DECIDES who is owed what. It never talks to Stripe. The
-- Edge Functions (stripe-checkout, stripe-webhook, stripe-settle) do that,
-- using the service role, and only ever pay rows this file marks 'released'.
--
-- Safe to run more than once. Supabase → SQL Editor → paste → Run.
-- See supabase/STRIPE-SETUP.md for the full steps.
-- ============================================================

-- ---- 1. Link payments to Stripe ----
alter table public.payments
  add column if not exists stripe_payment_intent_id   text,
  add column if not exists stripe_charge_id           text,
  add column if not exists stripe_checkout_session_id text;

create unique index if not exists payments_stripe_pi_key
  on public.payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- Only the server (service role) writes the Stripe ids
revoke insert (stripe_payment_intent_id, stripe_charge_id, stripe_checkout_session_id) on public.payments from anon, authenticated;
revoke update (stripe_payment_intent_id, stripe_charge_id, stripe_checkout_session_id) on public.payments from anon, authenticated;

-- ---- 2. The payout ledger: one row per slice of a customer's payment ----
create table if not exists public.payment_payouts (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  payment_id         uuid references public.payments (id) on delete set null,
  recipient_type     text not null check (recipient_type in ('platform', 'tailor', 'seller', 'customer')),
  recipient_id       uuid,                 -- designers.id / suppliers.id / customers.id (empty for platform)
  release_stage      text not null check (release_stage in
                       ('commission', 'on_payment', 'seller_dispatch', 'seller_quality',
                        'tailor_customer_acceptance', 'customer_refund')),
  amount             numeric(12, 2) not null check (amount >= 0),
  currency_code      text not null default 'GBP',
  -- secured  = NebedaHub is holding it
  -- released = it is due now; stripe-settle will send it
  -- paid     = Stripe transfer sent to the tailor/seller
  -- refunded = Stripe refund sent to the customer
  -- kept     = NebedaHub's commission
  -- cancelled
  status             text not null default 'secured'
                       check (status in ('secured', 'released', 'paid', 'refunded', 'kept', 'cancelled')),
  stripe_transfer_id text,
  stripe_refund_id   text,
  last_error         text,                 -- why the last Stripe attempt failed (e.g. payouts not set up yet)
  attempts           integer not null default 0,
  released_at        timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.payment_payouts add column if not exists attempts integer not null default 0;
create index if not exists payment_payouts_order_idx on public.payment_payouts (order_id);
create index if not exists payment_payouts_due_idx on public.payment_payouts (status) where status = 'released';

alter table public.payment_payouts enable row level security;

-- Read only. Nobody writes these rows from the app: only the functions below.
revoke insert, update, delete on public.payment_payouts from anon, authenticated;
grant select on public.payment_payouts to authenticated;

drop policy if exists "payment_payouts: admin reads" on public.payment_payouts;
create policy "payment_payouts: admin reads" on public.payment_payouts
  for select to authenticated using (public.is_admin());

drop policy if exists "payment_payouts: tailor team reads own orders" on public.payment_payouts;
create policy "payment_payouts: tailor team reads own orders" on public.payment_payouts
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = payment_payouts.order_id and public.can_manage_designer(o.designer_id)));

drop policy if exists "payment_payouts: seller reads own" on public.payment_payouts;
create policy "payment_payouts: seller reads own" on public.payment_payouts
  for select to authenticated using (
    recipient_type = 'seller' and exists (
      select 1 from public.suppliers s where s.id = payment_payouts.recipient_id and s.owner_user_id = auth.uid()));

drop policy if exists "payment_payouts: customer reads own orders" on public.payment_payouts;
create policy "payment_payouts: customer reads own orders" on public.payment_payouts
  for select to authenticated using (
    exists (select 1 from public.orders o join public.customers c on c.id = o.customer_id
            where o.id = payment_payouts.order_id and c.auth_user_id = auth.uid()));

-- ---- 3. Before checkout: may this customer pay this order, and how much? ----
-- Called by the stripe-checkout Edge Function (service role) with the signed-in user's id.
create or replace function public.wv_stripe_checkout_order(p_order_id uuid, p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
begin
  select o.* into v_order
    from public.orders o join public.customers c on c.id = o.customer_id
   where o.id = p_order_id and c.auth_user_id = p_user;
  if not found then return jsonb_build_object('error', 'We couldn''t find that order on your account.'); end if;
  if coalesce(v_order.quote_status, 'accepted') <> 'accepted' then
    return jsonb_build_object('error', 'Please accept the quote before paying.');
  end if;
  if v_order.deposit_paid_at is not null
     or exists (select 1 from public.payments p where p.order_id = p_order_id and p.status = 'confirmed') then
    return jsonb_build_object('error', 'This order has already been paid.');
  end if;
  if coalesce(v_order.quote_total, 0) <= 0 then
    return jsonb_build_object('error', 'This order has no total yet.');
  end if;
  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'outfit', v_order.outfit_type,
    'amount', round(v_order.quote_total, 2),
    'currency', upper(coalesce(v_order.currency_code, 'GBP')));
end $$;

-- ---- 4. The webhook records a paid checkout and splits the money ----
create or replace function public.wv_stripe_record_payment(
  p_order_id uuid, p_amount numeric, p_currency text,
  p_payment_intent text, p_charge text, p_session text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order       public.orders%rowtype;
  v_existing    uuid;
  v_pay_id      uuid := gen_random_uuid();
  v_total       numeric;
  v_cur         text;
  v_seller_id   uuid;
  v_line_sent   boolean := false;
  v_s_gross     numeric := 0;
  v_t_gross     numeric;
  v_s_comm      numeric; v_s_net numeric; v_s_first numeric; v_s_held numeric;
  v_t_comm      numeric; v_t_net numeric; v_t_first numeric; v_t_held numeric;
  -- the fixed rule
  c_commission  constant numeric := 0.10;
  c_first       constant numeric := 0.70;
begin
  -- Stripe can send the same event twice: record it once
  select id into v_existing from public.payments where stripe_payment_intent_id = p_payment_intent;
  if found then return jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', v_existing); end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  v_total := round(coalesce(v_order.quote_total, 0), 2);
  v_cur   := upper(coalesce(v_order.currency_code, 'GBP'));

  -- Record the payment (kind 'Full payment' if the database allows it, else 'Deposit')
  begin
    insert into public.payments (id, order_id, amount, method, kind, status, paid_on, note,
                                 stripe_payment_intent_id, stripe_charge_id, stripe_checkout_session_id)
    values (v_pay_id, p_order_id, round(p_amount, 2), 'Card', 'Full payment', 'awaiting_confirmation', current_date,
            'Paid online with Stripe', p_payment_intent, p_charge, p_session);
  exception when check_violation then
    insert into public.payments (id, order_id, amount, method, kind, status, paid_on, note,
                                 stripe_payment_intent_id, stripe_charge_id, stripe_checkout_session_id)
    values (v_pay_id, p_order_id, round(p_amount, 2), 'Card', 'Deposit', 'awaiting_confirmation', current_date,
            'Paid online with Stripe (full payment)', p_payment_intent, p_charge, p_session);
  end;

  -- Safety: only split a payment that exactly matches the accepted quote,
  -- and only once per order. Anything else waits for the admin in Stripe.
  if abs(round(p_amount, 2) - v_total) >= 0.01 or upper(p_currency) <> v_cur
     or exists (select 1 from public.payment_payouts where order_id = p_order_id and status <> 'cancelled') then
    update public.payments set note = 'Stripe payment did not match the quote — check it in Stripe before confirming.'
     where id = v_pay_id;
    return jsonb_build_object('ok', false, 'payment_id', v_pay_id, 'reason', 'amount_mismatch_or_already_split');
  end if;

  -- Confirming the payment marks the order paid (the payments trigger does that)
  update public.payments set status = 'confirmed' where id = v_pay_id;

  -- Who supplies the fabric, and has it already been sent?
  v_seller_id := v_order.fabric_supplier_id;
  if v_seller_id is null then
    select fl.supplier_id into v_seller_id from public.fabric_order_lines fl
     where fl.order_id = p_order_id and fl.status <> 'cancelled' order by fl.created_at limit 1;
  end if;
  if v_seller_id is not null then
    v_s_gross := least(greatest(coalesce(v_order.fabric_cost, 0), 0), v_total);
    select coalesce(bool_or(fl.status = 'sent'), false) into v_line_sent
      from public.fabric_order_lines fl where fl.order_id = p_order_id and fl.supplier_id = v_seller_id;
  end if;
  v_t_gross := v_total - v_s_gross;

  v_s_comm  := round(v_s_gross * c_commission, 2);
  v_s_net   := v_s_gross - v_s_comm;
  v_s_first := round(v_s_net * c_first, 2);
  v_s_held  := v_s_net - v_s_first;

  v_t_comm  := round(v_t_gross * c_commission, 2);
  v_t_net   := v_t_gross - v_t_comm;
  v_t_first := round(v_t_net * c_first, 2);
  v_t_held  := v_t_net - v_t_first;

  insert into public.payment_payouts (order_id, payment_id, recipient_type, recipient_id, release_stage, amount, currency_code, status, released_at)
  select p_order_id, v_pay_id, x.rtype, x.rid, x.stage, x.amt, v_cur, x.st, case when x.st in ('released', 'kept') then now() end
    from (values
      ('platform', null::uuid,          'commission',                 v_s_comm + v_t_comm, 'kept'),
      ('tailor',   v_order.designer_id, 'on_payment',                 v_t_first,           'released'),
      ('tailor',   v_order.designer_id, 'tailor_customer_acceptance', v_t_held,            'secured'),
      ('seller',   v_seller_id,         'seller_dispatch',            v_s_first,           case when v_line_sent then 'released' else 'secured' end),
      ('seller',   v_seller_id,         'seller_quality',             v_s_held,            'secured')
    ) as x(rtype, rid, stage, amt, st)
   where x.amt > 0 and (x.rtype = 'platform' or x.rid is not null);

  return jsonb_build_object(
    'ok', true, 'payment_id', v_pay_id, 'currency', v_cur, 'amount', v_total,
    'platform_commission', v_s_comm + v_t_comm,
    'tailor_initial', v_t_first, 'tailor_held', v_t_held,
    'seller_on_dispatch', v_s_first, 'seller_held', v_s_held);
end $$;

-- ---- 5. Stage 3 releases ----

-- The seller's 70% becomes due when they dispatch the fabric
create or replace function public.wv_payouts_on_fabric_sent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' and new.order_id is not null then
    update public.payment_payouts
       set status = 'released', released_at = now(), updated_at = now()
     where order_id = new.order_id and recipient_type = 'seller' and recipient_id = new.supplier_id
       and release_stage = 'seller_dispatch' and status = 'secured';
  end if;
  return new;
end $$;
drop trigger if exists wv_payouts_on_fabric_sent on public.fabric_order_lines;
create trigger wv_payouts_on_fabric_sent after update of status on public.fabric_order_lines
  for each row execute function public.wv_payouts_on_fabric_sent();

-- The tailor confirms the fabric arrived and is good: the seller's held 30% is due
create or replace function public.wearvia_release_fabric_balance(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order    public.orders%rowtype;
  v_released numeric;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found.'; end if;
  if not (public.is_admin() or public.can_manage_designer(v_order.designer_id)) then
    raise exception 'Only the tailor for this order can confirm the fabric.';
  end if;
  if not exists (select 1 from public.fabric_order_lines fl where fl.order_id = p_order_id and fl.status = 'sent') then
    raise exception 'The fabric hasn''t been dispatched yet.';
  end if;
  with r as (
    update public.payment_payouts
       set status = 'released', released_at = now(), updated_at = now()
     where order_id = p_order_id and recipient_type = 'seller' and release_stage = 'seller_quality' and status = 'secured'
    returning amount)
  select coalesce(sum(amount), 0) into v_released from r;
  if v_released = 0 then raise exception 'There is no protected fabric balance waiting on this order.'; end if;
  return jsonb_build_object('released', v_released, 'currency', upper(coalesce(v_order.currency_code, 'GBP')));
end $$;

-- The customer confirms the outfit (or reports a problem): the tailor's held 30%
create or replace function public.wearvia_outfit_received(p_order_id uuid, p_happy boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order  public.orders%rowtype;
  v_held   public.payment_payouts%rowtype;
  v_tailor numeric;
  v_refund numeric;
  v_cur    text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not (public.is_admin() or exists (
      select 1 from public.customers c where c.id = v_order.customer_id and c.auth_user_id = auth.uid())) then
    raise exception 'Only the customer for this order can confirm it.';
  end if;
  if v_order.stage::text <> 'delivered' then
    raise exception 'You can confirm the outfit once the tailor marks it delivered.';
  end if;
  select * into v_held from public.payment_payouts
   where order_id = p_order_id and recipient_type = 'tailor' and release_stage = 'tailor_customer_acceptance' and status = 'secured'
   limit 1 for update;
  if not found then raise exception 'There is no protected tailor balance waiting on this order.'; end if;
  v_cur := v_held.currency_code;

  if p_happy then
    update public.payment_payouts set status = 'released', released_at = now(), updated_at = now() where id = v_held.id;
    return jsonb_build_object('tailor_release', v_held.amount, 'customer_refund', 0, 'currency', v_cur);
  end if;

  -- Problem reported: 1/3 of the held amount to the tailor, 2/3 refunded
  v_tailor := round(v_held.amount / 3, 2);
  v_refund := v_held.amount - v_tailor;
  update public.payment_payouts set status = 'cancelled', updated_at = now() where id = v_held.id;
  insert into public.payment_payouts (order_id, payment_id, recipient_type, recipient_id, release_stage, amount, currency_code, status, released_at)
  select p_order_id, v_held.payment_id, x.rtype, x.rid, x.stage, x.amt, v_cur, 'released', now()
    from (values
      ('tailor',   v_order.designer_id, 'tailor_customer_acceptance', v_tailor),
      ('customer', v_order.customer_id, 'customer_refund',            v_refund)
    ) as x(rtype, rid, stage, amt)
   where x.amt > 0;
  return jsonb_build_object('tailor_release', v_tailor, 'customer_refund', v_refund, 'currency', v_cur);
end $$;

-- ---- 6. For stripe-settle: what is due, and record what was sent ----
create or replace function public.wv_stripe_due_payouts(p_order_id uuid default null, p_owner uuid default null)
returns table (payout_id uuid, order_id uuid, order_number text, recipient_type text, amount numeric,
               currency_code text, destination text, charge_id text, payment_intent_id text, attempts integer)
language sql stable security definer set search_path = public as $$
  select pp.id, pp.order_id, o.order_number, pp.recipient_type, pp.amount, pp.currency_code,
         case pp.recipient_type when 'tailor' then d.stripe_account_id when 'seller' then s.stripe_account_id end,
         p.stripe_charge_id, p.stripe_payment_intent_id, pp.attempts
    from public.payment_payouts pp
    join public.orders o on o.id = pp.order_id
    left join public.payments p on p.id = pp.payment_id
    left join public.designers d on pp.recipient_type = 'tailor' and d.id = pp.recipient_id
    left join public.suppliers s on pp.recipient_type = 'seller' and s.id = pp.recipient_id
   where pp.status = 'released' and pp.amount > 0
     and pp.recipient_type in ('tailor', 'seller', 'customer')
     and (p_order_id is null or pp.order_id = p_order_id)
     and (p_owner is null or d.owner_user_id = p_owner or s.owner_user_id = p_owner)
   order by pp.created_at
   limit 200
$$;

create or replace function public.wv_stripe_mark_payout(p_payout_id uuid, p_transfer text, p_refund text, p_error text)
returns void
language sql security definer set search_path = public as $$
  update public.payment_payouts
     set status             = case when p_transfer is not null then 'paid' when p_refund is not null then 'refunded' else status end,
         stripe_transfer_id = coalesce(p_transfer, stripe_transfer_id),
         stripe_refund_id   = coalesce(p_refund, stripe_refund_id),
         last_error         = case when p_transfer is null and p_refund is null then left(p_error, 500) end,
         attempts           = attempts + case when p_transfer is null and p_refund is null then 1 else 0 end,
         paid_at            = case when p_transfer is not null or p_refund is not null then now() else paid_at end,
         updated_at         = now()
   where id = p_payout_id and status = 'released'
$$;

-- ---- 7. Who may call what ----
revoke execute on function public.wv_stripe_checkout_order(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.wv_stripe_record_payment(uuid, numeric, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.wv_stripe_due_payouts(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.wv_stripe_mark_payout(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.wv_payouts_on_fabric_sent() from public, anon, authenticated;
grant execute on function public.wv_stripe_checkout_order(uuid, uuid) to service_role;
grant execute on function public.wv_stripe_record_payment(uuid, numeric, text, text, text, text) to service_role;
grant execute on function public.wv_stripe_due_payouts(uuid, uuid) to service_role;
grant execute on function public.wv_stripe_mark_payout(uuid, text, text, text) to service_role;

revoke execute on function public.wearvia_release_fabric_balance(uuid) from public, anon;
revoke execute on function public.wearvia_outfit_received(uuid, boolean) from public, anon;
grant execute on function public.wearvia_release_fabric_balance(uuid) to authenticated;
grant execute on function public.wearvia_outfit_received(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
