-- =====================================================================
-- Wearvia — the price list lives in the database
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it after setup.sql (and yards.sql), before the app update that
-- has the Business → Prices page goes live.
--
-- What it does:
--   1. Adds a price list table: tailoring price and typical yards for each
--      outfit, the embroidery prices and the delivery price. Everyone can
--      read it (the app shows it in quotes); only the Nebeda Threads team
--      can change it (Business → Prices).
--   2. Changes the "new order" trigger so that, when a customer places an
--      order, the database works out tailoring, embroidery and delivery
--      from the price list itself. Whatever the customer's browser sends
--      for those is ignored. If the total the customer was shown doesn't
--      match (for example the price changed a moment ago) the order is
--      refused and the app shows the new quote. The team can still set
--      their own prices on walk-in orders.
--   3. Removes old database functions that still work in metres
--      (buy_fabric, return_fabric and any others). The app never calls
--      them. A function is only removed when nothing else uses it.
--   4. Shows a short report at the end.
--
-- Safe to run more than once: the price list is only filled in the first
-- time, so prices you've changed are never put back. Nothing is deleted
-- apart from the old metre functions, and the money on existing orders,
-- invoices and payments is never touched (the report checks this).
-- Everything runs in one transaction: if any step fails, nothing is changed.
--
-- After this file, run tailor-quote.sql as well (again if it has run before):
-- it replaces the "new order" rules so customers' orders become quote requests.
-- =====================================================================

begin;

-- A copy of the money on every existing order, invoice and payment, so the
-- report at the end can show nothing changed (a temporary table: it
-- disappears when you close the SQL Editor tab)
drop table if exists pg_temp.wv_money_before;
create temp table wv_money_before as
  select 'order' as kind, id, md5(row(fabric_cost, tailoring_cost, embroidery_cost, delivery_cost,
                                      quote_total, deposit_amount, line_items)::text) as money
  from public.orders
  union all
  select 'invoice', id, md5(row(total, line_items)::text) from public.invoices
  union all
  select 'payment', id, md5(row(amount, status)::text) from public.payments;


-- ---------------------------------------------------------------------
-- 1. The price list
-- ---------------------------------------------------------------------

create table if not exists public.price_list (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('outfit', 'embroidery', 'delivery')),
  name       text not null,                        -- "Agbada", "Gold", "Delivery"
  price      numeric(10, 2) not null check (price >= 0),
  yards      numeric(6, 2),                        -- outfits only: typical fabric for one adult
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint price_list_kind_name_key unique (kind, name),
  constraint price_list_outfit_yards_check check (kind <> 'outfit' or yards > 0)
);

-- The prices the app used until now. Only added if missing, so running this
-- file again never undoes a price you've changed.
insert into public.price_list (kind, name, price, yards, sort_order) values
  ('outfit', 'Agbada',    280, 10,  1),
  ('outfit', 'Kaftan',    150, 4.5, 2),
  ('outfit', 'Senator',   170, 4,   3),
  ('outfit', 'Bubu',      140, 5,   4),
  ('outfit', 'Two Piece', 180, 4,   5),
  ('outfit', 'Dress',     160, 3,   6),
  ('outfit', 'Wedding',   450, 10,  7),
  ('outfit', 'Suit',      350, 3.5, 8),
  ('outfit', 'Aso Ebi',   160, 5,   9),
  ('outfit', 'Custom',    200, 5,   10),
  ('embroidery', 'Gold',   60, null, 1),
  ('embroidery', 'Silver', 50, null, 2),
  ('embroidery', 'None',    0, null, 3),
  ('delivery', 'Delivery', 15, null, 1)
on conflict (kind, name) do nothing;

-- Records who changed a price and when; only outfits have yards
create or replace function public.wv_price_list_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.kind := old.kind;
  new.name := old.name;
  if new.kind <> 'outfit' then new.yards := null; end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists wv_price_list_before_update on public.price_list;
create trigger wv_price_list_before_update before update on public.price_list
  for each row execute function public.wv_price_list_before_update();

-- Security rules: anyone can read the prices; only the team can change them.
-- The team can change a price and the yards, nothing else, and nobody can
-- add or delete rows from the app (an outfit missing from the list can't be ordered).
alter table public.price_list enable row level security;

drop policy if exists "price_list: everyone reads" on public.price_list;
create policy "price_list: everyone reads" on public.price_list
  for select using (true);
drop policy if exists "price_list: team changes prices" on public.price_list;
create policy "price_list: team changes prices" on public.price_list
  for update to authenticated using ((select public.wv_is_team())) with check ((select public.wv_is_team()));

revoke all on public.price_list from public, anon, authenticated;
grant select on public.price_list to anon, authenticated;
grant update (price, yards) on public.price_list to authenticated;


-- ---------------------------------------------------------------------
-- 2. New orders use the price list
-- ---------------------------------------------------------------------

-- £1,234 or £1,234.50 — the same way the app writes money
create or replace function public.wv_money_text(p_amount numeric) returns text
language sql immutable set search_path = public as $$
  select '£' || case when p_amount = trunc(p_amount) then to_char(p_amount, 'FM999,999,990')
                     else to_char(p_amount, 'FM999,999,990.00') end
$$;

-- The itemised quote, worded the same way as the app's quote screen
create or replace function public.wv_quote_lines(
  p_fabric_name text, p_yards numeric, p_price_per_yard numeric, p_fabric_cost numeric,
  p_outfit text, p_tailoring numeric, p_embroidery text, p_embroidery_cost numeric, p_delivery numeric)
returns jsonb
language sql immutable set search_path = public as $$
  select case when p_fabric_name is null then '[]'::jsonb
              else jsonb_build_array(jsonb_build_object(
                'label', 'Fabric — ' || p_fabric_name || ' (' || trim_scale(p_yards) || ' yd × '
                         || public.wv_money_text(p_price_per_yard) || ')',
                'amount', p_fabric_cost)) end
      || jsonb_build_array(
           jsonb_build_object('label', 'Tailoring (' || p_outfit || ')', 'amount', p_tailoring),
           jsonb_build_object('label', 'Embroidery (' || p_embroidery || ')', 'amount', p_embroidery_cost),
           jsonb_build_object('label', 'Delivery', 'amount', p_delivery))
$$;

-- ---- New orders ----
-- Gives the order its number, checks the fabric and the price, and — when a
-- customer places it — works out every price from the database (fabric from
-- the fabric, the rest from the price list) and makes sure it starts unpaid
-- at "tailor assigned". Tailors are assigned automatically: the least busy
-- person in each role.
create or replace function public.wv_orders_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team       boolean := public.wv_is_team();
  v_fabric     public.fabrics%rowtype;
  v_cost       numeric;
  v_embroidery text := coalesce(nullif(trim(new.embroidery), ''), 'None');
  v_tailoring  numeric;
  v_emb_cost   numeric;
  v_delivery   numeric;
  v_total      numeric;
  v_role       text;
  v_pick       text;
begin
  if new.designer_id is null then
    new.designer_id := public.wv_main_designer_id();
  end if;
  if new.order_number is null or new.order_number = '' or not v_team then
    new.order_number := 'NT-' || nextval('public.wearvia_order_number_seq');
  end if;

  if new.fabric_id is not null then
    select * into v_fabric from public.fabrics where id = new.fabric_id;
    if not found then
      raise exception 'That fabric is no longer available.';
    end if;
    new.fabric_supplier_id := v_fabric.supplier_id;
    if not v_team then
      if v_fabric.deleted_at is not null or v_fabric.status <> 'approved' or v_fabric.sold_out then
        raise exception '% is no longer available. Please choose another fabric.', v_fabric.name;
      end if;
      if coalesce(new.fabric_yards, 0) < coalesce(v_fabric.min_order_yards, 0) then
        raise exception 'The smallest order for % is % yd.', v_fabric.name, v_fabric.min_order_yards;
      end if;
    end if;
    v_cost := round(coalesce(new.fabric_yards, 0) * v_fabric.price_per_yard, 2);
    if not v_team and abs(coalesce(new.fabric_cost, 0) - v_cost) > 0.01 then
      raise exception 'The price of % has changed. Please check your quote and try again.', v_fabric.name;
    end if;
    new.fabric_cost := v_cost;
  elsif not v_team then
    raise exception 'Please choose a fabric for your order.';
  end if;

  -- Tailoring, embroidery and delivery from the price list
  select p.price into v_tailoring from public.price_list p where p.kind = 'outfit' and p.name = new.outfit_type;
  select p.price into v_emb_cost from public.price_list p where p.kind = 'embroidery' and p.name = v_embroidery;
  select p.price into v_delivery from public.price_list p where p.kind = 'delivery' order by p.sort_order, p.name limit 1;

  if v_team then
    -- The team can set their own prices on walk-in orders; anything left out comes from the price list
    new.tailoring_cost := coalesce(new.tailoring_cost, v_tailoring, 0);
    new.embroidery_cost := coalesce(new.embroidery_cost, v_emb_cost, 0);
    new.delivery_cost := coalesce(new.delivery_cost, v_delivery, 0);
  else
    -- A customer's browser can't choose the price: what it sent is ignored
    if v_tailoring is null then
      raise exception 'Sorry, we can''t take orders for "%" at the moment. Please choose another outfit.', coalesce(new.outfit_type, '');
    end if;
    if v_emb_cost is null then
      raise exception 'Sorry, "%" embroidery isn''t available. Please choose another.', v_embroidery;
    end if;
    if v_delivery is null then
      raise exception 'Sorry, we can''t take orders right now (no delivery price is set). Please contact Nebeda Threads.';
    end if;
    new.embroidery := v_embroidery;
    new.tailoring_cost := v_tailoring;
    new.embroidery_cost := v_emb_cost;
    new.delivery_cost := v_delivery;
    v_total := new.fabric_cost + v_tailoring + v_emb_cost + v_delivery;
    -- The customer must have been shown this total; if a price changed since, they see the new quote first
    if new.quote_total is null or abs(new.quote_total - v_total) > 0.01 then
      raise exception 'Our prices have changed since your quote. Please check the new total and try again.';
    end if;
    new.line_items := public.wv_quote_lines(v_fabric.name, new.fabric_yards, v_fabric.price_per_yard, new.fabric_cost,
                                            new.outfit_type, v_tailoring, v_embroidery, v_emb_cost, v_delivery);
  end if;

  new.quote_total := coalesce(new.fabric_cost, 0) + coalesce(new.tailoring_cost, 0)
                   + coalesce(new.embroidery_cost, 0) + coalesce(new.delivery_cost, 0);

  if v_team then
    new.deposit_amount := least(coalesce(new.deposit_amount, round(new.quote_total * 0.6)), new.quote_total);
    if new.stage is null then new.stage := 'tailor_assigned'; end if;
  else
    -- A customer's browser can't choose how far along the order is, or that it's paid
    new.deposit_amount := round(new.quote_total * 0.6);
    new.stage := 'tailor_assigned';
    new.review_rating := null;
    new.review_text := null;
    new.wedding_order_id := null;
    new.assigned_cutting := null;
    new.assigned_sewing := null;
    new.assigned_embroidery := null;
    new.assigned_finishing := null;
    new.assigned_quality_control := null;
  end if;
  -- Paid dates are only ever set from confirmed payments
  new.deposit_paid_at := null;
  new.balance_paid_at := null;

  foreach v_role in array array['cutting', 'sewing', 'embroidery', 'finishing', 'quality_control'] loop
    v_pick := case v_role
      when 'cutting' then new.assigned_cutting
      when 'sewing' then new.assigned_sewing
      when 'embroidery' then new.assigned_embroidery
      when 'finishing' then new.assigned_finishing
      else new.assigned_quality_control end;
    if coalesce(v_pick, '') = '' then
      select t.id::text into v_pick
      from public.tailors t
      where t.designer_id = new.designer_id and t.role = v_role and t.active
      order by (
        select count(*) from public.orders o
        where o.stage::text <> 'delivered'
          and t.id::text = case v_role
            when 'cutting' then o.assigned_cutting
            when 'sewing' then o.assigned_sewing
            when 'embroidery' then o.assigned_embroidery
            when 'finishing' then o.assigned_finishing
            else o.assigned_quality_control end
      ), t.created_at
      limit 1;
      case v_role
        when 'cutting' then new.assigned_cutting := v_pick;
        when 'sewing' then new.assigned_sewing := v_pick;
        when 'embroidery' then new.assigned_embroidery := v_pick;
        when 'finishing' then new.assigned_finishing := v_pick;
        else new.assigned_quality_control := v_pick;
      end case;
    end if;
  end loop;

  new.created_at := coalesce(new.created_at, now());
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists wv_orders_before_insert on public.orders;
create trigger wv_orders_before_insert before insert on public.orders
  for each row execute function public.wv_orders_before_insert();

-- Internal helpers are not for calling from the app
revoke execute on function public.wv_price_list_before_update() from public, anon, authenticated;
revoke execute on function public.wv_quote_lines(text, numeric, numeric, numeric, text, numeric, text, numeric, numeric)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Remove the old metre functions
-- ---------------------------------------------------------------------
-- The app only calls wearvia_bootstrap, wearvia_add_team_member and
-- wearvia_team_logins, so nothing in it uses these. A function is kept
-- (and named in the report) if a trigger, a security rule, a view or
-- another function still uses it, or if it's one of Wearvia's own
-- (wv_… / wearvia_…) — those need a person to look at them.

do $$
declare
  r         record;
  v_dropped text[] := '{}';
  v_kept    text[] := '{}';
begin
  for r in
    select p.oid, p.oid::regprocedure::text as signature, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.prosrc ilike '%metre%' or p.proname in ('buy_fabric', 'return_fabric'))
      -- not part of an installed extension
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    order by p.proname
  loop
    if r.proname like 'wv\_%' or r.proname like 'wearvia\_%' then
      v_kept := v_kept || (r.signature || ' — a Wearvia function');
    elsif exists (select 1 from pg_trigger t where t.tgfoid = r.oid) then
      v_kept := v_kept || (r.signature || ' — a trigger uses it');
    elsif exists (select 1 from pg_proc o join pg_namespace s on s.oid = o.pronamespace
                  where s.nspname = 'public' and o.oid <> r.oid
                    and o.prosrc ~* ('\m' || r.proname || '\M')
                    and not (o.prosrc ilike '%metre%' or o.proname in ('buy_fabric', 'return_fabric'))) then
      v_kept := v_kept || (r.signature || ' — another function calls it');
    else
      begin
        execute format('drop function %s', r.signature);
        v_dropped := v_dropped || r.signature;
      exception when dependent_objects_still_exist then
        v_kept := v_kept || (r.signature || ' — a security rule or view uses it');
      end;
    end if;
  end loop;

  raise notice 'Removed: %', coalesce(nullif(array_to_string(v_dropped, ', '), ''), 'nothing (already removed)');
  if array_length(v_kept, 1) is not null then
    raise notice 'Kept (look at these): %', array_to_string(v_kept, '; ');
  end if;
end $$;

commit;

-- Tell the Supabase API about the new table straight away
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 4. Report — every line should say "OK" except the last, which shows
--    the prices now in the database.
-- ---------------------------------------------------------------------
select check_name, result from (
  select 1 as n, 'Price list is filled in' as check_name,
         case when (select count(*) from public.price_list where kind = 'outfit') >= 10
               and (select count(*) from public.price_list where kind = 'embroidery') >= 3
               and exists (select 1 from public.price_list where kind = 'delivery')
              then 'OK' else 'MISSING — tell your developer' end as result
  union all
  select 2, 'Only the Nebeda Threads team can change prices',
         case when (select relrowsecurity from pg_class where oid = 'public.price_list'::regclass)
               and not has_table_privilege('anon', 'public.price_list', 'insert, update, delete')
               and not has_table_privilege('authenticated', 'public.price_list', 'insert, delete')
               and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'price_list'
                           and cmd = 'UPDATE' and qual ilike '%wv_is_team%')
              then 'OK' else 'NOT LOCKED — tell your developer' end
  union all
  select 3, 'New orders are priced by the database',
         case when (select prosrc from pg_proc where oid = 'public.wv_orders_before_insert()'::regprocedure) ilike '%price_list%'
               and exists (select 1 from pg_trigger where tgname = 'wv_orders_before_insert'
                           and tgrelid = 'public.orders'::regclass and tgenabled <> 'D')
              then 'OK' else 'NOT SWITCHED ON — tell your developer' end
  union all
  select 4, 'No functions still using metres',
         coalesce('Still there: ' || (select string_agg(p.proname, ', ' order by p.proname)
                                      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                      where s.nspname = 'public'
                                        and (p.prosrc ilike '%metre%' or p.proname in ('buy_fabric', 'return_fabric'))),
                  'OK')
  union all
  select 5, 'Money on existing orders, invoices and payments unchanged',
         case when not exists (
                select kind, id, money from wv_money_before
                except
                (select 'order', id, md5(row(fabric_cost, tailoring_cost, embroidery_cost, delivery_cost,
                                            quote_total, deposit_amount, line_items)::text) from public.orders
                 union all
                 select 'invoice', id, md5(row(total, line_items)::text) from public.invoices
                 union all
                 select 'payment', id, md5(row(amount, status)::text) from public.payments))
              then 'OK (' || (select count(*) from wv_money_before where kind = 'order') || ' orders checked)'
              else 'CHANGED — tell your developer' end
  union all
  select 6, 'Prices now',
         (select string_agg(name || ' ' || public.wv_money_text(price)
                            || case when yards is not null then ' (' || trim_scale(yards) || ' yd)' else '' end,
                            ' · ' order by case kind when 'outfit' then 1 when 'embroidery' then 2 else 3 end, sort_order)
          from public.price_list)
) report
order by n;
