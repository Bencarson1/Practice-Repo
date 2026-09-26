-- =====================================================================
-- NebedaHub — fabric sellers: their own app, applications and orders
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it after setup.sql, yards.sql, prices.sql, tailor-quote.sql,
-- tailors-near-me.sql, no-leakage.sql and worldwide.sql, and BEFORE you
-- merge the app update (NebedaHub Sellers at nebedahub.com/sellers/).
--
-- What it does:
--   1. Seller applications. A fabric shop now has a status, like a tailor:
--      pending (application submitted, the NebedaHub team is reviewing),
--      approved, declined (with a note saying what to change) or hidden.
--      The application keeps the contact name, phone, email, address,
--      what they sell, up to 5 sample photos and the seller terms.
--      EVERY SHOP ALREADY IN THE DATABASE IS APPROVED, so today's fabric
--      marketplace doesn't change (the report checks this).
--   2. Customers and tailors only see fabrics from APPROVED shops. A new
--      seller can add fabrics while they wait; nobody else sees them.
--   3. Roles are kept apart, in the database: fabric-selling tools only
--      work for the shop's own account (or the admin). A tailor can't add
--      or change fabrics, approve anything, or move a seller's order
--      along — even on their own orders. Being a tailor and a seller are
--      two separate approvals (the Business app already asks tailors to
--      apply and wait; this does the same for sellers).
--   4. Sellers' contact details stay private: the phone, email, address,
--      contact name, what they sell, sample photos and the admin's note
--      can only be read by the seller themselves and the admin
--      (wearvia_my_suppliers()). Shop names, areas and fabric names and
--      descriptions go through the same contact-details filter as tailors.
--   5. Seller orders: New → Stock confirmed → Dispatched, with the courier,
--      tracking number and an optional photo of the parcel. Fabric goes to
--      the customer's tailor; their address is only given to the seller
--      once the customer's deposit is confirmed (wearvia_seller_deliveries()),
--      and a line can only be dispatched then. Sending straight to the
--      customer is ready in the database (ship_to = 'customer') but
--      switched off for now, so customers' addresses stay private.
--   6. A private photo bucket, "seller-files", for application photos and
--      dispatch photos: the seller, the admin and (for a dispatch photo)
--      the tailor whose order it is can open them.
--   7. A report at the end. It tries everything for real with your own
--      accounts — a tailor applies to sell, adds a fabric, the public
--      can't see it, the admin approves, the seller dispatches — and then
--      undoes it. Every line should say OK, ending with "ALL DONE — OK".
--
-- Safe to run more than once. Nothing is deleted. Existing orders,
-- invoices, payments, fabrics and seller order lines are never changed
-- (the report checks this). Everything runs in one transaction: if any
-- step fails, nothing is changed.
--
-- Only the publishable key is used by the apps. Never put the secret key
-- in the app.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. A copy of what must not change, for the report at the end
-- ---------------------------------------------------------------------
drop table if exists pg_temp.wv_sel_before;
create temp table wv_sel_before as
  select 'order' as kind, id::text as id, md5(row(designer_id, customer_id, fabric_id, fabric_yards, fabric_cost, quote_total,
           deposit_amount, deposit_paid_at, stage, quote_status)::text) as fingerprint from public.orders
  union all select 'invoice', id::text, md5(row(order_id, total, line_items)::text) from public.invoices
  union all select 'payment', id::text, md5(row(order_id, amount, status)::text) from public.payments
  union all select 'fabric', id::text, md5(row(supplier_id, price_per_yard, yards_available, status, deleted_at)::text) from public.fabrics
  union all select 'seller line', id::text, md5(row(supplier_id, yards, price_per_yard, total, status)::text) from public.fabric_order_lines;
-- The fabrics customers can see today: they must all still be visible afterwards
drop table if exists pg_temp.wv_sel_live_fabrics;
create temp table wv_sel_live_fabrics as
  select id from public.fabrics where status = 'approved' and deleted_at is null;


-- ---------------------------------------------------------------------
-- 1. Seller applications: a status and the application on each shop
-- ---------------------------------------------------------------------
-- The status is added as "approved" first, so every shop already in the
-- database is approved; new shops then start as "pending".
alter table public.suppliers add column if not exists admin_status text not null default 'approved';
alter table public.suppliers alter column admin_status set default 'pending';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_admin_status_check_wv') then
    alter table public.suppliers add constraint suppliers_admin_status_check_wv
      check (admin_status in ('pending', 'approved', 'declined', 'hidden'));
  end if;
end $$;
alter table public.suppliers add column if not exists admin_note     text        not null default '';   -- what the admin says to the seller
alter table public.suppliers add column if not exists submitted_at   timestamptz;
alter table public.suppliers add column if not exists reviewed_at    timestamptz;
alter table public.suppliers add column if not exists contact_name   text        not null default '';
alter table public.suppliers add column if not exists email          text        not null default '';
alter table public.suppliers add column if not exists address_line   text        not null default '';
alter table public.suppliers add column if not exists city           text        not null default '';
alter table public.suppliers add column if not exists postcode       text        not null default '';
alter table public.suppliers add column if not exists sells          text        not null default '';   -- "what do you sell?"
alter table public.suppliers add column if not exists sample_photos  text[]      not null default '{}'; -- paths in the seller-files bucket
alter table public.suppliers add column if not exists seller_terms_accepted_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_sample_photos_check_wv') then
    alter table public.suppliers add constraint suppliers_sample_photos_check_wv check (cardinality(sample_photos) <= 5);
  end if;
end $$;
create index if not exists suppliers_owner_idx_wv on public.suppliers (owner_user_id);


-- ---------------------------------------------------------------------
-- 2. Seller orders: stock confirmed, dispatched, tracking, where it goes
-- ---------------------------------------------------------------------
alter table public.fabric_order_lines add column if not exists confirmed_at    timestamptz;
alter table public.fabric_order_lines add column if not exists courier         text not null default '';
alter table public.fabric_order_lines add column if not exists tracking_number text not null default '';
alter table public.fabric_order_lines add column if not exists dispatch_photo  text;          -- path in the seller-files bucket
alter table public.fabric_order_lines add column if not exists dispatch_note   text not null default '';
alter table public.fabric_order_lines add column if not exists ship_to         text not null default 'tailor';
do $$
declare
  c record;
begin
  -- The status can now also be "confirmed" (the seller has checked the stock).
  -- "sent" means dispatched.
  for c in select conname from pg_constraint
           where conrelid = 'public.fabric_order_lines'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%status%' and conname <> 'fabric_order_lines_status_check_wv'
  loop
    execute format('alter table public.fabric_order_lines drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'fabric_order_lines_status_check_wv') then
    alter table public.fabric_order_lines add constraint fabric_order_lines_status_check_wv
      check (status in ('new', 'confirmed', 'sent', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fabric_order_lines_ship_to_check_wv') then
    alter table public.fabric_order_lines add constraint fabric_order_lines_ship_to_check_wv
      check (ship_to in ('tailor', 'customer'));
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Small helpers
-- ---------------------------------------------------------------------

-- The shop's own account (not the admin): the only one with selling tools
create or replace function public.wv_owns_supplier(p_supplier_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.owner_user_id = auth.uid())
$$;

-- An approved shop: its approved fabrics are on the marketplace
create or replace function public.wv_supplier_is_live(p_supplier_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.admin_status = 'approved')
$$;

-- The shops whose fabric is in my orders (as a customer) or my team's orders (as a tailor)
create or replace function public.wv_my_order_supplier_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct f.supplier_id from public.orders o join public.fabrics f on f.id = o.fabric_id
  where o.id in (select public.wv_my_order_ids()) or o.id in (select public.wv_team_order_ids())
$$;

-- The contact-details filter keeps originals for sellers and fabrics too
do $$
declare
  c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.hidden_contact_details'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%source%' and conname <> 'hidden_contact_details_source_check_wv'
  loop
    execute format('alter table public.hidden_contact_details drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'hidden_contact_details_source_check_wv') then
    alter table public.hidden_contact_details add constraint hidden_contact_details_source_check_wv
      check (source in ('chat', 'profile', 'portfolio', 'service', 'review', 'order', 'delivery_address', 'seller', 'fabric'));
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4. Rules on writes (they run whatever the app sends)
-- ---------------------------------------------------------------------
-- "Trusted" below means the admin, the SQL Editor (no signed-in user) or
-- the database's own review functions (which set wearvia.seller_review).

create or replace function public.wv_suppliers_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_trusted boolean := auth.uid() is null or public.is_admin() or coalesce(current_setting('wearvia.seller_review', true), '') = 'on';
begin
  if not v_trusted then
    if tg_op = 'INSERT' then
      -- One shop per account; a new shop is an application
      if exists (select 1 from public.suppliers s where s.owner_user_id = auth.uid()) then
        raise exception 'You already have a fabric shop on NebedaHub.';
      end if;
      new.owner_user_id := auth.uid();
      new.rating := null;
      new.admin_status := 'pending';
      new.admin_note := '';
      new.reviewed_at := null;
      new.submitted_at := now();
      new.seller_terms_accepted_at := case when new.seller_terms_accepted_at is not null then now() end;
    else
      new.owner_user_id := old.owner_user_id;
      new.rating := old.rating;
      new.admin_status := old.admin_status;
      new.admin_note := old.admin_note;
      new.reviewed_at := old.reviewed_at;
      new.submitted_at := old.submitted_at;
      -- The terms can be accepted, never taken back
      new.seller_terms_accepted_at := coalesce(old.seller_terms_accepted_at,
                                               case when new.seller_terms_accepted_at is not null then now() end);
    end if;
    -- What customers and tailors see can't carry contact details
    if cardinality((public.wv_hide_contacts(concat_ws(' ', new.name, new.location, new.city))).kinds) > 0 then
      raise exception 'Your shop name and area can''t include a phone number, email, website or social handle.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
-- (the trigger itself was made by setup.sql; it now runs this version)

-- Fabric names and descriptions: the same contact-details filter as tailors' profiles
create or replace function public.wv_fabrics_no_leakage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' or new.description is distinct from old.description then
      new.description := public.wv_filter_and_keep('fabric', new.id, 'description', new.description);
    end if;
    if tg_op = 'INSERT' or new.name is distinct from old.name then
      new.name := public.wv_filter_and_keep('fabric', new.id, 'name', new.name);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists wv_fabrics_no_leakage on public.fabrics;
create trigger wv_fabrics_no_leakage before insert or update on public.fabrics
  for each row execute function public.wv_fabrics_no_leakage();

-- Seller order lines. The seller moves their own line along (New → Stock
-- confirmed → Dispatched) and adds the courier, tracking number and photo.
-- A tailor's team can only cancel (when an order is deleted). Nobody else
-- changes anything.
create or replace function public.wv_fabric_lines_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status   text := new.status;
  v_courier  text := coalesce(new.courier, '');
  v_tracking text := coalesce(new.tracking_number, '');
  v_photo    text := new.dispatch_photo;
  v_note     text := coalesce(new.dispatch_note, '');
  v_ship_to  text := coalesce(new.ship_to, 'tailor');
begin
  if auth.uid() is not null and not public.is_admin() then
    new := old;
    if public.wv_owns_supplier(old.supplier_id) then
      if v_status is distinct from old.status then
        if not ((old.status = 'new' and v_status in ('confirmed', 'sent')) or (old.status = 'confirmed' and v_status = 'sent')) then
          raise exception 'That order can''t go from % to %.', old.status, v_status;
        end if;
        new.status := v_status;
      end if;
      if old.status <> 'cancelled' then
        new.courier := left(trim(v_courier), 80);
        new.tracking_number := left(trim(v_tracking), 80);
        new.dispatch_photo := v_photo;
        new.dispatch_note := public.wv_filter_and_keep('seller', old.supplier_id, 'dispatch_note', left(trim(v_note), 500));
        new.ship_to := v_ship_to;
      end if;
      if new.ship_to = 'customer' then
        raise exception 'Sending fabric straight to the customer isn''t available yet. Please send it to their tailor.';
      end if;
      if new.status = 'sent' and old.status <> 'sent' then
        if new.tracking_number = '' then
          raise exception 'Add the tracking number before you mark the fabric as dispatched.';
        end if;
        if not exists (select 1 from public.orders o where o.id = old.order_id and o.deposit_paid_at is not null) then
          raise exception 'Wait until the customer''s deposit is confirmed before you send the fabric.';
        end if;
      end if;
    elsif v_status = 'cancelled' and old.order_id in (select public.wv_team_order_ids()) then
      new.status := 'cancelled';   -- the tailor deleted the order
    end if;
  end if;
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_at := now();
  end if;
  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.sent_at := now();
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  return new;
end $$;
-- (the trigger itself was made by setup.sql; it now runs this version)

-- An order can only use fabric that's on the marketplace (the admin and
-- the SQL Editor can do anything)
create or replace function public.wv_orders_fabric_on_market() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fabric_id is not null and (tg_op = 'INSERT' or new.fabric_id is distinct from old.fabric_id)
     and auth.uid() is not null and not public.is_admin()
     and not exists (select 1 from public.fabrics f
                     where f.id = new.fabric_id and f.status = 'approved' and f.deleted_at is null
                       and public.wv_supplier_is_live(f.supplier_id)) then
    raise exception 'That fabric isn''t available on NebedaHub. Please choose another.';
  end if;
  return new;
end $$;
drop trigger if exists wv_orders_fabric_on_market on public.orders;
create trigger wv_orders_fabric_on_market before insert or update of fabric_id on public.orders
  for each row execute function public.wv_orders_fabric_on_market();


-- ---------------------------------------------------------------------
-- 5. Who can see and change what (Row Level Security)
-- ---------------------------------------------------------------------

-- Shops: the public sees approved shops; a seller sees their own; customers
-- and tailors see the shops in their own orders; the admin sees all
drop policy if exists "suppliers public read" on public.suppliers;
drop policy if exists "suppliers: read live, own or admin" on public.suppliers;
create policy "suppliers: read live, own or admin" on public.suppliers
  for select using (
    admin_status = 'approved'
    or public.can_manage_supplier(id)
    or id in (select public.wv_my_order_supplier_ids()));

-- Fabrics: the public sees approved fabrics from approved shops; the rest as before
drop policy if exists "fabrics: read approved, own or team" on public.fabrics;
create policy "fabrics: read approved, own or team" on public.fabrics
  for select using (
    (status = 'approved' and deleted_at is null and public.wv_supplier_is_live(supplier_id))
    or public.can_manage_supplier(supplier_id)
    or (select public.is_admin())
    or id in (select public.wv_my_order_fabric_ids())
    or id in (select o.fabric_id from public.orders o where o.id in (select public.wv_team_order_ids())));

-- Seller order lines: the seller (and the admin) change them; the tailor
-- whose order it is can read them
drop policy if exists "fabric_order_lines: seller marks sent" on public.fabric_order_lines;
drop policy if exists "fabric_order_lines: seller updates own" on public.fabric_order_lines;
create policy "fabric_order_lines: seller updates own" on public.fabric_order_lines
  for update using (public.can_manage_supplier(supplier_id)) with check (public.can_manage_supplier(supplier_id));

-- Columns. The private ones are read with wearvia_my_suppliers() instead.
revoke all on public.suppliers from anon, authenticated;
grant select (id, name, location, city, delivery_estimate, rating, created_at, updated_at, owner_user_id, logo_url,
              country_code, currency_code, admin_status)
  on public.suppliers to anon, authenticated;
grant insert (id, name, location, city, delivery_estimate, phone, logo_url, owner_user_id, country_code, currency_code,
              contact_name, email, address_line, postcode, sells, sample_photos, seller_terms_accepted_at, created_at)
  on public.suppliers to authenticated;
grant update (name, location, city, delivery_estimate, phone, logo_url, country_code, currency_code,
              contact_name, email, address_line, postcode, sells, sample_photos, seller_terms_accepted_at)
  on public.suppliers to authenticated;

-- Seller order lines are made by the database when a quote is accepted;
-- from the app they can only be moved along
revoke insert, update, delete on public.fabric_order_lines from anon, authenticated;
grant update (status, courier, tracking_number, dispatch_photo, dispatch_note, ship_to) on public.fabric_order_lines to authenticated;


-- ---------------------------------------------------------------------
-- 6. Functions the apps call
-- ---------------------------------------------------------------------

-- A seller's own shop, all of it (the admin gets every shop)
create or replace function public.wearvia_my_suppliers() returns setof public.suppliers
language sql stable security definer set search_path = public as $$
  select s.* from public.suppliers s where public.can_manage_supplier(s.id) order by s.created_at
$$;

-- Where the seller sends each order: the customer's tailor. Their address
-- is only given once the customer's deposit is confirmed.
create or replace function public.wearvia_seller_deliveries()
returns table (line_id uuid, unlocked boolean, ship_to text, send_to_name text, send_to_address text)
language sql stable security definer set search_path = public as $$
  select l.id,
         o.deposit_paid_at is not null,
         l.ship_to,
         d.business_name,
         case when o.deposit_paid_at is not null and l.ship_to = 'tailor' then
           nullif(concat_ws(', ', nullif(trim(d.address_line), ''), nullif(trim(d.city), ''), nullif(trim(d.postcode), ''),
                            (select c.name from public.countries c where c.code = d.country_code)), '') end
  from public.fabric_order_lines l
  left join public.orders o on o.id = l.order_id
  left join public.designers d on d.id = o.designer_id
  where public.can_manage_supplier(l.supplier_id)
$$;

-- The admin approves, declines (with a note), hides or reopens a seller's application
create or replace function public.wearvia_review_seller(p_supplier_id uuid, p_status text, p_note text default '')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_shop public.suppliers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only the NebedaHub admin can review fabric sellers.';
  end if;
  if p_status not in ('approved', 'declined', 'hidden', 'pending') then
    raise exception 'Unknown status %.', p_status;
  end if;
  select * into v_shop from public.suppliers where id = p_supplier_id;
  if not found then
    raise exception 'That fabric shop doesn''t exist.';
  end if;
  if p_status = 'approved' and v_shop.admin_status <> 'approved' and v_shop.submitted_at is not null
     and v_shop.seller_terms_accepted_at is null then
    raise exception '% hasn''t accepted the NebedaHub seller terms yet.', v_shop.name;
  end if;
  perform set_config('wearvia.seller_review', 'on', true);
  update public.suppliers
     set admin_status = p_status,
         admin_note = case when p_status in ('declined', 'hidden') then left(coalesce(trim(p_note), ''), 500) else '' end,
         reviewed_at = now()
   where id = p_supplier_id;
  perform set_config('wearvia.seller_review', '', true);
  return p_status;
end $$;

-- A seller who was asked to change something sends their application again
create or replace function public.wearvia_resubmit_seller_application(p_supplier_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_shop public.suppliers%rowtype;
begin
  if not public.wv_owns_supplier(p_supplier_id) then
    raise exception 'That isn''t your fabric shop.';
  end if;
  select * into v_shop from public.suppliers where id = p_supplier_id;
  if v_shop.admin_status <> 'declined' then
    return v_shop.admin_status;
  end if;
  if v_shop.seller_terms_accepted_at is null then
    raise exception 'Please agree to the NebedaHub seller terms first.';
  end if;
  perform set_config('wearvia.seller_review', 'on', true);
  update public.suppliers set admin_status = 'pending', submitted_at = now() where id = p_supplier_id;
  perform set_config('wearvia.seller_review', '', true);
  return 'pending';
end $$;

revoke execute on function public.wearvia_my_suppliers() from public, anon;
grant execute on function public.wearvia_my_suppliers() to authenticated;
revoke execute on function public.wearvia_seller_deliveries() from public, anon;
grant execute on function public.wearvia_seller_deliveries() to authenticated;
revoke execute on function public.wearvia_review_seller(uuid, text, text) from public, anon;
grant execute on function public.wearvia_review_seller(uuid, text, text) to authenticated;
revoke execute on function public.wearvia_resubmit_seller_application(uuid) from public, anon;
grant execute on function public.wearvia_resubmit_seller_application(uuid) to authenticated;
revoke execute on function public.wv_suppliers_before_write() from public, anon, authenticated;
revoke execute on function public.wv_fabrics_no_leakage() from public, anon, authenticated;
revoke execute on function public.wv_fabric_lines_before_update() from public, anon, authenticated;
revoke execute on function public.wv_orders_fabric_on_market() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Application and dispatch photos: a private bucket
-- ---------------------------------------------------------------------
-- Each photo goes in a folder named after the seller's login
-- (seller-files/<user id>/…). The seller and the admin can open it; the
-- tailor can open the dispatch photo on their own order.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seller-files', 'seller-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.wv_team_can_see_seller_file(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fabric_order_lines l
                 where l.dispatch_photo = p_name and l.order_id in (select public.wv_team_order_ids()))
$$;
revoke execute on function public.wv_team_can_see_seller_file(text) from public, anon;
grant execute on function public.wv_team_can_see_seller_file(text) to authenticated;

drop policy if exists "wearvia: upload own seller files" on storage.objects;
create policy "wearvia: upload own seller files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'seller-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "wearvia: view seller files" on storage.objects;
create policy "wearvia: view seller files" on storage.objects
  for select to authenticated using (
    bucket_id = 'seller-files'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.is_admin())
         or public.wv_team_can_see_seller_file(name)));

drop policy if exists "wearvia: delete own seller files" on storage.objects;
create policy "wearvia: delete own seller files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'seller-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;

-- Tell the Supabase API about the new columns and functions straight away
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 8. Report — every line should say "OK", ending with "ALL DONE — OK"
-- ---------------------------------------------------------------------
-- Line 3 signs in as "nobody" (the public) for a moment. Lines 4 to 6 sign
-- in as your own accounts for a moment, try things and then undo them, so
-- they change nothing.
drop table if exists pg_temp.wv_sel_live;
create temp table wv_sel_live (n integer, check_name text, result text);
grant all on wv_sel_live to anon, authenticated;

-- 3. What the public can read
do $$
declare
  v_hidden_shops integer;
  v_private      boolean := false;
  v_fabrics      integer;
begin
  set local role anon;
  select count(*) into v_hidden_shops from public.suppliers where admin_status <> 'approved';
  begin
    perform phone from public.suppliers limit 1;
  exception when insufficient_privilege then
    v_private := true;
  end;
  select count(*) into v_fabrics from public.fabrics;
  reset role;
  insert into wv_sel_live values (3, 'The public sees approved shops only, and no seller phone numbers',
    case when v_hidden_shops = 0 and v_private then 'OK (' || v_fabrics || ' fabrics on the marketplace)'
         else 'NOT LOCKED — tell your developer' end);
end $$;

-- 4 to 6. A real tailor (or customer) account applies to sell fabric, and
-- a real seller and tailor try each other's tools — all undone afterwards
do $$
declare
  v_admin     uuid := (select p.id from public.profiles p where p.role::text = 'admin' order by p.created_at limit 1);
  -- A tailor who isn't the admin and has no fabric shop
  v_tailor    uuid := (select d.owner_user_id from public.designers d
                        where d.owner_user_id is not null and d.owner_user_id is distinct from v_admin
                          and not exists (select 1 from public.suppliers s where s.owner_user_id = d.owner_user_id)
                          and not exists (select 1 from public.profiles p where p.id = d.owner_user_id and p.role::text = 'admin')
                        order by d.created_at limit 1);
  -- The new seller: a customer account (no tailor business, no shop); if there's none, the tailor
  v_applicant uuid := coalesce(
    (select c.auth_user_id from public.customers c
      where c.auth_user_id is not null and c.auth_user_id is distinct from v_admin
        and not exists (select 1 from public.suppliers s where s.owner_user_id = c.auth_user_id)
        and not exists (select 1 from public.designers d where d.owner_user_id = c.auth_user_id)
        and not exists (select 1 from public.designer_staff x where x.user_id = c.auth_user_id)
        and not exists (select 1 from public.profiles p where p.id = c.auth_user_id and p.role::text = 'admin')
      order by c.created_at limit 1),
    v_tailor);
  v_designer  uuid;
  v_shop      uuid := gen_random_uuid();
  v_fabric    uuid := gen_random_uuid();
  v_customer  uuid := gen_random_uuid();
  v_order     uuid := gen_random_uuid();
  v_line      uuid := gen_random_uuid();
  v_other     uuid := (select s.id from public.suppliers s where s.admin_status = 'approved' order by s.created_at limit 1);
  v_n         integer;
  v_status    text;
  v_ok        boolean;
  v_err       text;
  v_apply_ok  boolean := false;
  v_hidden_ok boolean := false;
  v_approve_ok boolean := false;
  v_dispatch_ok boolean := false;
  v_tailor_ok boolean := false;
  v_seller_ok boolean := false;
  v_detail    text := '';
begin
  if v_admin is null or v_applicant is null then
    insert into wv_sel_live values
      (4, 'A new seller applies, adds a fabric, waits for approval (tried and undone)',
       'OK (skipped: needs an admin and at least one other account — run this file again once you have them)'),
      (5, 'Sellers dispatch their own orders only, with tracking, after the deposit (tried and undone)', 'OK (skipped: see line 4)'),
      (6, 'A tailor can''t use selling tools, and a seller can''t see other sellers'' orders (tried and undone)', 'OK (skipped: see line 4)');
    return;
  end if;
  begin
    -- The applicant applies (as themselves), asking to be approved straight away — they can't
    perform set_config('request.jwt.claims', json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.suppliers (id, name, location, city, delivery_estimate, owner_user_id, country_code,
                                  contact_name, phone, email, address_line, postcode, sells, seller_terms_accepted_at)
    values (v_shop, 'Report Test Lagos Wax', 'Balogun Market, Lagos', 'Lagos', '2–4 days', v_applicant, 'NG',
            'Report Test', '+234 800 000 0000', 'report-test@example.com', '1 Test Street', '100001', 'Ankara and lace', now());
    reset role;
    select admin_status into v_status from public.suppliers where id = v_shop;
    v_apply_ok := v_status = 'pending'
              and (select owner_user_id from public.suppliers where id = v_shop) = v_applicant
              and (select submitted_at from public.suppliers where id = v_shop) is not null;

    -- They add a fabric while they wait, and try to approve it themselves — they can't
    set local role authenticated;
    insert into public.fabrics (id, supplier_id, name, category, price_per_yard, yards_available, min_order_yards, status)
    values (v_fabric, v_shop, 'Report Test Ankara', 'Ankara', 6500, 40, 1, 'approved');
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_apply_ok := v_apply_ok and (select status from public.fabrics where id = v_fabric) = 'pending';

    -- The admin approves the fabric: it's still hidden, because the shop isn't approved yet
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    update public.fabrics set status = 'approved' where id = v_fabric;
    perform set_config('request.jwt.claims', '', true);
    set local role anon;
    select count(*) into v_n from public.fabrics where id = v_fabric;
    reset role;
    v_hidden_ok := v_n = 0;

    -- The admin approves the shop: now the public sees the fabric
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform public.wearvia_review_seller(v_shop, 'approved', '');
    perform set_config('request.jwt.claims', '', true);
    set local role anon;
    select count(*) into v_n from public.fabrics where id = v_fabric;
    reset role;
    v_approve_ok := v_n = 1 and (select admin_status from public.suppliers where id = v_shop) = 'approved';

    -- An order for that fabric (made directly, as the system) and its seller line
    select id into v_designer from public.designers where admin_status = 'approved' order by created_at limit 1;
    insert into public.customers (id, name) values (v_customer, 'Report Test Customer');
    insert into public.orders (id, customer_id, designer_id, outfit_type, colour, embroidery, fabric_id)
    values (v_order, v_customer, v_designer, 'Agbada', '#1e2a44', 'Gold', v_fabric);
    insert into public.fabric_order_lines (id, order_id, order_number, supplier_id, fabric_id, fabric_name, yards, price_per_yard, total)
    values (v_line, v_order, 'TEST-1', v_shop, v_fabric, 'Report Test Ankara', 4.5, 6500, 29250);

    -- The seller: confirm stock (fine), dispatch before the deposit (refused),
    -- send to the customer (refused), dispatch without tracking (refused),
    -- then dispatch properly once the deposit is confirmed
    perform set_config('request.jwt.claims', json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.fabric_order_lines set status = 'confirmed' where id = v_line;
    v_ok := true;
    begin
      update public.fabric_order_lines set status = 'sent', tracking_number = 'TRACK1' where id = v_line;
      v_ok := false;
    exception when others then null;
    end;
    begin
      update public.fabric_order_lines set ship_to = 'customer' where id = v_line;
      v_ok := false;
    exception when others then null;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    update public.orders set deposit_paid_at = now() where id = v_order;
    perform set_config('request.jwt.claims', json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      update public.fabric_order_lines set status = 'sent' where id = v_line;
      v_ok := false;
    exception when others then null;
    end;
    update public.fabric_order_lines set status = 'sent', courier = 'GIG Logistics', tracking_number = 'TRACK1' where id = v_line;
    select count(*) into v_n from public.wearvia_seller_deliveries() x where x.line_id = v_line and x.unlocked;
    reset role;
    v_dispatch_ok := v_ok and v_n = 1
                 and (select status from public.fabric_order_lines where id = v_line) = 'sent'
                 and (select tracking_number from public.fabric_order_lines where id = v_line) = 'TRACK1'
                 and (select confirmed_at from public.fabric_order_lines where id = v_line) is not null
                 and (select sent_at from public.fabric_order_lines where id = v_line) is not null;

    -- The seller can't see or change another seller's fabrics or orders
    set local role authenticated;
    select count(*) into v_n from public.fabric_order_lines
     where supplier_id is distinct from v_shop and order_id not in (select public.wv_team_order_ids());
    v_seller_ok := v_n = 0;
    if v_other is not null then
      update public.fabrics set price_per_yard = 1 where supplier_id = v_other;
      get diagnostics v_n = row_count;
      v_seller_ok := v_seller_ok and v_n = 0;
    end if;
    -- … nor approve or hide their own fabric
    update public.fabrics set status = 'hidden' where id = v_fabric;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_seller_ok := v_seller_ok and (select status from public.fabrics where id = v_fabric) = 'approved';

    -- A tailor: can't add fabric to any shop, change a seller's order, or approve a shop
    if v_tailor is not null and v_tailor <> v_applicant then
      perform set_config('request.jwt.claims', json_build_object('sub', v_tailor, 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_tailor_ok := true;
      begin
        insert into public.fabrics (supplier_id, name, category, price_per_yard, yards_available, min_order_yards)
        values (v_shop, 'Report Test Tailor Fabric', 'Ankara', 1, 1, 1);
        v_tailor_ok := false;
      exception when others then null;
      end;
      update public.fabric_order_lines set tracking_number = 'CHANGED' where id = v_line;
      update public.suppliers set name = 'Changed by a tailor' where id = v_shop;
      begin
        perform public.wearvia_review_seller(v_shop, 'hidden', 'x');
        v_tailor_ok := false;
      exception when others then null;
      end;
      reset role;
      v_tailor_ok := v_tailor_ok
                 and (select tracking_number from public.fabric_order_lines where id = v_line) = 'TRACK1'
                 and (select name from public.suppliers where id = v_shop) = 'Report Test Lagos Wax'
                 and (select admin_status from public.suppliers where id = v_shop) = 'approved';
    elsif v_tailor is null then
      v_tailor_ok := true;
      v_detail := ' (no tailor accounts yet, so the tailor part was skipped)';
    else
      -- The only other account was the tailor, and they've just applied to sell
      v_tailor_ok := true;
      v_detail := ' (the tailor part needs a customer account as well, so it was skipped)';
    end if;

    raise exception using errcode = 'P0001', message = 'wv_undo';
  exception when sqlstate 'P0001' then
    null;   -- everything above is undone
  when others then
    v_err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into wv_sel_live values
    (4, 'A new seller applies, adds a fabric, waits for approval (tried and undone)',
     case when v_err is not null then 'NOT WORKING — tell your developer (' || v_err || ')'
          when v_apply_ok and v_hidden_ok and v_approve_ok then 'OK (starts as pending, hidden until the admin approves the shop)'
          else 'NOT WORKING — tell your developer (applies ' || v_apply_ok || ', hidden ' || v_hidden_ok || ', approved ' || v_approve_ok || ')' end),
    (5, 'Sellers dispatch their own orders only, with tracking, after the deposit (tried and undone)',
     case when v_err is null and v_dispatch_ok then 'OK' else 'NOT WORKING — tell your developer' end),
    (6, 'A tailor can''t use selling tools, and a seller can''t see other sellers'' orders (tried and undone)',
     case when v_err is null and v_tailor_ok and v_seller_ok then 'OK' || v_detail
          else 'NOT LOCKED — tell your developer (tailor ' || v_tailor_ok || ', seller ' || v_seller_ok || ')' end);
end $$;

with checks as (
  select 1 as n, 'Existing orders, invoices, payments, fabrics and seller orders unchanged' as check_name,
         case when not exists (
                select kind, id, fingerprint from wv_sel_before
                except
                (select 'order', id::text, md5(row(designer_id, customer_id, fabric_id, fabric_yards, fabric_cost, quote_total,
                          deposit_amount, deposit_paid_at, stage, quote_status)::text) from public.orders
                 union all select 'invoice', id::text, md5(row(order_id, total, line_items)::text) from public.invoices
                 union all select 'payment', id::text, md5(row(order_id, amount, status)::text) from public.payments
                 union all select 'fabric', id::text, md5(row(supplier_id, price_per_yard, yards_available, status, deleted_at)::text) from public.fabrics
                 union all select 'seller line', id::text, md5(row(supplier_id, yards, price_per_yard, total, status)::text) from public.fabric_order_lines))
              then 'OK (' || (select count(*) from wv_sel_before where kind = 'order') || ' orders, '
                   || (select count(*) from wv_sel_before where kind = 'fabric') || ' fabrics, '
                   || (select count(*) from wv_sel_before where kind = 'seller line') || ' seller orders checked)'
              else 'CHANGED — tell your developer' end as result
  union all
  select 2, 'Every shop from before is approved, and every fabric customers could see is still on the marketplace',
         case when not exists (select 1 from wv_sel_live_fabrics l join public.fabrics f on f.id = l.id
                               where not public.wv_supplier_is_live(f.supplier_id))
              then 'OK (' || (select count(*) from public.suppliers where admin_status = 'approved') || ' shops approved, '
                   || (select count(*) from public.suppliers where admin_status = 'pending') || ' waiting for you, '
                   || (select count(*) from wv_sel_live_fabrics) || ' fabrics still live)'
              else 'CHECK — tell your developer' end
  union all
  select n, check_name, result from wv_sel_live
  union all
  select 7, 'Only the seller and the admin can read a seller''s contact details and application',
         case when not has_column_privilege('anon', 'public.suppliers', 'phone', 'select')
               and not has_column_privilege('authenticated', 'public.suppliers', 'phone', 'select')
               and not has_column_privilege('authenticated', 'public.suppliers', 'email', 'select')
               and not has_column_privilege('authenticated', 'public.suppliers', 'address_line', 'select')
               and not has_column_privilege('authenticated', 'public.suppliers', 'sample_photos', 'select')
               and not has_column_privilege('authenticated', 'public.suppliers', 'admin_note', 'select')
               and not has_column_privilege('authenticated', 'public.suppliers', 'admin_status', 'update')
               and not has_column_privilege('authenticated', 'public.suppliers', 'owner_user_id', 'update')
               and not has_table_privilege('authenticated', 'public.fabric_order_lines', 'insert')
               and not has_table_privilege('authenticated', 'public.fabric_order_lines', 'delete')
               and not has_column_privilege('authenticated', 'public.fabric_order_lines', 'total', 'update')
               and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'suppliers'
                               and cmd in ('SELECT', 'ALL') and (qual is null or trim(qual) = 'true'))
               and has_function_privilege('authenticated', 'public.wearvia_my_suppliers()', 'execute')
               and not has_function_privilege('anon', 'public.wearvia_my_suppliers()', 'execute')
               and not has_function_privilege('anon', 'public.wearvia_review_seller(uuid, text, text)', 'execute')
               and not has_function_privilege('anon', 'public.wearvia_seller_deliveries()', 'execute')
              then 'OK' else 'NOT LOCKED — tell your developer' end
  union all
  select 8, 'Application and dispatch photos are private',
         case when exists (select 1 from storage.buckets where id = 'seller-files' and not public)
               and (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname in ('wearvia: upload own seller files', 'wearvia: view seller files', 'wearvia: delete own seller files')) = 3
              then 'OK' else 'MISSING — tell your developer' end
  union all
  select 9, 'Every rule is switched on',
         case when exists (select 1 from pg_trigger where tgname = 'wv_suppliers_before_write' and tgrelid = 'public.suppliers'::regclass and tgenabled <> 'D')
               and exists (select 1 from pg_trigger where tgname = 'wv_fabric_lines_before_update' and tgrelid = 'public.fabric_order_lines'::regclass and tgenabled <> 'D')
               and exists (select 1 from pg_trigger where tgname = 'wv_fabrics_no_leakage' and tgrelid = 'public.fabrics'::regclass and tgenabled <> 'D')
               and exists (select 1 from pg_trigger where tgname = 'wv_orders_fabric_on_market' and tgrelid = 'public.orders'::regclass and tgenabled <> 'D')
               and (select relrowsecurity from pg_class where oid = 'public.suppliers'::regclass)
               and (select relrowsecurity from pg_class where oid = 'public.fabrics'::regclass)
               and (select relrowsecurity from pg_class where oid = 'public.fabric_order_lines'::regclass)
              then 'OK' else 'NOT SWITCHED ON — tell your developer' end
)
select check_name, result from (
  select n, check_name, result from checks
  union all
  select 99, 'ALL DONE', case when bool_and(result like 'OK%') then 'OK — you can merge the app update'
                              else 'Something above isn''t OK — don''t merge yet, tell your developer' end
  from checks
) report
order by n;
