-- =====================================================================
-- Wearvia — the tailor decides the yards, and every order has a chat
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it after setup.sql and prices.sql, before the app update with
-- "Send to tailor", the order chat and Business → Quote requests goes live.
--
-- What it does:
--   1. Orders get a quote status:
--        requested  the customer sent their design, photos, measurements
--                   and chosen fabric to the tailor. No yards, no price,
--                   no stock taken yet.
--        quoted     the tailor entered the yards and pressed "Send quote".
--                   The database worked out the price.
--        accepted   the customer accepted the quote. Only now is the fabric
--                   taken out of stock, the seller's order line and the
--                   invoice made, and the 60% deposit can be paid.
--      Every order already in the database is "accepted", so it carries on
--      exactly as before. Walk-in orders taken by the team are "accepted"
--      straight away, with the yards the team typed in.
--   2. An in-app chat on every order (text and photos) between the customer
--      and the Nebeda Threads team, with "unread" tracking for both sides.
--      Chat photos go in a new private bucket, "chat-photos".
--   3. Functions the app calls:
--        wearvia_send_quote    the team sends (or changes) a quote
--        wearvia_accept_quote  the customer accepts it
--        wearvia_mark_chat_read
--      The quote is always worked out here: yards × the fabric seller's
--      price per yard + tailoring + embroidery + delivery from the price list.
--   4. If the fabric sells out before the customer accepts, the customer is
--      told in the chat and the request goes back to the tailor, who can
--      send a new quote with another fabric.
--   5. Security: customers only see their own orders and chats; the team
--      sees all. Customers can never set yards or prices — the database
--      ignores anything a customer's browser sends for them.
--   6. Shows a short report at the end. Every line should say OK.
--
-- Safe to run more than once. Nothing is deleted, and the money on existing
-- orders, invoices and payments and the fabric stock are never touched
-- (the report checks this). Everything runs in one transaction: if any
-- step fails, nothing is changed.
--
-- If you ever run setup.sql or prices.sql again, run this file straight
-- after them: they put back the older "new order" rules.
-- =====================================================================

begin;

-- A copy of the money on every existing order, invoice and payment, and the
-- fabric stock, so the report at the end can show nothing changed
-- (temporary tables: they disappear when you close the SQL Editor tab)
drop table if exists pg_temp.wv_quote_money_before;
create temp table wv_quote_money_before as
  select 'order' as kind, id, md5(row(fabric_id, fabric_yards, fabric_cost, tailoring_cost, embroidery_cost, delivery_cost,
                                      quote_total, deposit_amount, line_items, deposit_paid_at, balance_paid_at, stage)::text) as money
  from public.orders
  union all
  select 'invoice', id, md5(row(total, line_items)::text) from public.invoices
  union all
  select 'payment', id, md5(row(amount, status)::text) from public.payments
  union all
  select 'fabric', id, md5(row(yards_available)::text) from public.fabrics;

-- Orders that existed before this file first ran (on a second run, the ones
-- that were already placed) — they must all be "accepted" at the end
drop table if exists pg_temp.wv_quote_orders_before;
create temp table wv_quote_orders_before as
  select id from public.orders o
  where not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'orders' and column_name = 'quote_status');
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'orders' and column_name = 'quote_status') then
    insert into wv_quote_orders_before select id from public.orders where quote_status = 'accepted';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. The quote status on orders
-- ---------------------------------------------------------------------

-- Existing orders get "accepted", which is what they are
alter table public.orders add column if not exists quote_status   text not null default 'accepted';
alter table public.orders add column if not exists quoted_at      timestamptz;
alter table public.orders add column if not exists quoted_by      uuid;
alter table public.orders add column if not exists accepted_at    timestamptz;
alter table public.orders add column if not exists fabric_problem text;   -- set when the chosen fabric sold out before the customer accepted

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_quote_status_check_wv') then
    alter table public.orders add constraint orders_quote_status_check_wv
      check (quote_status in ('requested', 'quoted', 'accepted'));
  end if;
end $$;

-- A request has no yards or prices until the tailor sends the quote
alter table public.orders alter column fabric_yards    drop not null;
alter table public.orders alter column fabric_cost     drop not null;
alter table public.orders alter column tailoring_cost  drop not null;
alter table public.orders alter column embroidery_cost drop not null;
alter table public.orders alter column delivery_cost   drop not null;
alter table public.orders alter column quote_total     drop not null;
alter table public.orders alter column deposit_amount  drop not null;

create index if not exists orders_quote_open_idx_wv on public.orders (quote_status) where quote_status <> 'accepted';
create index if not exists orders_fabric_idx_wv on public.orders (fabric_id);


-- ---------------------------------------------------------------------
-- 2. The chat
-- ---------------------------------------------------------------------

create table if not exists public.order_messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  sender_kind text not null default 'customer' check (sender_kind in ('customer', 'team', 'system')),
  sender_id   uuid default auth.uid(),
  sender_name text not null default '',
  body        text not null default '' check (char_length(body) <= 2000),
  photos      text[] not null default '{}' check (cardinality(photos) <= 5),   -- paths in the chat-photos bucket
  created_at  timestamptz not null default now()
);
create index if not exists order_messages_order_idx on public.order_messages (order_id, created_at);
create index if not exists order_messages_photos_idx on public.order_messages using gin (photos);

-- When each side last read an order's chat (for the unread badges)
create table if not exists public.order_chat_reads (
  order_id     uuid not null references public.orders (id) on delete cascade,
  side         text not null check (side in ('customer', 'team')),
  last_read_at timestamptz not null default now(),
  primary key (order_id, side)
);


-- ---------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------

-- The name shown on a chat message: "Ben at Nebeda Threads", or the customer's name
create or replace function public.wv_chat_name(p_team boolean) returns text
language sql stable security definer set search_path = public as $$
  select case when p_team then
      coalesce(nullif(split_part(trim((select p.full_name from public.profiles p where p.id = auth.uid())), ' ', 1), '') || ' at ', '')
      || coalesce((select d.business_name from public.designers d where d.id = public.wv_main_designer_id()), 'Nebeda Threads')
    else
      coalesce((select c.name from public.customers c where c.auth_user_id = auth.uid() order by c.created_at limit 1), 'Customer')
    end
$$;

-- A message from Wearvia itself (quote sent, fabric sold out …)
create or replace function public.wv_post_system_message(p_order_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.order_messages (order_id, sender_kind, sender_id, sender_name, body)
  values (p_order_id, 'system', null, 'Wearvia', left(p_body, 2000));
end $$;

-- True when this fabric can be sold in this amount
create or replace function public.wv_fabric_can_sell(f public.fabrics, p_yards numeric) returns boolean
language sql immutable set search_path = public as $$
  select f.id is not null and f.deleted_at is null and f.status = 'approved' and not coalesce(f.sold_out, false)
     and coalesce(f.yards_available, 0) >= greatest(coalesce(p_yards, 0), coalesce(f.min_order_yards, 0), 0.01)
$$;

-- The least busy active tailor in a role (only orders being made count)
create or replace function public.wv_pick_tailor(p_designer_id uuid, p_role text) returns text
language sql stable security definer set search_path = public as $$
  select t.id::text
  from public.tailors t
  where t.designer_id = p_designer_id and t.role = p_role and t.active
  order by (
    select count(*) from public.orders o
    where o.stage::text <> 'delivered' and o.quote_status = 'accepted'
      and t.id::text = case p_role
        when 'cutting' then o.assigned_cutting
        when 'sewing' then o.assigned_sewing
        when 'embroidery' then o.assigned_embroidery
        when 'finishing' then o.assigned_finishing
        else o.assigned_quality_control end
  ), t.created_at
  limit 1
$$;

-- Once an order is accepted (or a walk-in order is taken): take the fabric
-- out of stock, tell the seller, make the invoice
create or replace function public.wv_order_take_fabric(o public.orders) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fabric  public.fabrics%rowtype;
  v_first   text;
  v_deliver text;
begin
  if o.fabric_id is not null and coalesce(o.fabric_yards, 0) > 0 then
    update public.fabrics
       set yards_available = round(yards_available - o.fabric_yards, 2)
     where id = o.fabric_id and yards_available >= o.fabric_yards
    returning * into v_fabric;
    if not found then
      raise exception 'There isn''t enough of that fabric left in stock.';
    end if;
  end if;
  if v_fabric.supplier_id is not null
     and not exists (select 1 from public.fabric_order_lines l where l.order_id = o.id and l.status <> 'cancelled') then
    select split_part(trim(c.name), ' ', 1) into v_first from public.customers c where c.id = o.customer_id;
    select d.business_name || coalesce(', ' || d.location, '') into v_deliver from public.designers d where d.id = o.designer_id;
    insert into public.fabric_order_lines
      (order_id, order_number, supplier_id, fabric_id, fabric_name, yards, price_per_yard, total,
       customer_first_name, deliver_to, created_at)
    values
      (o.id, o.order_number, v_fabric.supplier_id, v_fabric.id, v_fabric.name, o.fabric_yards,
       v_fabric.price_per_yard, o.fabric_cost, coalesce(v_first, ''), coalesce(v_deliver, ''), now());
  end if;

  if not exists (select 1 from public.invoices i where i.order_id = o.id) then
    insert into public.invoices (order_id, line_items, total, invoice_number, created_at)
    values (o.id, o.line_items, o.quote_total,
            'INV-' || regexp_replace(o.order_number, '^[^0-9]*', ''), now());
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4. Orders
-- ---------------------------------------------------------------------

-- ---- New orders ----
-- A customer's order is a request for a quote: the database keeps their
-- design and chosen fabric, and ignores any yards or prices their browser
-- sent. The team's walk-in orders are priced as before (their yards, and the
-- price list unless they typed their own price) and are accepted straight away.
create or replace function public.wv_orders_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team       boolean := public.wv_is_team();
  v_fabric     public.fabrics%rowtype;
  v_embroidery text := coalesce(nullif(trim(new.embroidery), ''), 'None');
  v_tailoring  numeric;
  v_emb_cost   numeric;
  v_delivery   numeric;
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
  end if;

  select p.price into v_tailoring from public.price_list p where p.kind = 'outfit' and p.name = new.outfit_type;
  select p.price into v_emb_cost from public.price_list p where p.kind = 'embroidery' and p.name = v_embroidery;
  select p.price into v_delivery from public.price_list p where p.kind = 'delivery' order by p.sort_order, p.name limit 1;

  -- Paid dates are only ever set from confirmed payments
  new.deposit_paid_at := null;
  new.balance_paid_at := null;
  new.quoted_at := null;
  new.quoted_by := null;
  new.fabric_problem := null;

  if not v_team then
    -- ---- A customer sends their order to the tailor ----
    if new.fabric_id is null then
      raise exception 'Please choose a fabric for your order.';
    end if;
    if not public.wv_fabric_can_sell(v_fabric, null) then
      raise exception '% is no longer available. Please choose another fabric.', v_fabric.name;
    end if;
    -- The quote is worked out from the price list later, so it must have these
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
    new.quote_status := 'requested';
    new.accepted_at := null;
    -- Yards and prices are decided by the tailor: whatever the browser sent is ignored
    new.fabric_yards := null;
    new.fabric_cost := null;
    new.tailoring_cost := null;
    new.embroidery_cost := null;
    new.delivery_cost := null;
    new.quote_total := null;
    new.deposit_amount := null;
    new.line_items := null;
    -- A customer's browser can't choose how far along the order is
    new.stage := 'tailor_assigned';
    new.review_rating := null;
    new.review_text := null;
    new.wedding_order_id := null;
    new.assigned_cutting := null;
    new.assigned_sewing := null;
    new.assigned_embroidery := null;
    new.assigned_finishing := null;
    new.assigned_quality_control := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- ---- The team takes a walk-in order: yards entered directly ----
  new.quote_status := 'accepted';
  new.accepted_at := now();
  if new.fabric_id is not null then
    new.fabric_cost := round(coalesce(new.fabric_yards, 0) * v_fabric.price_per_yard, 2);
  end if;
  -- The team can set their own prices on walk-in orders; anything left out comes from the price list
  new.tailoring_cost := coalesce(new.tailoring_cost, v_tailoring, 0);
  new.embroidery_cost := coalesce(new.embroidery_cost, v_emb_cost, 0);
  new.delivery_cost := coalesce(new.delivery_cost, v_delivery, 0);
  new.quote_total := coalesce(new.fabric_cost, 0) + new.tailoring_cost + new.embroidery_cost + new.delivery_cost;
  new.deposit_amount := least(coalesce(new.deposit_amount, round(new.quote_total * 0.6)), new.quote_total);
  if new.stage is null then new.stage := 'tailor_assigned'; end if;

  -- Tailors are assigned automatically: the least busy person in each role
  foreach v_role in array array['cutting', 'sewing', 'embroidery', 'finishing', 'quality_control'] loop
    v_pick := case v_role
      when 'cutting' then new.assigned_cutting
      when 'sewing' then new.assigned_sewing
      when 'embroidery' then new.assigned_embroidery
      when 'finishing' then new.assigned_finishing
      else new.assigned_quality_control end;
    if coalesce(v_pick, '') = '' then
      v_pick := public.wv_pick_tailor(new.designer_id, v_role);
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

-- After an order is made: a walk-in order takes its fabric and gets its
-- invoice now; a customer's request gets a welcome message in its chat
create or replace function public.wv_orders_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quote_status = 'accepted' then
    perform public.wv_order_take_fabric(new);
  else
    perform public.wv_post_system_message(new.id,
      'Thanks — your request is with ' || coalesce((select business_name from public.designers where id = new.designer_id), 'Nebeda Threads')
      || '. We''ll look at your design, style photos and measurements, and chat with you here to agree how many yards of fabric you need. '
      || 'Then we''ll send your quote. Nothing is bought or charged until you accept it.');
  end if;
  return null;
end $$;

-- Before a stage change: nothing moves until the quote is accepted and the
-- deposit confirmed, and nothing passes "balance paid" until it's paid in full
create or replace function public.wv_orders_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_from integer := public.wv_stage_position(old.stage::text);
  v_to   integer := public.wv_stage_position(new.stage::text);
begin
  if new.stage is distinct from old.stage and new.quote_status <> 'accepted' then
    raise exception 'Order % is waiting for the customer to accept the quote.', new.order_number;
  end if;
  if new.stage is distinct from old.stage and v_to is not null then
    if v_to > 1 and new.deposit_paid_at is null then
      raise exception 'Order % can''t move on until its deposit is confirmed (Business → Payments).', new.order_number;
    end if;
    if v_to >= public.wv_stage_position('balance_paid') and (v_from is null or v_to > v_from)
       and public.wv_confirmed_paid(new.id) < new.quote_total - 0.005 then
      raise exception 'Order % can''t move on until the balance is paid and confirmed.', new.order_number;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Quotes are only sent and accepted through wearvia_send_quote and
-- wearvia_accept_quote. This rule runs as the person making the change (not
-- as the database owner), so it can tell a change made straight from the app
-- apart from one made by those two functions.
create or replace function public.wv_orders_guard_quote() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.quote_status is distinct from old.quote_status then
      raise exception 'Quotes are sent and accepted with the buttons in the app.';
    end if;
    if old.quote_status <> 'accepted' and (
         new.fabric_id is distinct from old.fabric_id or new.fabric_yards is distinct from old.fabric_yards
      or new.fabric_cost is distinct from old.fabric_cost or new.tailoring_cost is distinct from old.tailoring_cost
      or new.embroidery_cost is distinct from old.embroidery_cost or new.delivery_cost is distinct from old.delivery_cost
      or new.quote_total is distinct from old.quote_total or new.deposit_amount is distinct from old.deposit_amount
      or new.line_items is distinct from old.line_items or new.quoted_at is distinct from old.quoted_at
      or new.accepted_at is distinct from old.accepted_at or new.fabric_problem is distinct from old.fabric_problem) then
      raise exception 'The yards and prices on a quote are set with "Send quote".';
    end if;
  end if;
  return new;
end $$;

-- Before an order is deleted by the team: fabric goes back into stock (only
-- if it was taken — a request that was never accepted took none), the
-- seller sees the line as cancelled, and the order's records are removed
create or replace function public.wv_orders_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.quote_status = 'accepted' and old.fabric_id is not null and coalesce(old.fabric_yards, 0) > 0 then
    update public.fabrics set yards_available = round(yards_available + old.fabric_yards, 2)
    where id = old.fabric_id;
  end if;
  update public.fabric_order_lines set status = 'cancelled' where order_id = old.id and status <> 'cancelled';
  delete from public.invoices where order_id = old.id;
  delete from public.deliveries where order_id = old.id;
  delete from public.order_events where order_id = old.id;
  delete from public.reviews where order_id = old.id;
  return old;
end $$;

-- Payments: nobody pays before the quote is accepted. Otherwise as before:
-- a customer's payment always waits for confirmation; the team's own
-- entries (cash in the shop, confirmations) count straight away.
create or replace function public.wv_payments_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team boolean := public.wv_is_team();
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.orders o where o.id = new.order_id and o.quote_status <> 'accepted') then
      raise exception 'Please accept the quote before paying.';
    end if;
    new.created_by := auth.uid();
    if not v_team then
      new.status := 'awaiting_confirmation';
      new.paid_on := current_date;
    end if;
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
  elsif new.status <> 'confirmed' then
    new.confirmed_by := null;
    new.confirmed_at := null;
  end if;
  return new;
end $$;

-- If a fabric sells out (or is hidden or removed) while a customer is waiting
-- for a quote or deciding on one, tell them in the chat and send the request
-- back to the tailor to suggest another fabric
create or replace function public.wv_fabrics_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_text text;
begin
  for r in
    select o.id, o.quote_status, o.fabric_yards from public.orders o
    where o.fabric_id = new.id and o.quote_status in ('requested', 'quoted') and o.fabric_problem is null
  loop
    if public.wv_fabric_can_sell(old, r.fabric_yards) and not public.wv_fabric_can_sell(new, r.fabric_yards) then
      v_text := case
        when new.deleted_at is not null or new.status <> 'approved' then new.name || ' is no longer on sale'
        when new.sold_out or coalesce(new.yards_available, 0) < greatest(coalesce(new.min_order_yards, 0), 0.01) then new.name || ' has sold out'
        else 'Only ' || trim_scale(new.yards_available) || ' yd of ' || new.name || ' is left' end;
      update public.orders
         set fabric_problem = v_text,
             quote_status = 'requested',
             updated_at = now()
       where id = r.id;
      perform public.wv_post_system_message(r.id,
        'Sorry — ' || v_text || ', so ' || case when r.quote_status = 'quoted' then 'this quote can''t be accepted any more. ' else '' end
        || 'Nebeda Threads will suggest another fabric here in the chat and send you a new quote.');
    end if;
  end loop;
  return null;
end $$;

-- Chat messages: whoever sends one from the app, the database fills in who
-- they are. Customers write as "customer", the team as "team"; only the
-- database's own functions can write "system" messages. Photos must be the
-- sender's own uploads. (Runs as the person sending, like the quote rule above.)
create or replace function public.wv_order_messages_before_insert() returns trigger
language plpgsql set search_path = public as $$
declare
  v_team boolean;
  v_uid  uuid := auth.uid();
  v_path text;
begin
  new.created_at := now();
  new.body := trim(coalesce(new.body, ''));
  new.photos := coalesce(new.photos, '{}');
  if current_user in ('authenticated', 'anon') then
    v_team := public.wv_is_team();
    new.sender_id := v_uid;
    new.sender_kind := case when v_team then 'team' else 'customer' end;
    new.sender_name := public.wv_chat_name(v_team);
    foreach v_path in array new.photos loop
      if v_path is null or split_part(v_path, '/', 1) <> v_uid::text or v_path like '%..%' then
        raise exception 'That photo can''t be attached.';
      end if;
    end loop;
  end if;
  if new.body = '' and cardinality(new.photos) = 0 then
    raise exception 'Type a message or add a photo.';
  end if;
  return new;
end $$;

-- Attach the triggers (dropped first so this file can run again)
drop trigger if exists wv_orders_before_insert on public.orders;
create trigger wv_orders_before_insert before insert on public.orders
  for each row execute function public.wv_orders_before_insert();
drop trigger if exists wv_orders_after_insert on public.orders;
create trigger wv_orders_after_insert after insert on public.orders
  for each row execute function public.wv_orders_after_insert();
drop trigger if exists wv_orders_before_update on public.orders;
create trigger wv_orders_before_update before update on public.orders
  for each row execute function public.wv_orders_before_update();
drop trigger if exists wv_orders_guard_quote on public.orders;
create trigger wv_orders_guard_quote before update on public.orders
  for each row execute function public.wv_orders_guard_quote();
drop trigger if exists wv_orders_before_delete on public.orders;
create trigger wv_orders_before_delete before delete on public.orders
  for each row execute function public.wv_orders_before_delete();
drop trigger if exists wv_payments_before_write on public.payments;
create trigger wv_payments_before_write before insert or update on public.payments
  for each row execute function public.wv_payments_before_write();
drop trigger if exists wv_fabrics_after_update on public.fabrics;
create trigger wv_fabrics_after_update after update on public.fabrics
  for each row execute function public.wv_fabrics_after_update();
drop trigger if exists wv_order_messages_before_insert on public.order_messages;
create trigger wv_order_messages_before_insert before insert on public.order_messages
  for each row execute function public.wv_order_messages_before_insert();


-- ---------------------------------------------------------------------
-- 5. The functions the app calls
-- ---------------------------------------------------------------------

-- The team sends a quote (or a new one): the yards they agreed with the
-- customer, and optionally another fabric. The price is worked out here.
create or replace function public.wearvia_send_quote(
  p_order_id uuid, p_yards numeric, p_fabric_id uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o            public.orders%rowtype;
  v_fabric     public.fabrics%rowtype;
  v_yards      numeric := round(coalesce(p_yards, 0), 2);
  v_tailoring  numeric;
  v_emb_cost   numeric;
  v_delivery   numeric;
  v_cost       numeric;
  v_total      numeric;
  v_deposit    numeric;
  v_lines      jsonb;
  v_note       text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.wv_is_team() then
    raise exception 'Only the Nebeda Threads team can send quotes.';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or not public.can_manage_designer(o.designer_id) then
    raise exception 'That order wasn''t found.';
  end if;
  if o.quote_status = 'accepted' then
    raise exception 'The customer has already accepted the quote for %. It can''t be changed now.', o.order_number;
  end if;

  select * into v_fabric from public.fabrics where id = coalesce(p_fabric_id, o.fabric_id);
  if not found then
    raise exception 'Choose a fabric for the quote.';
  end if;
  if v_yards <= 0 or v_yards > 100 or v_yards * 4 <> round(v_yards * 4) then
    raise exception 'Enter the yards needed, in quarter yards (for example 4.5 or 5.25).';
  end if;
  if v_fabric.deleted_at is not null or v_fabric.status <> 'approved' or coalesce(v_fabric.sold_out, false) then
    raise exception '% isn''t on sale any more. Choose another fabric.', v_fabric.name;
  end if;
  if v_yards < coalesce(v_fabric.min_order_yards, 0) then
    raise exception 'The smallest order for % is % yd.', v_fabric.name, trim_scale(v_fabric.min_order_yards);
  end if;
  if v_yards > coalesce(v_fabric.yards_available, 0) then
    raise exception 'Only % yd of % is left in stock.', trim_scale(v_fabric.yards_available), v_fabric.name;
  end if;

  select p.price into v_tailoring from public.price_list p where p.kind = 'outfit' and p.name = o.outfit_type;
  select p.price into v_emb_cost from public.price_list p where p.kind = 'embroidery' and p.name = coalesce(nullif(o.embroidery, ''), 'None');
  select p.price into v_delivery from public.price_list p where p.kind = 'delivery' order by p.sort_order, p.name limit 1;
  if v_tailoring is null or v_emb_cost is null or v_delivery is null then
    raise exception 'The price list has no price for % / % embroidery / delivery. Add it in Business → Prices.', o.outfit_type, o.embroidery;
  end if;

  v_cost := round(v_yards * v_fabric.price_per_yard, 2);
  v_total := v_cost + v_tailoring + v_emb_cost + v_delivery;
  v_deposit := round(v_total * 0.6);
  v_lines := public.wv_quote_lines(v_fabric.name, v_yards, v_fabric.price_per_yard, v_cost,
                                   o.outfit_type, v_tailoring, coalesce(nullif(o.embroidery, ''), 'None'), v_emb_cost, v_delivery);

  update public.orders
     set fabric_id = v_fabric.id, fabric_supplier_id = v_fabric.supplier_id, fabric_yards = v_yards,
         fabric_cost = v_cost, tailoring_cost = v_tailoring, embroidery_cost = v_emb_cost, delivery_cost = v_delivery,
         quote_total = v_total, deposit_amount = v_deposit, line_items = v_lines,
         quote_status = 'quoted', quoted_at = now(), quoted_by = auth.uid(), fabric_problem = null
   where id = o.id;

  if v_note is not null then
    insert into public.order_messages (order_id, sender_kind, sender_id, sender_name, body)
    values (o.id, 'team', auth.uid(), public.wv_chat_name(true), left(v_note, 2000));
  end if;
  perform public.wv_post_system_message(o.id,
    'Your quote is ready: ' || v_fabric.name || ', ' || trim_scale(v_yards) || ' yd × ' || public.wv_money_text(v_fabric.price_per_yard)
    || ' = ' || public.wv_money_text(v_cost) || ' · tailoring ' || public.wv_money_text(v_tailoring)
    || ' · embroidery ' || public.wv_money_text(v_emb_cost) || ' · delivery ' || public.wv_money_text(v_delivery)
    || '. Total ' || public.wv_money_text(v_total) || ', deposit ' || public.wv_money_text(v_deposit) || ' (60%). '
    || 'Tap "Accept quote" to go ahead, or ask us a question here.');

  return jsonb_build_object('order_number', o.order_number, 'fabric', v_fabric.name, 'yards', v_yards,
                            'total', v_total, 'deposit', v_deposit, 'line_items', v_lines);
end $$;

-- The customer accepts their quote. Only now is the fabric taken out of
-- stock and the seller's order line and invoice made; then they pay the
-- deposit. p_total is the total the customer was shown, so a quote that
-- changed a moment ago is never accepted by mistake.
create or replace function public.wearvia_accept_quote(p_order_id uuid, p_total numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o        public.orders%rowtype;
  v_fabric public.fabrics%rowtype;
  v_text   text;
begin
  select * into o from public.orders
  where id = p_order_id and customer_id in (select public.wv_my_customer_ids())
  for update;
  if not found then
    raise exception 'That order wasn''t found.';
  end if;
  if o.quote_status = 'accepted' then
    return jsonb_build_object('ok', true, 'already', true, 'deposit', o.deposit_amount);
  end if;
  if o.quote_status <> 'quoted' then
    raise exception 'There''s no quote to accept yet. Nebeda Threads will send it in the chat.';
  end if;
  if p_total is null or abs(o.quote_total - p_total) > 0.005 then
    raise exception 'Your quote has just changed. Please check the new total and try again.';
  end if;

  -- The fabric may have sold out since the quote was sent
  select * into v_fabric from public.fabrics where id = o.fabric_id for update;
  if not public.wv_fabric_can_sell(v_fabric, o.fabric_yards) then
    v_text := case
      when v_fabric.id is null or v_fabric.deleted_at is not null or v_fabric.status <> 'approved' then coalesce(v_fabric.name, 'That fabric') || ' is no longer on sale'
      when v_fabric.sold_out or coalesce(v_fabric.yards_available, 0) < greatest(coalesce(v_fabric.min_order_yards, 0), 0.01) then v_fabric.name || ' has sold out'
      else 'Only ' || trim_scale(v_fabric.yards_available) || ' yd of ' || v_fabric.name || ' is left' end;
    update public.orders set quote_status = 'requested', fabric_problem = v_text where id = o.id;
    perform public.wv_post_system_message(o.id,
      'Sorry — ' || v_text || ', so this quote can''t be accepted. Nothing has been charged. '
      || 'Nebeda Threads will suggest another fabric here in the chat and send you a new quote.');
    return jsonb_build_object('ok', false, 'reason', 'fabric_unavailable', 'message',
      'Sorry — ' || v_text || '. Nebeda Threads will suggest another fabric in the chat.');
  end if;

  update public.orders
     set quote_status = 'accepted', accepted_at = now(), fabric_problem = null,
         due_date = greatest(coalesce(due_date, current_date), current_date + 14),
         assigned_cutting = coalesce(nullif(assigned_cutting, ''), public.wv_pick_tailor(designer_id, 'cutting')),
         assigned_sewing = coalesce(nullif(assigned_sewing, ''), public.wv_pick_tailor(designer_id, 'sewing')),
         assigned_embroidery = coalesce(nullif(assigned_embroidery, ''), public.wv_pick_tailor(designer_id, 'embroidery')),
         assigned_finishing = coalesce(nullif(assigned_finishing, ''), public.wv_pick_tailor(designer_id, 'finishing')),
         assigned_quality_control = coalesce(nullif(assigned_quality_control, ''), public.wv_pick_tailor(designer_id, 'quality_control'))
   where id = o.id
  returning * into o;

  perform public.wv_order_take_fabric(o);
  perform public.wv_post_system_message(o.id,
    'Quote accepted. ' || trim_scale(o.fabric_yards) || ' yd of ' || v_fabric.name || ' is bought for your outfit. '
    || 'Next: pay your deposit of ' || public.wv_money_text(o.deposit_amount) || ' and we''ll start making it.');
  return jsonb_build_object('ok', true, 'deposit', o.deposit_amount);
end $$;

-- Marks an order's chat as read by the customer or by the team
create or replace function public.wearvia_mark_chat_read(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_side text;
begin
  if public.wv_is_team() and exists (select 1 from public.orders o where o.id = p_order_id and public.can_manage_designer(o.designer_id)) then
    v_side := 'team';
  elsif p_order_id in (select public.wv_my_order_ids()) then
    v_side := 'customer';
  else
    return;
  end if;
  insert into public.order_chat_reads (order_id, side, last_read_at)
  values (p_order_id, v_side, now())
  on conflict (order_id, side) do update set last_read_at = excluded.last_read_at;
end $$;

-- Who can call what
revoke execute on function public.wearvia_send_quote(uuid, numeric, uuid, text) from public, anon;
grant execute on function public.wearvia_send_quote(uuid, numeric, uuid, text) to authenticated;
revoke execute on function public.wearvia_accept_quote(uuid, numeric) from public, anon;
grant execute on function public.wearvia_accept_quote(uuid, numeric) to authenticated;
revoke execute on function public.wearvia_mark_chat_read(uuid) from public, anon;
grant execute on function public.wearvia_mark_chat_read(uuid) to authenticated;
-- Internal helpers are not for calling from the app
revoke execute on function public.wv_post_system_message(uuid, text) from public, anon, authenticated;
revoke execute on function public.wv_order_take_fabric(public.orders) from public, anon, authenticated;
revoke execute on function public.wv_pick_tailor(uuid, text) from public, anon, authenticated;
revoke execute on function public.wv_chat_name(boolean) from public, anon;
grant execute on function public.wv_chat_name(boolean) to authenticated;   -- the chat rule above uses it


-- ---------------------------------------------------------------------
-- 6. Security rules for the chat
-- ---------------------------------------------------------------------

alter table public.order_messages   enable row level security;
alter table public.order_chat_reads enable row level security;

-- Customers see and write in their own orders' chats; the team in every chat.
-- Nobody can edit or delete a message.
drop policy if exists "order_messages: customer or team reads" on public.order_messages;
create policy "order_messages: customer or team reads" on public.order_messages
  for select to authenticated
  using (order_id in (select public.wv_my_order_ids()) or (select public.wv_is_team()));
drop policy if exists "order_messages: customer or team writes" on public.order_messages;
create policy "order_messages: customer or team writes" on public.order_messages
  for insert to authenticated
  with check (order_id in (select public.wv_my_order_ids()) or (select public.wv_is_team()));

drop policy if exists "order_chat_reads: customer or team reads" on public.order_chat_reads;
create policy "order_chat_reads: customer or team reads" on public.order_chat_reads
  for select to authenticated
  using (order_id in (select public.wv_my_order_ids()) or (select public.wv_is_team()));

revoke all on public.order_messages, public.order_chat_reads from public, anon, authenticated;
grant select, insert on public.order_messages to authenticated;
grant select on public.order_chat_reads to authenticated;


-- ---------------------------------------------------------------------
-- 7. Chat photos: a private bucket
-- ---------------------------------------------------------------------
-- Each photo is uploaded into a folder named after the sender
-- (chat-photos/<user id>/…). The sender and the team can open it; the
-- customer can open any photo posted in their own order's chat.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-photos', 'chat-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.wv_can_see_chat_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_messages m
                 where p_name = any (m.photos) and m.order_id in (select public.wv_my_order_ids()))
$$;

create or replace function public.wv_chat_photo_in_use(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_messages m where p_name = any (m.photos))
$$;

drop policy if exists "wearvia: upload own chat photos" on storage.objects;
create policy "wearvia: upload own chat photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "wearvia: view chat photos" on storage.objects;
create policy "wearvia: view chat photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-photos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.wv_is_team())
         or public.wv_can_see_chat_photo(name)));

-- A photo can be removed before it's sent; once it's in the chat it stays
drop policy if exists "wearvia: delete own unsent chat photos" on storage.objects;
create policy "wearvia: delete own unsent chat photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.wv_chat_photo_in_use(name));

commit;

-- Tell the Supabase API about the new columns, tables and functions straight away
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 8. Report — every line should say "OK".
-- ---------------------------------------------------------------------
with checks as (
  select 1 as n, 'Existing orders carry on as before (accepted)' as check_name,
         case when exists (select 1 from wv_quote_orders_before b join public.orders o on o.id = b.id
                           where o.quote_status is distinct from 'accepted')
                or exists (select 1 from wv_quote_orders_before b where not exists (select 1 from public.orders o where o.id = b.id))
              then 'CHANGED — tell your developer'
              else 'OK (' || (select count(*) from wv_quote_orders_before) || ' orders)' end as result
  union all
  select 2, 'Money on existing orders, invoices and payments unchanged',
         case when not exists (
                select kind, id, money from wv_quote_money_before where kind <> 'fabric'
                except
                (select 'order', id, md5(row(fabric_id, fabric_yards, fabric_cost, tailoring_cost, embroidery_cost, delivery_cost,
                                            quote_total, deposit_amount, line_items, deposit_paid_at, balance_paid_at, stage)::text)
                 from public.orders
                 union all
                 select 'invoice', id, md5(row(total, line_items)::text) from public.invoices
                 union all
                 select 'payment', id, md5(row(amount, status)::text) from public.payments))
              then 'OK' else 'CHANGED — tell your developer' end
  union all
  select 3, 'Fabric stock unchanged',
         case when not exists (
                select kind, id, money from wv_quote_money_before where kind = 'fabric'
                except
                select 'fabric', id, md5(row(yards_available)::text) from public.fabrics)
              then 'OK (' || (select count(*) from wv_quote_money_before where kind = 'fabric') || ' fabrics)'
              else 'CHANGED — tell your developer' end
  union all
  select 4, 'Customers can''t set yards or prices',
         case when (select prosrc from pg_proc where oid = 'public.wv_orders_before_insert()'::regprocedure) ilike '%quote_status := ''requested''%'
               and exists (select 1 from pg_trigger where tgname = 'wv_orders_before_insert' and tgrelid = 'public.orders'::regclass and tgenabled <> 'D')
               and exists (select 1 from pg_trigger where tgname = 'wv_orders_guard_quote' and tgrelid = 'public.orders'::regclass and tgenabled <> 'D')
               and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders'
                               and cmd in ('UPDATE', 'ALL') and qual not ilike '%can_manage_designer%' and qual not ilike '%wv_is_team%')
              then 'OK' else 'NOT LOCKED — tell your developer' end
  union all
  select 5, 'Stock is only taken when a quote is accepted',
         case when (select prosrc from pg_proc where oid = 'public.wv_orders_after_insert()'::regprocedure) ilike '%quote_status = ''accepted''%'
               and (select prosrc from pg_proc where oid = 'public.wv_orders_before_delete()'::regprocedure) ilike '%quote_status = ''accepted''%'
               and exists (select 1 from pg_trigger where tgname = 'wv_fabrics_after_update' and tgrelid = 'public.fabrics'::regclass and tgenabled <> 'D')
              then 'OK' else 'NOT SWITCHED ON — tell your developer' end
  union all
  select 6, 'Quote functions ready (send, accept, mark read)',
         case when has_function_privilege('authenticated', 'public.wearvia_send_quote(uuid, numeric, uuid, text)', 'execute')
               and has_function_privilege('authenticated', 'public.wearvia_accept_quote(uuid, numeric)', 'execute')
               and has_function_privilege('authenticated', 'public.wearvia_mark_chat_read(uuid)', 'execute')
               and not has_function_privilege('anon', 'public.wearvia_send_quote(uuid, numeric, uuid, text)', 'execute')
               and not has_function_privilege('anon', 'public.wearvia_accept_quote(uuid, numeric)', 'execute')
               and not has_function_privilege('authenticated', 'public.wv_post_system_message(uuid, text)', 'execute')
              then 'OK' else 'MISSING — tell your developer' end
  union all
  select 7, 'Chat: customers see only their own, the team sees all',
         case when (select relrowsecurity from pg_class where oid = 'public.order_messages'::regclass)
               and (select relrowsecurity from pg_class where oid = 'public.order_chat_reads'::regclass)
               and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'order_messages') = 2
               and not has_table_privilege('anon', 'public.order_messages', 'select, insert, update, delete')
               and not has_table_privilege('authenticated', 'public.order_messages', 'update, delete')
               and not has_table_privilege('authenticated', 'public.order_chat_reads', 'insert, update, delete')
               and exists (select 1 from pg_trigger where tgname = 'wv_order_messages_before_insert' and tgenabled <> 'D')
              then 'OK (' || (select count(*) from public.order_messages) || ' messages)' else 'NOT LOCKED — tell your developer' end
  union all
  select 8, 'Chat photos are in a private bucket',
         case when exists (select 1 from storage.buckets where id = 'chat-photos' and not public)
               and (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname in ('wearvia: upload own chat photos', 'wearvia: view chat photos', 'wearvia: delete own unsent chat photos')) = 3
              then 'OK' else 'NOT PRIVATE — tell your developer' end
)
select check_name, result from (
  select n, check_name, result from checks
  union all
  select 99, 'ALL DONE', case when bool_and(result like 'OK%') then 'OK — you can merge the app update'
                              else 'NOT OK — see the lines above and tell your developer' end
  from checks
) report
order by n;
