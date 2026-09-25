-- =====================================================================
-- Wearvia — switch fabric from metres to yards
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it once, just before the app update that uses yards goes live.
--
-- Already run on the live database: don't run it again. (If you ever do,
-- run prices.sql straight afterwards — this file puts back an older
-- version of the "new order" trigger that doesn't use the price list.)
--
-- What it does:
--   1. Renames the fabric columns to yards and converts what's in them
--        fabrics.price_per_metre         → price_per_yard   (× 0.9144, to the penny)
--        fabrics.metres_available        → yards_available  (× 1.0936, rounded DOWN to 0.1 yd
--                                                             so you never sell fabric you don't have)
--        fabrics.min_order_metres        → min_order_yards  (× 1.0936, to the nearest 0.5 yd)
--        orders.fabric_metres            → fabric_yards     (× 1.0936, to 0.01 yd)
--        fabric_order_lines.metres       → yards            (× 1.0936, to 0.01 yd)
--        fabric_order_lines.price_per_metre → price_per_yard (what was charged ÷ yards,
--                                                             so the line still adds up)
--   2. Rewrites the fabric line on existing quotes and invoices, e.g.
--        "Fabric — Aso Oke (8 m × £25)"  →  "Fabric — Aso Oke (8.75 yd × £22.86)"
--      The amounts are not touched: fabric cost, totals, deposits and
--      payments on existing orders stay exactly as they were.
--   3. Updates the triggers and functions that use these columns
--      (placing an order, taking fabric out of stock, the seller's order
--      line, putting fabric back when an order is deleted) and the stock rule.
--   4. Shows a short report at the end.
--
-- Safe to run more than once: a column is only converted while it still
-- has its metre name, and renaming and converting happen together, so
-- nothing is ever converted twice. Nothing is deleted. Everything runs in
-- one transaction: if any step fails, nothing is changed.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Helpers for this run only (pg_temp: they disappear afterwards)
-- ---------------------------------------------------------------------

create or replace function pg_temp.wv_has_column(p_table text, p_column text) returns boolean
language sql stable as $$
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = p_table and column_name = p_column)
$$;

-- Switches off a table's own triggers while old rows are converted (so
-- nothing is re-priced, re-timestamped or blocked) and returns their names
create or replace function pg_temp.wv_pause_triggers(p_table text) returns text[]
language plpgsql as $$
declare
  v_names text[];
  v_name  text;
begin
  select coalesce(array_agg(t.tgname), '{}') into v_names
  from pg_trigger t
  where t.tgrelid = ('public.' || p_table)::regclass and not t.tgisinternal and t.tgenabled <> 'D';
  foreach v_name in array v_names loop
    execute format('alter table public.%I disable trigger %I', p_table, v_name);
  end loop;
  return v_names;
end $$;

-- Switches the same triggers back on
create or replace function pg_temp.wv_resume_triggers(p_table text, p_names text[]) returns void
language plpgsql as $$
declare
  v_name text;
begin
  foreach v_name in array p_names loop
    execute format('alter table public.%I enable trigger %I', p_table, v_name);
  end loop;
end $$;

-- "Fabric — Aso Oke (8 m × £25)" with amount 200 → "Fabric — Aso Oke (8.75 yd × £22.86)".
-- Labels already in yards (or any other label) come back unchanged.
create or replace function pg_temp.wv_yard_label(p_label text, p_amount numeric) returns text
language plpgsql immutable as $$
declare
  v_parts text[] := regexp_match(p_label, '\(([0-9]+(\.[0-9]+)?) m × ([^0-9]*)([0-9,]+(\.[0-9]+)?)\)$');
  v_yards numeric;
  v_price numeric;
begin
  if v_parts is null then
    return p_label;
  end if;
  v_yards := trim_scale(round(v_parts[1]::numeric * 1.0936, 2));
  v_price := case when v_yards > 0 and p_amount is not null then round(p_amount / v_yards, 2)
                  else round(replace(v_parts[4], ',', '')::numeric * 0.9144, 2) end;
  return regexp_replace(p_label, '\([0-9]+(\.[0-9]+)? m × [^0-9]*[0-9,]+(\.[0-9]+)?\)$', '')
      || '(' || v_yards || ' yd × ' || v_parts[3]
      || case when v_price = trunc(v_price) then to_char(v_price, 'FM999,999,990')
              else to_char(v_price, 'FM999,999,990.00') end
      || ')';
end $$;

-- Applies wv_yard_label to every line of an itemised quote
create or replace function pg_temp.wv_yard_lines(p_lines jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(p_lines) = 'array' then
    coalesce((
      select jsonb_agg(
        case when jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'label') = 'string'
             then jsonb_set(e, '{label}', to_jsonb(pg_temp.wv_yard_label(
                    e ->> 'label',
                    case when jsonb_typeof(e -> 'amount') = 'number' then (e ->> 'amount')::numeric end)))
             else e end
        order by i)
      from jsonb_array_elements(p_lines) with ordinality as t(e, i)), '[]'::jsonb)
  else p_lines end
$$;


-- ---------------------------------------------------------------------
-- 1 & 2. Rename the columns and convert the data
-- ---------------------------------------------------------------------

do $$
declare
  v_paused text[];
  v_done   text[] := '{}';
  v_pair   text[];
begin
  -- Stop if a column exists under both names: that needs a person to look at it
  foreach v_pair slice 1 in array array[
    ['fabrics', 'price_per_metre', 'price_per_yard'],
    ['fabrics', 'metres_available', 'yards_available'],
    ['fabrics', 'min_order_metres', 'min_order_yards'],
    ['orders', 'fabric_metres', 'fabric_yards'],
    ['fabric_order_lines', 'metres', 'yards'],
    ['fabric_order_lines', 'price_per_metre', 'price_per_yard']]
  loop
    if pg_temp.wv_has_column(v_pair[1], v_pair[2]) and pg_temp.wv_has_column(v_pair[1], v_pair[3]) then
      raise exception 'public.% has both % and %. Nothing was changed. Check which one holds the real data before running this again.',
        v_pair[1], v_pair[2], v_pair[3];
    end if;
  end loop;

  -- ---- Fabrics ----
  v_paused := pg_temp.wv_pause_triggers('fabrics');
  if pg_temp.wv_has_column('fabrics', 'price_per_metre') then
    alter table public.fabrics rename column price_per_metre to price_per_yard;
    update public.fabrics set price_per_yard = round(price_per_yard * 0.9144, 2) where price_per_yard is not null;
    v_done := v_done || 'fabrics.price_per_yard'::text;
  end if;
  if pg_temp.wv_has_column('fabrics', 'metres_available') then
    alter table public.fabrics rename column metres_available to yards_available;
    update public.fabrics set yards_available = trunc(yards_available * 1.0936, 1) where yards_available is not null;
    v_done := v_done || 'fabrics.yards_available'::text;
  end if;
  if pg_temp.wv_has_column('fabrics', 'min_order_metres') then
    alter table public.fabrics rename column min_order_metres to min_order_yards;
    update public.fabrics set min_order_yards = trim_scale(greatest(0.5, round(min_order_yards * 1.0936 * 2) / 2))
    where min_order_yards is not null;
    v_done := v_done || 'fabrics.min_order_yards'::text;
  end if;
  perform pg_temp.wv_resume_triggers('fabrics', v_paused);

  -- ---- Orders: yards bought, and the fabric line on the quote ----
  v_paused := pg_temp.wv_pause_triggers('orders');
  if pg_temp.wv_has_column('orders', 'fabric_metres') then
    alter table public.orders rename column fabric_metres to fabric_yards;
    update public.orders set fabric_yards = round(fabric_yards * 1.0936, 2) where fabric_yards is not null;
    v_done := v_done || 'orders.fabric_yards'::text;
  end if;
  if pg_temp.wv_has_column('orders', 'line_items') then
    update public.orders set line_items = pg_temp.wv_yard_lines(line_items)
    where line_items is not null and line_items::text like '% m × %';
  end if;
  perform pg_temp.wv_resume_triggers('orders', v_paused);

  -- ---- Invoices: the same fabric line ----
  v_paused := pg_temp.wv_pause_triggers('invoices');
  update public.invoices set line_items = pg_temp.wv_yard_lines(line_items)
  where line_items is not null and line_items::text like '% m × %';
  perform pg_temp.wv_resume_triggers('invoices', v_paused);

  -- ---- What each fabric seller has to send ----
  if to_regclass('public.fabric_order_lines') is not null then
    v_paused := pg_temp.wv_pause_triggers('fabric_order_lines');
    if pg_temp.wv_has_column('fabric_order_lines', 'metres') then
      alter table public.fabric_order_lines rename column metres to yards;
      alter table public.fabric_order_lines alter column yards type numeric(8, 2);
      update public.fabric_order_lines set yards = round(yards * 1.0936, 2) where yards is not null;
      v_done := v_done || 'fabric_order_lines.yards'::text;
    end if;
    if pg_temp.wv_has_column('fabric_order_lines', 'price_per_metre') then
      alter table public.fabric_order_lines rename column price_per_metre to price_per_yard;
      update public.fabric_order_lines
         set price_per_yard = case when yards > 0 and total is not null then round(total / yards, 2)
                                   else round(price_per_yard * 0.9144, 2) end
       where price_per_yard is not null;
      v_done := v_done || 'fabric_order_lines.price_per_yard'::text;
    end if;
    perform pg_temp.wv_resume_triggers('fabric_order_lines', v_paused);
  end if;

  if array_length(v_done, 1) is null then
    raise notice 'Already in yards — no data was converted this time.';
  else
    raise notice 'Converted to yards: %', array_to_string(v_done, ', ');
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Triggers, functions and rules that use the fabric columns
-- ---------------------------------------------------------------------
-- (The same functions are in setup.sql, so running setup.sql again later
-- keeps them in yards.)

-- Stock can't go below zero
alter table public.fabrics drop constraint if exists fabrics_stock_check_wv;
alter table public.fabrics add constraint fabrics_stock_check_wv check (yards_available >= 0) not valid;

-- ---- New orders ----
-- Gives the order its number, checks the fabric and the price, and — when a
-- customer places it — makes sure it starts unpaid at "tailor assigned".
-- Tailors are assigned automatically: the least busy person in each role.
create or replace function public.wv_orders_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team   boolean := public.wv_is_team();
  v_fabric public.fabrics%rowtype;
  v_cost   numeric;
  v_role   text;
  v_pick   text;
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

-- After an order is placed: take the fabric out of stock, tell the seller, make the invoice
create or replace function public.wv_orders_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_fabric   public.fabrics%rowtype;
  v_first    text;
  v_deliver  text;
begin
  if new.fabric_id is not null and coalesce(new.fabric_yards, 0) > 0 then
    update public.fabrics
       set yards_available = round(yards_available - new.fabric_yards, 1)
     where id = new.fabric_id and yards_available >= new.fabric_yards
    returning * into v_fabric;
    if not found then
      raise exception 'There isn''t enough of that fabric left in stock.';
    end if;

  end if;
  if v_fabric.supplier_id is not null then
    select split_part(trim(c.name), ' ', 1) into v_first from public.customers c where c.id = new.customer_id;
    select d.business_name || coalesce(', ' || d.location, '') into v_deliver from public.designers d where d.id = new.designer_id;
    insert into public.fabric_order_lines
      (order_id, order_number, supplier_id, fabric_id, fabric_name, yards, price_per_yard, total,
       customer_first_name, deliver_to, created_at)
    values
      (new.id, new.order_number, v_fabric.supplier_id, v_fabric.id, v_fabric.name, new.fabric_yards,
       v_fabric.price_per_yard, new.fabric_cost, coalesce(v_first, ''), coalesce(v_deliver, ''), new.created_at);
  end if;

  insert into public.invoices (order_id, line_items, total, invoice_number, created_at)
  values (new.id, new.line_items, new.quote_total,
          'INV-' || regexp_replace(new.order_number, '^[^0-9]*', ''), new.created_at);
  return null;
end $$;

-- Before an order is deleted by the team: fabric goes back into stock, the
-- seller sees the line as cancelled, and the order's records are removed
create or replace function public.wv_orders_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.fabric_id is not null and coalesce(old.fabric_yards, 0) > 0 then
    update public.fabrics set yards_available = round(yards_available + old.fabric_yards, 1)
    where id = old.fabric_id;
  end if;
  update public.fabric_order_lines set status = 'cancelled' where order_id = old.id and status <> 'cancelled';
  delete from public.invoices where order_id = old.id;
  delete from public.deliveries where order_id = old.id;
  delete from public.order_events where order_id = old.id;
  delete from public.reviews where order_id = old.id;
  return old;
end $$;

-- Attach them (dropped first so this file can run again)
drop trigger if exists wv_orders_before_insert on public.orders;
create trigger wv_orders_before_insert before insert on public.orders
  for each row execute function public.wv_orders_before_insert();
drop trigger if exists wv_orders_after_insert on public.orders;
create trigger wv_orders_after_insert after insert on public.orders
  for each row execute function public.wv_orders_after_insert();
drop trigger if exists wv_orders_before_delete on public.orders;
create trigger wv_orders_before_delete before delete on public.orders
  for each row execute function public.wv_orders_before_delete();

-- Security rules (Row Level Security): none of them mention the fabric
-- columns — who can read or change fabrics, orders and seller order lines
-- is decided by who owns them, not by amounts — so they carry on unchanged.
-- The report below double-checks that nothing still uses a metre name.

commit;

-- Tell the Supabase API about the new column names straight away
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 4. Report — lines 1 to 6 should say "OK". Line 7 lists any fabric
--    descriptions a seller wrote in metres (the script never changes a
--    seller's own words), and line 8 shows a few fabrics so you can see the new prices.
-- ---------------------------------------------------------------------
select check_name, result from (
  select 1 as n, 'Fabric columns are in yards' as check_name,
         case when (select count(*) from information_schema.columns
                    where table_schema = 'public' and table_name = 'fabrics'
                      and column_name in ('price_per_yard', 'yards_available', 'min_order_yards')) = 3
              then 'OK' else 'MISSING — tell your developer' end as result
  union all
  select 2, 'Order columns are in yards',
         case when (select count(*) from information_schema.columns
                    where table_schema = 'public'
                      and ((table_name = 'orders' and column_name = 'fabric_yards')
                        or (table_name = 'fabric_order_lines' and column_name in ('yards', 'price_per_yard')))) = 3
              then 'OK' else 'MISSING — tell your developer' end
  union all
  select 3, 'No columns still named in metres',
         coalesce('Still in metres: ' || (select string_agg(table_name || '.' || column_name, ', ')
                                          from information_schema.columns
                                          where table_schema = 'public' and column_name ilike '%metre%'), 'OK')
  union all
  select 4, 'No functions still using metres',
         coalesce('Still mention metres: ' || (select string_agg(p.proname, ', ')
                                               from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                               where s.nspname = 'public' and p.prosrc ilike '%metre%'), 'OK')
  union all
  select 5, 'No security rules or views using metres',
         coalesce('Still mention metres: ' || (select string_agg(x, ', ') from (
                    select tablename || ' / ' || policyname as x from pg_policies
                    where schemaname = 'public' and (qual ilike '%metre%' or with_check ilike '%metre%')
                    union all
                    select viewname from pg_views where schemaname = 'public' and definition ilike '%metre%') y), 'OK')
  union all
  select 6, 'Quotes and invoices say yd',
         case when exists (select 1 from public.orders where line_items::text like '% m × %')
                or exists (select 1 from public.invoices where line_items::text like '% m × %')
              then 'Some still say m — tell your developer' else 'OK' end
  union all
  select 7, 'Fabric descriptions (written by sellers) that mention metres',
         coalesce('Edit these by hand: ' || (select string_agg(name, ', ' order by name) from public.fabrics
                                             where deleted_at is null and description ~* 'metre|[0-9] ?m\M'), 'OK')
  union all
  select 8, 'Fabrics (for a quick look)',
         coalesce((select string_agg(name || ': £' || price_per_yard || '/yd, ' || yards_available || ' yd',
                                     ' · ' order by name)
                   from (select * from public.fabrics where deleted_at is null order by name limit 5) f), 'no fabrics yet')
) report
order by n;
