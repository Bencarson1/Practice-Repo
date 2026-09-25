-- =====================================================================
-- Wearvia — Supabase setup
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It builds on the existing database described in SUPABASE-SCHEMA.md:
-- it never drops or recreates a table, and it is safe to run again
-- (every step checks whether it has already been done).
--
-- Fabric is sold by the yard. A database that still has the old metre
-- columns (price_per_metre, metres_available …) needs yards.sql as well:
-- run this file first, then yards.sql.
--
-- Prices (tailoring, embroidery, delivery) are kept in the price_list
-- table and new orders are priced by the database. On a database set up
-- before the price list existed, run prices.sql after this file too.
--
-- What it does:
--   1. Adds the enum values the app uses
--   2. Adds the missing columns (fabric photos, supplier phone/logo, style photos …)
--   3. Adds the missing tables (payments, tailors, wedding members,
--      ready-to-wear, fabric seller order lines, team invites, price list)
--   4. Helper functions used by the security rules
--   5. Triggers that keep the data honest (a customer's browser can never
--      mark an order paid or move a production stage)
--   6. Security rules (Row Level Security) — and fixes the
--      "Auth RLS Initialization Plan" warnings
--   7. Storage buckets for photos, with their security rules
--   8. Functions the app calls (sign-up setup, adding staff)
--   9. The owner set-up function — see the instructions at the very end
--
-- After this file, run tailor-quote.sql as well (again if it has run before):
-- it replaces the "new order" rules so customers' orders become quote requests.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Enum values
-- ---------------------------------------------------------------------
-- New values can't be used in the same run they are added, so nothing
-- below compares against them directly; functions compare as text.

alter type public.user_role add value if not exists 'customer';
alter type public.user_role add value if not exists 'supplier';
alter type public.user_role add value if not exists 'designer_owner';
alter type public.user_role add value if not exists 'designer_staff';
alter type public.user_role add value if not exists 'admin';

-- Production stages, in order. An order's stage is the last step it finished.
alter type public.order_stage add value if not exists 'tailor_assigned';
alter type public.order_stage add value if not exists 'cutting';
alter type public.order_stage add value if not exists 'sewing';
alter type public.order_stage add value if not exists 'embroidery';
alter type public.order_stage add value if not exists 'fitting';
alter type public.order_stage add value if not exists 'quality_control';
alter type public.order_stage add value if not exists 'balance_paid';
alter type public.order_stage add value if not exists 'delivered';


-- ---------------------------------------------------------------------
-- 2. Missing columns on existing tables
-- ---------------------------------------------------------------------

-- Fabrics: photos, description, colour, approval status, sold out.
-- Fabrics already in the database are treated as approved; new ones start as pending.
alter table public.fabrics add column if not exists photos       text[]      not null default '{}';  -- paths in the fabric-photos bucket, first = cover
alter table public.fabrics add column if not exists description  text        not null default '';
alter table public.fabrics add column if not exists colour_name  text;                                -- colour family customers filter by, e.g. "Blue"
alter table public.fabrics add column if not exists colour_hex   text;                                -- swatch colour, e.g. "#1e3a5f"
alter table public.fabrics add column if not exists status       text        not null default 'approved';
alter table public.fabrics alter column status set default 'pending';
alter table public.fabrics add column if not exists review_note  text        not null default '';     -- why Nebeda Threads hid it
alter table public.fabrics add column if not exists reviewed_at  timestamptz;
alter table public.fabrics add column if not exists sold_out     boolean     not null default false;
alter table public.fabrics add column if not exists deleted_at   timestamptz;                         -- soft delete keeps old orders readable
alter table public.fabrics add column if not exists updated_at   timestamptz not null default now();

-- Suppliers (fabric sellers): phone and logo
alter table public.suppliers add column if not exists phone      text;
alter table public.suppliers add column if not exists logo_url   text;                                -- public URL in the seller-logos bucket
alter table public.suppliers add column if not exists updated_at timestamptz not null default now();

-- Orders: the customer's style photos, link and note, plus a few fields the app shows
alter table public.orders add column if not exists inspiration_photos text[]  not null default '{}';  -- paths in the style-photos bucket
alter table public.orders add column if not exists inspiration_link   text;
alter table public.orders add column if not exists inspiration_note   text;
alter table public.orders add column if not exists concept_variation  integer not null default 1;
alter table public.orders add column if not exists due_date           date;
alter table public.orders add column if not exists line_items         jsonb;                          -- the itemised quote
alter table public.orders add column if not exists fabric_supplier_id uuid;

-- Customers: the shop's notes
alter table public.customers add column if not exists notes text not null default '';

-- Measurements: top / dress length (hips already exist as "hip")
alter table public.measurement_profiles add column if not exists garment_length numeric;

-- Deliveries and invoices
alter table public.deliveries add column if not exists updated_at timestamptz not null default now();
alter table public.invoices   add column if not exists invoice_number text;

-- Checks (added only if missing)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fabrics_status_check_wv') then
    alter table public.fabrics add constraint fabrics_status_check_wv
      check (status in ('pending', 'approved', 'hidden'));
  end if;
  -- (only once the database is in yards — see yards.sql)
  if not exists (select 1 from pg_constraint where conname = 'fabrics_stock_check_wv')
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'fabrics' and column_name = 'yards_available') then
    alter table public.fabrics add constraint fabrics_stock_check_wv
      check (yards_available >= 0) not valid;
  end if;
end $$;

-- Order numbers (NT-1001, NT-1002, …) are given out by the database so two
-- phones can never pick the same one.
create sequence if not exists public.wearvia_order_number_seq start 1001;
create unique index if not exists orders_order_number_key_wv on public.orders (order_number);


-- ---------------------------------------------------------------------
-- 3. New tables
-- ---------------------------------------------------------------------

-- Payments: deposits, balances and part payments. While checkout is a demo,
-- a customer's payment waits for Nebeda Threads to confirm it.
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  amount       numeric(10, 2) not null check (amount > 0),
  method       text not null default 'Card',          -- Card, Apple Pay, Bank transfer, Cash
  kind         text not null default 'Deposit' check (kind in ('Deposit', 'Balance', 'Part payment')),
  status       text not null default 'awaiting_confirmation'
               check (status in ('awaiting_confirmation', 'confirmed', 'rejected')),
  paid_on      date not null default current_date,
  note         text,
  created_by   uuid default auth.uid(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists payments_order_idx on public.payments (order_id);
create index if not exists payments_waiting_idx on public.payments (status) where status = 'awaiting_confirmation';

-- The tailor team (people who make the outfits). They don't need a login;
-- logins for the business dashboard are in designer_staff.
create table if not exists public.tailors (
  id          uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.designers (id) on delete cascade,
  name        text not null,
  role        text not null check (role in ('cutting', 'sewing', 'embroidery', 'finishing', 'quality_control')),
  phone       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists tailors_designer_idx on public.tailors (designer_id);

-- Wedding and group orders: one row per group of people
create table if not exists public.wedding_order_members (
  id               uuid primary key default gen_random_uuid(),
  wedding_order_id uuid not null references public.wedding_orders (id) on delete cascade,
  role             text not null,                  -- "Bride", "Groomsmen (6)"
  name             text not null default '',
  outfits          integer not null default 1 check (outfits > 0),
  order_id         uuid references public.orders (id) on delete set null,
  status           text not null default 'Not started',
  created_at       timestamptz not null default now()
);
create index if not exists wedding_members_wedding_idx on public.wedding_order_members (wedding_order_id);

-- Ready to wear
create table if not exists public.ready_to_wear_items (
  id          uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.designers (id) on delete cascade,
  name        text not null,
  price       numeric(10, 2) not null check (price >= 0),
  cost        numeric(10, 2) not null default 0,
  stock       integer not null default 0 check (stock >= 0),
  colour_hex  text not null default '#1e2a44',
  photo_url   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ready_to_wear_sales (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid references public.ready_to_wear_items (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  price       numeric(10, 2) not null,
  cost        numeric(10, 2) not null default 0,
  status      text not null default 'awaiting_confirmation'
              check (status in ('awaiting_confirmation', 'confirmed', 'rejected')),
  sold_on     date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists rtw_sales_customer_idx on public.ready_to_wear_sales (customer_id);

-- What each fabric seller has to send: one line per order that uses their fabric
create table if not exists public.fabric_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid references public.orders (id) on delete set null,
  order_number        text not null,
  supplier_id         uuid not null references public.suppliers (id) on delete cascade,
  fabric_id           uuid references public.fabrics (id) on delete set null,
  fabric_name         text not null,               -- copied so it survives edits
  yards               numeric(8, 2) not null,
  price_per_yard      numeric(10, 2) not null,
  total               numeric(10, 2) not null,
  customer_first_name text not null default '',    -- sellers only see a first name
  deliver_to          text not null default '',
  status              text not null default 'new' check (status in ('new', 'sent', 'cancelled')),
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists fabric_lines_supplier_idx on public.fabric_order_lines (supplier_id, created_at desc);
create index if not exists fabric_lines_order_idx on public.fabric_order_lines (order_id);

-- Team logins the owner has added before the person has signed up
create table if not exists public.designer_staff_invites (
  id          uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.designers (id) on delete cascade,
  email       text not null,
  job_role    text not null default 'staff',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index if not exists staff_invites_email_key on public.designer_staff_invites (designer_id, lower(email));

-- The price list: tailoring price and typical yards for each outfit, embroidery
-- and delivery. New orders are priced from it (Business → Prices changes it).
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


-- Indexes the security rules lean on
create index if not exists customers_auth_user_idx   on public.customers (auth_user_id);
create index if not exists orders_customer_idx       on public.orders (customer_id);
create index if not exists orders_designer_idx       on public.orders (designer_id);
create index if not exists measurement_customer_idx  on public.measurement_profiles (customer_id);
create index if not exists fabrics_supplier_idx      on public.fabrics (supplier_id);
create index if not exists suppliers_owner_idx       on public.suppliers (owner_user_id);
create index if not exists designer_staff_user_idx   on public.designer_staff (user_id);
create index if not exists designers_owner_idx       on public.designers (owner_user_id);


-- ---------------------------------------------------------------------
-- 4. Helper functions for the security rules
-- ---------------------------------------------------------------------
-- The database already has is_admin(), can_manage_designer() and
-- can_manage_supplier(). They are left exactly as they are; these are only
-- created if they are somehow missing.

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    execute $f$
      create function public.is_admin() returns boolean
      language sql stable security definer set search_path = public as $b$
        select exists (select 1 from public.profiles where id = auth.uid() and role::text = 'admin')
      $b$ $f$;
  end if;
  if to_regprocedure('public.can_manage_designer(uuid)') is null then
    execute $f$
      create function public.can_manage_designer(p_designer_id uuid) returns boolean
      language sql stable security definer set search_path = public as $b$
        select public.is_admin()
          or exists (select 1 from public.designers d where d.id = p_designer_id and d.owner_user_id = auth.uid())
          or exists (select 1 from public.designer_staff s where s.designer_id = p_designer_id and s.user_id = auth.uid())
      $b$ $f$;
  end if;
  if to_regprocedure('public.can_manage_supplier(uuid)') is null then
    execute $f$
      create function public.can_manage_supplier(p_supplier_id uuid) returns boolean
      language sql stable security definer set search_path = public as $b$
        select public.is_admin()
          or exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.owner_user_id = auth.uid())
      $b$ $f$;
  end if;
end $$;

-- True for the Nebeda Threads team: admins, the owner and staff with a login
create or replace function public.wv_is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (select 1 from public.designers d where d.owner_user_id = auth.uid())
    or exists (select 1 from public.designer_staff s where s.user_id = auth.uid())
$$;

-- True for admins and the shop owner (they can add and remove staff logins)
create or replace function public.wv_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (select 1 from public.designers d where d.owner_user_id = auth.uid())
$$;

-- The signed-in person's own customer record(s)
create or replace function public.wv_my_customer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.customers c where c.auth_user_id = auth.uid()
$$;

-- The signed-in customer's own orders
create or replace function public.wv_my_order_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select o.id from public.orders o
  join public.customers c on c.id = o.customer_id
  where c.auth_user_id = auth.uid()
$$;

-- Fabrics used in the signed-in customer's orders (so old orders still show them)
create or replace function public.wv_my_order_fabric_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select o.fabric_id from public.orders o
  join public.customers c on c.id = o.customer_id
  where c.auth_user_id = auth.uid() and o.fabric_id is not null
$$;

-- Nebeda Threads: the designer the app orders from
create or replace function public.wv_main_designer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select d.id from public.designers d
  order by (d.business_name ilike 'nebeda%') desc, d.created_at
  limit 1
$$;

-- Confirmed money received for an order
create or replace function public.wv_confirmed_paid(p_order_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.amount), 0) from public.payments p
  where p.order_id = p_order_id and p.status = 'confirmed'
$$;


-- ---------------------------------------------------------------------
-- 5. Triggers that keep the data honest
-- ---------------------------------------------------------------------

-- Production steps in order, used to check stage moves
create or replace function public.wv_stage_position(p_stage text) returns integer
language sql immutable set search_path = public as $$
  select array_position(array['tailor_assigned', 'cutting', 'sewing', 'embroidery', 'fitting',
                              'quality_control', 'balance_paid', 'delivered'], p_stage)
$$;

-- Keeps updated_at current
create or replace function public.wv_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

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

-- Before a stage change: production can't start until the deposit is
-- confirmed, and the order can't pass "balance paid" until it's paid in full
create or replace function public.wv_orders_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_from integer := public.wv_stage_position(old.stage::text);
  v_to   integer := public.wv_stage_position(new.stage::text);
begin
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

-- Every stage change is written to order_events (the order's history)
create or replace function public.wv_orders_log_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.order_events (order_id, stage, note, created_by, created_at)
    values (new.id, new.stage, 'Stage changed', auth.uid(), now());
  end if;
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

-- Works out whether the deposit and balance are paid from CONFIRMED payments only
create or replace function public.wv_refresh_order_payments(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_paid  numeric;
  v_dep   timestamptz;
  v_bal   timestamptz;
  v_stage text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return; end if;
  v_paid := public.wv_confirmed_paid(p_order_id);
  v_stage := v_order.stage::text;

  if v_paid > 0 and v_paid >= least(coalesce(v_order.deposit_amount, 0), coalesce(v_order.quote_total, 0)) - 0.005 then
    v_dep := coalesce(v_order.deposit_paid_at, now());
  elsif coalesce(public.wv_stage_position(v_stage), 1) <= 1 then
    v_dep := null;                                  -- deposit rejected before work started
  else
    v_dep := v_order.deposit_paid_at;
  end if;

  if v_paid >= coalesce(v_order.quote_total, 0) - 0.005 and v_paid > 0 then
    v_bal := coalesce(v_order.balance_paid_at, now());
    if v_stage = 'quality_control' then v_stage := 'balance_paid'; end if;   -- step 14
  else
    v_bal := null;
  end if;

  update public.orders
     set deposit_paid_at = v_dep,
         balance_paid_at = v_bal,
         stage = v_stage::public.order_stage
   where id = p_order_id
     and (deposit_paid_at is distinct from v_dep or balance_paid_at is distinct from v_bal
          or stage::text is distinct from v_stage);
end $$;

-- A payment from a customer's browser always waits for confirmation.
-- The team's own entries (cash in the shop, confirmations) count straight away.
create or replace function public.wv_payments_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team boolean := public.wv_is_team();
begin
  if tg_op = 'INSERT' then
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

create or replace function public.wv_payments_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.wv_refresh_order_payments(new.order_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.order_id is distinct from new.order_id) then
    perform public.wv_refresh_order_payments(old.order_id);
  end if;
  return null;
end $$;

-- A customer's review is copied onto the order (customers can't edit orders)
create or replace function public.wv_reviews_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set review_rating = new.rating, review_text = new.review_text
  where id = new.order_id;
  return null;
end $$;

-- Fabric sellers can't approve their own fabrics. A live fabric whose photos,
-- name, type, colour or description change goes back for checking.
create or replace function public.wv_fabrics_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team boolean := public.wv_is_team();
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    if not v_team then
      new.status := 'pending';
      new.review_note := '';
      new.reviewed_at := null;
    end if;
  else
    v_changed := new.name is distinct from old.name or new.category is distinct from old.category
      or new.colour_name is distinct from old.colour_name or new.description is distinct from old.description
      or new.photos is distinct from old.photos;
    if not v_team then
      new.status := old.status;
      new.review_note := old.review_note;
      new.reviewed_at := old.reviewed_at;
      new.supplier_id := old.supplier_id;
      if v_changed and old.status in ('approved', 'hidden') and new.deleted_at is null then
        new.status := 'pending';
        new.review_note := '';
      end if;
    elsif new.status is distinct from old.status then
      new.reviewed_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Sellers can't change their rating or who owns the shop
create or replace function public.wv_suppliers_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.wv_is_team() then
    if tg_op = 'INSERT' then
      new.owner_user_id := auth.uid();
      new.rating := null;
    else
      new.owner_user_id := old.owner_user_id;
      new.rating := old.rating;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Customers can't attach their record to someone else's login, or edit the shop's notes
create or replace function public.wv_customers_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.wv_is_team() then
    if tg_op = 'INSERT' then
      new.auth_user_id := auth.uid();
      new.notes := '';
    else
      new.auth_user_id := coalesce(old.auth_user_id, new.auth_user_id);
      new.notes := old.notes;
    end if;
  end if;
  return new;
end $$;

-- Sellers can only mark their order lines as sent
create or replace function public.wv_fabric_lines_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text := new.status;
begin
  if not public.wv_is_team() then
    new := old;
    if old.status = 'new' and v_status = 'sent' then
      new.status := 'sent';
    end if;
  end if;
  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.sent_at := now();
  end if;
  return new;
end $$;

-- Ready-to-wear: a sale takes one item out of stock; customers pay the listed price
create or replace function public.wv_rtw_sales_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item public.ready_to_wear_items%rowtype;
begin
  update public.ready_to_wear_items set stock = stock - 1, updated_at = now()
  where id = new.item_id and stock > 0 and active
  returning * into v_item;
  if not found then
    raise exception 'Sorry, that item has just sold out.';
  end if;
  if not public.wv_is_team() then
    new.price := v_item.price;
    new.status := 'awaiting_confirmation';
    new.sold_on := current_date;
  end if;
  new.cost := v_item.cost;
  return new;
end $$;

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
drop trigger if exists wv_orders_log_stage on public.orders;
create trigger wv_orders_log_stage after update of stage on public.orders
  for each row execute function public.wv_orders_log_stage();
drop trigger if exists wv_orders_before_delete on public.orders;
create trigger wv_orders_before_delete before delete on public.orders
  for each row execute function public.wv_orders_before_delete();

drop trigger if exists wv_payments_before_write on public.payments;
create trigger wv_payments_before_write before insert or update on public.payments
  for each row execute function public.wv_payments_before_write();
drop trigger if exists wv_payments_after_write on public.payments;
create trigger wv_payments_after_write after insert or update or delete on public.payments
  for each row execute function public.wv_payments_after_write();

drop trigger if exists wv_reviews_after_insert on public.reviews;
create trigger wv_reviews_after_insert after insert on public.reviews
  for each row execute function public.wv_reviews_after_insert();

drop trigger if exists wv_fabrics_before_write on public.fabrics;
create trigger wv_fabrics_before_write before insert or update on public.fabrics
  for each row execute function public.wv_fabrics_before_write();

drop trigger if exists wv_suppliers_before_write on public.suppliers;
create trigger wv_suppliers_before_write before insert or update on public.suppliers
  for each row execute function public.wv_suppliers_before_write();

drop trigger if exists wv_customers_before_write on public.customers;
create trigger wv_customers_before_write before insert or update on public.customers
  for each row execute function public.wv_customers_before_write();

drop trigger if exists wv_fabric_lines_before_update on public.fabric_order_lines;
create trigger wv_fabric_lines_before_update before update on public.fabric_order_lines
  for each row execute function public.wv_fabric_lines_before_update();

drop trigger if exists wv_rtw_sales_before_insert on public.ready_to_wear_sales;
create trigger wv_rtw_sales_before_insert before insert on public.ready_to_wear_sales
  for each row execute function public.wv_rtw_sales_before_insert();

drop trigger if exists wv_price_list_before_update on public.price_list;
create trigger wv_price_list_before_update before update on public.price_list
  for each row execute function public.wv_price_list_before_update();

drop trigger if exists wv_touch_deliveries on public.deliveries;
create trigger wv_touch_deliveries before update on public.deliveries
  for each row execute function public.wv_touch_updated_at();
drop trigger if exists wv_touch_measurements on public.measurement_profiles;
create trigger wv_touch_measurements before update on public.measurement_profiles
  for each row execute function public.wv_touch_updated_at();
drop trigger if exists wv_touch_rtw_items on public.ready_to_wear_items;
create trigger wv_touch_rtw_items before update on public.ready_to_wear_items
  for each row execute function public.wv_touch_updated_at();


-- ---------------------------------------------------------------------
-- 6. Security rules (Row Level Security)
-- ---------------------------------------------------------------------
-- auth.uid() is written as (select auth.uid()) so Postgres works it out once
-- per query instead of once per row. That is the fix for the
-- "Auth RLS Initialization Plan" warnings.

alter table public.customers              enable row level security;
alter table public.deliveries             enable row level security;
alter table public.designer_portfolio_items enable row level security;
alter table public.designer_services      enable row level security;
alter table public.designer_staff         enable row level security;
alter table public.designers              enable row level security;
alter table public.fabrics                enable row level security;
alter table public.invoices               enable row level security;
alter table public.measurement_profiles   enable row level security;
alter table public.order_events           enable row level security;
alter table public.orders                 enable row level security;
alter table public.profiles               enable row level security;
alter table public.reviews                enable row level security;
alter table public.suppliers              enable row level security;
alter table public.wedding_orders         enable row level security;
alter table public.payments               enable row level security;
alter table public.tailors                enable row level security;
alter table public.wedding_order_members  enable row level security;
alter table public.ready_to_wear_items    enable row level security;
alter table public.ready_to_wear_sales    enable row level security;
alter table public.fabric_order_lines     enable row level security;
alter table public.designer_staff_invites enable row level security;

-- ---- Existing rules, rewritten with (select auth.uid()) ----

drop policy if exists "customers read own row" on public.customers;
create policy "customers read own row" on public.customers
  for select using ((select auth.uid()) = auth_user_id);

drop policy if exists "customers update own row" on public.customers;
create policy "customers update own row" on public.customers
  for update using ((select auth.uid()) = auth_user_id) with check ((select auth.uid()) = auth_user_id);

drop policy if exists "customers read own measurement profiles" on public.measurement_profiles;
create policy "customers read own measurement profiles" on public.measurement_profiles
  for select using (customer_id in (select public.wv_my_customer_ids()));

drop policy if exists "customers manage own measurement profiles" on public.measurement_profiles;
create policy "customers manage own measurement profiles" on public.measurement_profiles
  for all using (customer_id in (select public.wv_my_customer_ids()))
  with check (customer_id in (select public.wv_my_customer_ids()));

drop policy if exists "customers read own orders" on public.orders;
create policy "customers read own orders" on public.orders
  for select using (customer_id in (select public.wv_my_customer_ids()));

drop policy if exists "customers read own invoices" on public.invoices;
create policy "customers read own invoices" on public.invoices
  for select using (order_id in (select public.wv_my_order_ids()));

drop policy if exists "customers read own deliveries" on public.deliveries;
create policy "customers read own deliveries" on public.deliveries
  for select using (order_id in (select public.wv_my_order_ids()));

drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "profiles: update own or admin (role locked by trigger)" on public.profiles;
create policy "profiles: update own or admin (role locked by trigger)" on public.profiles
  for update using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "designer_staff: only the owner or admin can add/remove staff" on public.designer_staff;
create policy "designer_staff: only the owner or admin can add/remove staff" on public.designer_staff
  for insert with check (
    exists (select 1 from public.designers d where d.id = designer_staff.designer_id and d.owner_user_id = (select auth.uid()))
    or (select public.is_admin()));

drop policy if exists "designer_staff: only the owner or admin can update staff rows" on public.designer_staff;
create policy "designer_staff: only the owner or admin can update staff rows" on public.designer_staff
  for update using (
    exists (select 1 from public.designers d where d.id = designer_staff.designer_id and d.owner_user_id = (select auth.uid()))
    or (select public.is_admin()));

drop policy if exists "designer_staff: only the owner or admin can remove staff" on public.designer_staff;
create policy "designer_staff: only the owner or admin can remove staff" on public.designer_staff
  for delete using (
    exists (select 1 from public.designers d where d.id = designer_staff.designer_id and d.owner_user_id = (select auth.uid()))
    or (select public.is_admin()));

drop policy if exists "designers: owner can create their own designer row" on public.designers;
create policy "designers: owner can create their own designer row" on public.designers
  for insert with check (
    owner_user_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'designer_owner'::public.user_role));

drop policy if exists "designers: owner or admin can update their own designer row" on public.designers;
create policy "designers: owner or admin can update their own designer row" on public.designers
  for update using (owner_user_id = (select auth.uid()) or (select public.is_admin()))
  with check (owner_user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "suppliers: owner can create their own supplier row" on public.suppliers;
create policy "suppliers: owner can create their own supplier row" on public.suppliers
  for insert with check (
    owner_user_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'supplier'::public.user_role));

drop policy if exists "suppliers: owner or admin can update their own supplier row" on public.suppliers;
create policy "suppliers: owner or admin can update their own supplier row" on public.suppliers
  for update using (owner_user_id = (select auth.uid()) or (select public.is_admin()))
  with check (owner_user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "order_events: customer reads own" on public.order_events;
create policy "order_events: customer reads own" on public.order_events
  for select using (order_id in (select public.wv_my_order_ids()));

drop policy if exists "reviews: customer reviews own delivered order" on public.reviews;
create policy "reviews: customer reviews own delivered order" on public.reviews
  for insert with check (
    customer_id in (select public.wv_my_customer_ids())
    and exists (select 1 from public.orders o
                where o.id = reviews.order_id and o.customer_id = reviews.customer_id
                  and o.designer_id = reviews.designer_id and o.stage = 'delivered'::public.order_stage));

drop policy if exists "customers: designer staff/owner/admin can read customers on the" on public.customers;
create policy "customers: designer staff/owner/admin can read customers on the" on public.customers
  for select using (
    id in (select o.customer_id from public.orders o where public.can_manage_designer(o.designer_id))
    or (select public.is_admin()));

-- Fabrics used to be readable by everyone, including ones waiting for approval.
-- Now: approved fabrics are public; sellers see their own; the team sees all.
drop policy if exists "fabrics public read" on public.fabrics;
drop policy if exists "fabrics: read approved, own or team" on public.fabrics;
create policy "fabrics: read approved, own or team" on public.fabrics
  for select using (
    (status = 'approved' and deleted_at is null)
    or public.can_manage_supplier(supplier_id)
    or (select public.wv_is_team())
    or id in (select public.wv_my_order_fabric_ids()));

-- ---- New rules ----

-- Customers: a new customer creates their own record; the team manages all customers
drop policy if exists "customers: sign up creates own row" on public.customers;
create policy "customers: sign up creates own row" on public.customers
  for insert to authenticated with check (auth_user_id = (select auth.uid()));
drop policy if exists "customers: team reads all" on public.customers;
create policy "customers: team reads all" on public.customers
  for select using ((select public.wv_is_team()));
drop policy if exists "customers: team adds walk-in customers" on public.customers;
create policy "customers: team adds walk-in customers" on public.customers
  for insert with check ((select public.wv_is_team()));
drop policy if exists "customers: team updates" on public.customers;
create policy "customers: team updates" on public.customers
  for update using ((select public.wv_is_team())) with check ((select public.wv_is_team()));

-- Measurements: the team can save measurements for any customer
drop policy if exists "measurement_profiles: team manages" on public.measurement_profiles;
create policy "measurement_profiles: team manages" on public.measurement_profiles
  for all using ((select public.wv_is_team())) with check ((select public.wv_is_team()));

-- Orders: customers place their own orders; the team takes walk-in orders and can delete.
-- (Only the team can UPDATE orders — that existing rule is unchanged.)
drop policy if exists "orders: customers place own orders" on public.orders;
create policy "orders: customers place own orders" on public.orders
  for insert to authenticated with check (customer_id in (select public.wv_my_customer_ids()));
drop policy if exists "orders: team creates orders" on public.orders;
create policy "orders: team creates orders" on public.orders
  for insert with check (public.can_manage_designer(designer_id));
drop policy if exists "orders: team deletes orders" on public.orders;
create policy "orders: team deletes orders" on public.orders
  for delete using (public.can_manage_designer(designer_id));

-- Payments: customers see and add payments on their own orders (always
-- "awaiting confirmation"); only the team can confirm, change or delete them
drop policy if exists "payments: customer reads own" on public.payments;
create policy "payments: customer reads own" on public.payments
  for select using (order_id in (select public.wv_my_order_ids()));
drop policy if exists "payments: customer pays own order" on public.payments;
create policy "payments: customer pays own order" on public.payments
  for insert to authenticated with check (order_id in (select public.wv_my_order_ids()));
drop policy if exists "payments: team manages" on public.payments;
create policy "payments: team manages" on public.payments
  for all using ((select public.wv_is_team())) with check ((select public.wv_is_team()));

-- Deliveries: the team dispatches (the existing rules let them read and update)
drop policy if exists "deliveries: team creates" on public.deliveries;
create policy "deliveries: team creates" on public.deliveries
  for insert with check (order_id in (select o.id from public.orders o where public.can_manage_designer(o.designer_id)));
drop policy if exists "deliveries: team deletes" on public.deliveries;
create policy "deliveries: team deletes" on public.deliveries
  for delete using (order_id in (select o.id from public.orders o where public.can_manage_designer(o.designer_id)));

-- Fabrics: the team can add fabrics, restock and approve/hide sellers' fabrics
drop policy if exists "fabrics: team adds" on public.fabrics;
create policy "fabrics: team adds" on public.fabrics
  for insert with check ((select public.wv_is_team()));
drop policy if exists "fabrics: team updates" on public.fabrics;
create policy "fabrics: team updates" on public.fabrics
  for update using ((select public.wv_is_team())) with check ((select public.wv_is_team()));

-- Suppliers: anyone signed in can open one shop of their own; the team can add and edit shops
drop policy if exists "suppliers: signed-in user opens own shop" on public.suppliers;
create policy "suppliers: signed-in user opens own shop" on public.suppliers
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
drop policy if exists "suppliers: team adds" on public.suppliers;
create policy "suppliers: team adds" on public.suppliers
  for insert with check ((select public.wv_is_team()));
drop policy if exists "suppliers: team updates" on public.suppliers;
create policy "suppliers: team updates" on public.suppliers
  for update using ((select public.wv_is_team())) with check ((select public.wv_is_team()));

-- Tailor team: only the Nebeda Threads team sees and edits it
drop policy if exists "tailors: team manages" on public.tailors;
create policy "tailors: team manages" on public.tailors
  for all using (public.can_manage_designer(designer_id)) with check (public.can_manage_designer(designer_id));

-- Wedding members: same people as the wedding order
drop policy if exists "wedding_order_members: team manages" on public.wedding_order_members;
create policy "wedding_order_members: team manages" on public.wedding_order_members
  for all using (wedding_order_id in (select w.id from public.wedding_orders w where public.can_manage_designer(w.designer_id)))
  with check (wedding_order_id in (select w.id from public.wedding_orders w where public.can_manage_designer(w.designer_id)));

-- Ready to wear: items are public; the team manages them
drop policy if exists "ready_to_wear_items: public read" on public.ready_to_wear_items;
create policy "ready_to_wear_items: public read" on public.ready_to_wear_items
  for select using (active or public.can_manage_designer(designer_id));
drop policy if exists "ready_to_wear_items: team manages" on public.ready_to_wear_items;
create policy "ready_to_wear_items: team manages" on public.ready_to_wear_items
  for all using (public.can_manage_designer(designer_id)) with check (public.can_manage_designer(designer_id));

-- Ready-to-wear sales: customers buy for themselves and see their own; the team sees all
drop policy if exists "ready_to_wear_sales: customer reads own" on public.ready_to_wear_sales;
create policy "ready_to_wear_sales: customer reads own" on public.ready_to_wear_sales
  for select using (customer_id in (select public.wv_my_customer_ids()));
drop policy if exists "ready_to_wear_sales: customer buys" on public.ready_to_wear_sales;
create policy "ready_to_wear_sales: customer buys" on public.ready_to_wear_sales
  for insert to authenticated with check (customer_id in (select public.wv_my_customer_ids()));
drop policy if exists "ready_to_wear_sales: team manages" on public.ready_to_wear_sales;
create policy "ready_to_wear_sales: team manages" on public.ready_to_wear_sales
  for all using ((select public.wv_is_team())) with check ((select public.wv_is_team()));

-- Fabric seller order lines: the seller sees their own and marks them sent; the team sees all
drop policy if exists "fabric_order_lines: seller reads own" on public.fabric_order_lines;
create policy "fabric_order_lines: seller reads own" on public.fabric_order_lines
  for select using (public.can_manage_supplier(supplier_id) or (select public.wv_is_team()));
drop policy if exists "fabric_order_lines: seller marks sent" on public.fabric_order_lines;
create policy "fabric_order_lines: seller marks sent" on public.fabric_order_lines
  for update using (public.can_manage_supplier(supplier_id) or (select public.wv_is_team()))
  with check (public.can_manage_supplier(supplier_id) or (select public.wv_is_team()));

-- Team invites: only the owner or an admin
drop policy if exists "designer_staff_invites: owner manages" on public.designer_staff_invites;
create policy "designer_staff_invites: owner manages" on public.designer_staff_invites
  for all using (
    exists (select 1 from public.designers d where d.id = designer_staff_invites.designer_id and d.owner_user_id = (select auth.uid()))
    or (select public.is_admin()))
  with check (
    exists (select 1 from public.designers d where d.id = designer_staff_invites.designer_id and d.owner_user_id = (select auth.uid()))
    or (select public.is_admin()));

-- Price list: anyone can read the prices; only the team can change them.
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

-- Table access for the API roles (Row Level Security still decides which rows)
grant select on public.ready_to_wear_items to anon, authenticated;
grant select, insert, update, delete on
  public.payments, public.tailors, public.wedding_order_members, public.ready_to_wear_items,
  public.ready_to_wear_sales, public.fabric_order_lines, public.designer_staff_invites
  to authenticated;

-- Internal helpers are not for calling from the app
revoke execute on function public.wv_refresh_order_payments(uuid) from public, anon, authenticated;
revoke execute on function public.wv_price_list_before_update() from public, anon, authenticated;
revoke execute on function public.wv_quote_lines(text, numeric, numeric, numeric, text, numeric, text, numeric, numeric)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Storage buckets for photos
-- ---------------------------------------------------------------------
-- Every upload goes in a folder named after the uploader's user id,
-- e.g. fabric-photos/<user id>/1727.jpg, so people can only change their own.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('fabric-photos', 'fabric-photos', true,  5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('seller-logos',  'seller-logos',  true,  2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('style-photos',  'style-photos',  false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Fabric photos and seller logos: anyone can view (public buckets);
-- signed-in people upload, replace and delete only in their own folder
drop policy if exists "wearvia: view fabric photos and logos" on storage.objects;
create policy "wearvia: view fabric photos and logos" on storage.objects
  for select using (bucket_id in ('fabric-photos', 'seller-logos'));

drop policy if exists "wearvia: upload own fabric photos and logos" on storage.objects;
create policy "wearvia: upload own fabric photos and logos" on storage.objects
  for insert to authenticated with check (
    bucket_id in ('fabric-photos', 'seller-logos')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "wearvia: replace own fabric photos and logos" on storage.objects;
create policy "wearvia: replace own fabric photos and logos" on storage.objects
  for update to authenticated using (
    bucket_id in ('fabric-photos', 'seller-logos')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "wearvia: delete own fabric photos and logos" on storage.objects;
create policy "wearvia: delete own fabric photos and logos" on storage.objects
  for delete to authenticated using (
    bucket_id in ('fabric-photos', 'seller-logos')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Customers' style photos are private: only the customer and the Nebeda Threads team can see them
drop policy if exists "wearvia: customers upload own style photos" on storage.objects;
create policy "wearvia: customers upload own style photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'style-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "wearvia: customers and team view style photos" on storage.objects;
create policy "wearvia: customers and team view style photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'style-photos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.wv_is_team())));

drop policy if exists "wearvia: customers delete own style photos" on storage.objects;
create policy "wearvia: customers delete own style photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'style-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text);


-- ---------------------------------------------------------------------
-- 8. Functions the app calls
-- ---------------------------------------------------------------------

-- Called by the app every time someone signs in. Sets up their profile,
-- their customer record (and links a walk-in record with the same email),
-- claims any team login the owner added for their email, and says what
-- they are allowed to open.
create or replace function public.wearvia_bootstrap() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_user      auth.users%rowtype;
  v_meta      jsonb;
  v_type      text;
  v_name      text;
  v_phone     text;
  v_confirmed boolean;
  v_customer  uuid;
  v_supplier  uuid;
  v_designer  uuid;
  v_role      text;
  v_invite    record;
begin
  if v_uid is null then
    raise exception 'Please sign in first.';
  end if;
  select * into v_user from auth.users where id = v_uid;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
  v_type := case when v_meta->>'account_type' = 'seller' then 'seller' else 'customer' end;
  v_name := nullif(trim(coalesce(v_meta->>'full_name', '')), '');
  v_phone := nullif(trim(coalesce(v_meta->>'phone', '')), '');
  v_confirmed := v_user.email_confirmed_at is not null;

  -- Profile (another sign-up trigger may already have made it)
  insert into public.profiles (id, email, full_name, role)
  values (v_uid, v_user.email, coalesce(v_name, split_part(v_user.email, '@', 1)),
          (case when v_type = 'seller' then 'supplier' else 'customer' end)::public.user_role)
  on conflict (id) do nothing;
  update public.profiles set full_name = coalesce(full_name, v_name), email = coalesce(email, v_user.email)
  where id = v_uid and (full_name is null or email is null);
  -- A new seller's profile says "supplier". An existing role is never lowered,
  -- and if the database's role lock refuses the change, that's fine too.
  if v_type = 'seller' then
    begin
      update public.profiles set role = 'supplier'::public.user_role
      where id = v_uid and role::text = 'customer';
    exception when others then
      null;
    end;
  end if;

  -- Team logins the owner added for this email (only once the email is confirmed)
  if v_confirmed then
    for v_invite in
      select * from public.designer_staff_invites i where lower(i.email) = lower(v_user.email)
    loop
      insert into public.designer_staff (designer_id, user_id, job_role)
      select v_invite.designer_id, v_uid, v_invite.job_role
      where not exists (select 1 from public.designer_staff s
                        where s.designer_id = v_invite.designer_id and s.user_id = v_uid);
      delete from public.designer_staff_invites where id = v_invite.id;
    end loop;
  end if;

  -- Customer record: link one the shop made with the same email, or make a new one
  select id into v_customer from public.customers where auth_user_id = v_uid order by created_at limit 1;
  if v_customer is null and v_confirmed then
    update public.customers set auth_user_id = v_uid
    where id = (select c.id from public.customers c
                where c.auth_user_id is null and lower(c.email) = lower(v_user.email)
                order by c.created_at limit 1)
    returning id into v_customer;
  end if;
  if v_customer is null and not public.wv_is_team() then
    insert into public.customers (auth_user_id, name, email, phone, created_at)
    values (v_uid, coalesce(v_name, split_part(v_user.email, '@', 1)), v_user.email, v_phone, now())
    returning id into v_customer;
  end if;

  select id into v_supplier from public.suppliers where owner_user_id = v_uid order by created_at limit 1;
  select role::text into v_role from public.profiles where id = v_uid;
  v_designer := public.wv_main_designer_id();

  return jsonb_build_object(
    'user_id', v_uid,
    'email', v_user.email,
    'name', coalesce((select full_name from public.profiles where id = v_uid), v_name, v_user.email),
    'account_type', v_type,
    'role', v_role,
    'is_admin', public.is_admin(),
    'is_owner', public.wv_is_owner(),
    'is_team', public.wv_is_team(),
    'job_role', (select s.job_role from public.designer_staff s where s.user_id = v_uid limit 1),
    'designer_id', v_designer,
    'customer_id', v_customer,
    'supplier_id', v_supplier
  );
end $$;

-- The owner adds a team login by email. If the person already has an account
-- they get access straight away; otherwise the next time they sign in.
create or replace function public.wearvia_add_team_member(p_email text, p_job_role text default 'staff')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_designer uuid := public.wv_main_designer_id();
  v_email    text := lower(trim(p_email));
  v_user     uuid;
begin
  if not public.wv_is_owner() then
    raise exception 'Only the owner can add team members.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right.';
  end if;
  select id into v_user from auth.users where lower(email) = v_email and email_confirmed_at is not null limit 1;
  if v_user is not null then
    insert into public.designer_staff (designer_id, user_id, job_role)
    select v_designer, v_user, coalesce(nullif(trim(p_job_role), ''), 'staff')
    where not exists (select 1 from public.designer_staff s where s.designer_id = v_designer and s.user_id = v_user);
    return 'added';
  end if;
  insert into public.designer_staff_invites (designer_id, email, job_role)
  values (v_designer, v_email, coalesce(nullif(trim(p_job_role), ''), 'staff'))
  on conflict (designer_id, lower(email)) do update set job_role = excluded.job_role;
  return 'invited';
end $$;

-- The team's logins, for the Tailor Team page
create or replace function public.wearvia_team_logins()
returns table (kind text, id uuid, email text, name text, job_role text)
language sql stable security definer set search_path = public as $$
  select 'owner', d.owner_user_id, p.email, p.full_name, 'owner'
  from public.designers d left join public.profiles p on p.id = d.owner_user_id
  where public.wv_is_team() and d.id = public.wv_main_designer_id() and d.owner_user_id is not null
  union all
  select 'staff', s.id, p.email, p.full_name, s.job_role
  from public.designer_staff s left join public.profiles p on p.id = s.user_id
  where public.wv_is_team() and s.designer_id = public.wv_main_designer_id()
  union all
  select 'invite', i.id, i.email, null, i.job_role
  from public.designer_staff_invites i
  where public.wv_is_team() and i.designer_id = public.wv_main_designer_id()
$$;

revoke execute on function public.wearvia_bootstrap() from public, anon;
grant execute on function public.wearvia_bootstrap() to authenticated;
revoke execute on function public.wearvia_add_team_member(text, text) from public, anon;
grant execute on function public.wearvia_add_team_member(text, text) to authenticated;
revoke execute on function public.wearvia_team_logins() from public, anon;
grant execute on function public.wearvia_team_logins() to authenticated;


-- ---------------------------------------------------------------------
-- 9. Owner set-up (run by you in the SQL Editor — the app can't call it)
-- ---------------------------------------------------------------------
-- Makes an existing account the admin and the owner of Nebeda Threads.
create or replace function public.wearvia_make_owner(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid;
  v_designer uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'No account uses % yet. Sign up in the Wearvia app with that email first, then run this again.', p_email;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (v_user, lower(trim(p_email)), split_part(p_email, '@', 1), 'admin'::public.user_role)
  on conflict (id) do nothing;
  begin
    update public.profiles set role = 'admin'::public.user_role where id = v_user;
  exception when others then
    -- The profiles "role locked" trigger only lets admins change roles, and
    -- nobody is an admin yet. Switch triggers off for this one change.
    alter table public.profiles disable trigger user;
    update public.profiles set role = 'admin'::public.user_role where id = v_user;
    alter table public.profiles enable trigger user;
  end;

  v_designer := public.wv_main_designer_id();
  if v_designer is null then
    insert into public.designers (business_name, location, rating, speciality_tags, commission_rate, owner_user_id, approved, delivery_estimate)
    values ('Nebeda Threads', 'Gillingham, Kent', 5, array['Agbada', 'Wedding', 'Bespoke'], 0, v_user, true, '7–14 days')
    returning id into v_designer;
  else
    update public.designers set owner_user_id = v_user, approved = true where id = v_designer;
  end if;
  return 'Done: ' || p_email || ' is now the admin and the owner of '
         || (select business_name from public.designers where id = v_designer) || '.';
end $$;

revoke execute on function public.wearvia_make_owner(text) from public, anon, authenticated;


-- =====================================================================
-- FINAL STEP — make your account the admin and Nebeda Threads owner
-- =====================================================================
-- 1. Open the Wearvia app and create an account with
--    oyekanbenjamen@gmail.com (choose "Customer"). Confirm the email.
-- 2. Back here in the SQL Editor, open a NEW query, paste this one line
--    and press Run:
--
--      select public.wearvia_make_owner('oyekanbenjamen@gmail.com');
--
--    It should say "Done: … is now the admin and the owner of Nebeda Threads."
-- 3. Sign out of the app and sign in again. The "Business" tab appears.
-- =====================================================================
