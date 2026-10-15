-- ============================================================
-- auto-release.sql — the tailor's held 30% is released automatically
-- 7 days after delivery when the customer says nothing.
--
-- The rule (decided by the owner):
--   • The tailor's last 30% is released when the customer confirms they're
--     happy (wearvia_outfit_received), as before.
--   • If the customer neither confirms nor reports a problem within 7 days of
--     the order being marked delivered, it is released automatically.
--   • An open problem report freezes it until the admin decides.
--
-- Run after stripe-payments.sql (and paystack-payments.sql if you use it).
-- Safe to run again.
-- ============================================================

-- When was the order last marked delivered? (from the order history)
create or replace function public.wv_delivered_at(p_order_id uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(e.created_at) from public.order_events e
   where e.order_id = p_order_id and e.stage::text = 'delivered'
$$;

-- Release every held tailor balance whose 7 days are up.
-- p_order_id limits it to one order; empty = all orders.
create or replace function public.wv_auto_release_held(p_order_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  c_days constant interval := interval '7 days';
  v_count integer;
begin
  update public.payment_payouts pp
     set status = 'released', released_at = now(), updated_at = now()
    from public.orders o
   where o.id = pp.order_id
     and pp.recipient_type = 'tailor'
     and pp.release_stage = 'tailor_customer_acceptance'
     and pp.status = 'secured'
     and (p_order_id is null or pp.order_id = p_order_id)
     and o.stage::text = 'delivered'
     and public.wv_delivered_at(o.id) is not null
     and public.wv_delivered_at(o.id) <= now() - c_days
     and not exists (select 1 from public.outfit_disputes d
                      where d.order_id = o.id and d.status = 'open');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Only the server and the admin may run it; it can only release money that
-- is already owed under the rule above, so it is safe to run as often as you like.
revoke all on function public.wv_auto_release_held(uuid) from public, anon;
grant execute on function public.wv_auto_release_held(uuid) to authenticated, service_role;

-- When is it due? (shown to the customer and the tailor)
create or replace function public.wv_auto_release_date(p_order_id uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select public.wv_delivered_at(p_order_id) + interval '7 days'
$$;
grant execute on function public.wv_auto_release_date(uuid) to authenticated;

-- Run it every day at 06:00 UTC, if pg_cron is available on this project.
-- (Supabase: Database → Extensions → enable pg_cron, then run this file again.)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nebedahub-auto-release';
    perform cron.schedule('nebedahub-auto-release', '0 6 * * *',
                          'select public.wv_auto_release_held(null)');
    raise notice 'OK - daily auto-release scheduled (06:00 UTC).';
  else
    raise notice 'NOTE - pg_cron is not enabled. Auto-release still runs whenever payouts are settled; enable pg_cron for a daily run.';
  end if;
end $$;

-- ---- Report ----
do $$
begin
  if exists (select 1 from pg_proc where proname = 'wv_auto_release_held') then
    raise notice 'OK - wv_auto_release_held installed.';
  end if;
  raise notice 'ALL DONE - OK';
end $$;
