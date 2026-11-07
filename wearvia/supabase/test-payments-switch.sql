-- ============================================================
-- Test-payments switch (server side).
--
-- The "test pay" actions mark an order paid without real money. The app only
-- shows them in test mode, but the database must refuse them itself once
-- NebedaHub takes real payments, or anyone could call them directly.
--
--   ON  (now):        test payments work as before.
--   OFF (at launch):  update public.wv_payment_switches set test_payments_enabled = false;
--
-- Safe to run more than once.
-- ============================================================

create table if not exists public.wv_payment_switches (
  id boolean primary key default true check (id),   -- one row only
  test_payments_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.wv_payment_switches (id) values (true) on conflict (id) do nothing;

-- Server-only: nobody reads or changes it through the API.
alter table public.wv_payment_switches enable row level security;
revoke all on public.wv_payment_switches from anon, authenticated;

create or replace function public.wv_require_test_payments()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not coalesce((select test_payments_enabled from public.wv_payment_switches where id), false) then
    raise exception 'Test payments are switched off. NebedaHub now takes real payments only.';
  end if;
end $$;
revoke all on function public.wv_require_test_payments() from public, anon, authenticated;

-- Add the check as the first line of each test action.
do $$
declare
  f record;
  d text;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('wearvia_test_pay_order',
                        'wearvia_test_confirm_fabric_quality',
                        'wearvia_test_customer_outfit_result')
  loop
    d := pg_get_functiondef(f.oid);
    if position('wv_require_test_payments' in d) = 0 then
      d := regexp_replace(d, E'\nbegin\n', E'\nbegin\n  perform public.wv_require_test_payments();\n');
      execute d;
      raise notice 'switch added to %', f.proname;
    end if;
  end loop;
end $$;
