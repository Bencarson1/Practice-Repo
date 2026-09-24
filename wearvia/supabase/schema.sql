-- ============================================================
-- Wearvia — Fabric Seller tables for Supabase (Postgres)
--
-- Not used yet: the app saves to the browser for now.
-- These tables match the browser data one-to-one, so moving over
-- means rewriting js/sellers-data.js and js/photos.js to call
-- Supabase instead of changing `db`:
--
--   db.suppliers     → fabric_sellers
--   db.fabrics       → fabrics (+ fabric_photos, photos in Storage)
--   db.fabric_orders → fabric_orders
-- ============================================================

create table fabric_sellers (
  id                text primary key,                     -- "S9"; use uuid in production
  owner_id          uuid references auth.users (id),      -- the seller's login
  name              text not null unique,                 -- shop name
  location          text not null,
  phone             text not null,
  delivery_estimate text not null,                        -- "Next day", "1–3 days", …
  logo_path         text,                                 -- Storage path in the "logos" bucket
  rating            numeric(2, 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table fabrics (
  id                text primary key,                     -- "F11"
  supplier_id       text not null references fabric_sellers (id),
  name              text not null,
  category          text not null,                        -- fabric type: Ankara, Lace, …
  colour_name       text not null,                        -- colour family customers filter by
  color             text not null,                        -- swatch hex
  price_per_metre   numeric(8, 2) not null check (price_per_metre >= 0.5),   -- £
  metres_available  numeric(8, 1) not null check (metres_available >= 0),
  min_order_metres  numeric(4, 1) not null default 1,
  description       text not null default '',
  status            text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  review_note       text not null default '',             -- why Nebeda Threads hid it
  reviewed_at       timestamptz,
  sold_out          boolean not null default false,
  deleted_at        timestamptz,                          -- soft delete keeps old orders readable
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Up to 5 photos per fabric, in order (position 0 is the cover)
create table fabric_photos (
  fabric_id    text not null references fabrics (id) on delete cascade,
  position     smallint not null check (position between 0 and 4),
  storage_path text not null,                             -- file in the "fabric-photos" bucket
  primary key (fabric_id, position)
);

create table fabric_orders (
  id              text primary key,                       -- "FO-1009"
  order_id        text not null,                          -- the customer's order, e.g. "NT-1009"
  seller_id       text not null references fabric_sellers (id),
  fabric_id       text not null references fabrics (id),
  fabric_name     text not null,                          -- copied so it survives edits
  metres          numeric(6, 1) not null,
  price_per_metre numeric(8, 2) not null,
  total           numeric(10, 2) not null,
  customer_id     text not null,
  deliver_to      text not null,
  status          text not null default 'new' check (status in ('new', 'sent', 'cancelled')),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index fabrics_market on fabrics (status, category) where deleted_at is null;
create index fabric_orders_seller on fabric_orders (seller_id, created_at desc);

-- Storage buckets (public read, so photos load quickly in the marketplace)
insert into storage.buckets (id, name, public) values ('fabric-photos', 'fabric-photos', true), ('logos', 'logos', true);

-- ---- Who can do what (row level security) ----
-- "staff" = Nebeda Threads; set app_metadata.role = 'staff' on their users.

alter table fabric_sellers enable row level security;
alter table fabrics        enable row level security;
alter table fabric_photos  enable row level security;
alter table fabric_orders  enable row level security;

create function is_staff() returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'staff'
$$;

create function my_seller_id() returns text language sql stable as $$
  select id from fabric_sellers where owner_id = auth.uid()
$$;

-- Everyone can see shops; sellers manage their own
create policy "shops are public"      on fabric_sellers for select using (true);
create policy "sellers create a shop" on fabric_sellers for insert with check (owner_id = auth.uid());
create policy "sellers edit their shop" on fabric_sellers for update using (owner_id = auth.uid());

-- Customers see approved fabrics; sellers see all of theirs; staff see everything
create policy "market shows approved" on fabrics for select
  using ((status = 'approved' and deleted_at is null) or supplier_id = my_seller_id() or is_staff());
-- New fabrics always start as 'pending' (sellers can't approve their own)
create policy "sellers add fabrics" on fabrics for insert
  with check (supplier_id = my_seller_id() and status = 'pending');
create policy "sellers edit fabrics" on fabrics for update
  using (supplier_id = my_seller_id()) with check (supplier_id = my_seller_id());
create policy "staff review fabrics" on fabrics for update using (is_staff());

create policy "photos follow fabric" on fabric_photos for select
  using (exists (select 1 from fabrics f where f.id = fabric_id));
create policy "sellers manage photos" on fabric_photos for all
  using (exists (select 1 from fabrics f where f.id = fabric_id and f.supplier_id = my_seller_id()));

create policy "sellers see their orders" on fabric_orders for select using (seller_id = my_seller_id() or is_staff());
create policy "sellers mark sent" on fabric_orders for update using (seller_id = my_seller_id());
create policy "staff create orders" on fabric_orders for insert with check (is_staff() or auth.uid() is not null);

-- Note: two rules are enforced in the app today (saveSellerFabric) and should
-- move into a BEFORE UPDATE trigger on fabrics so a seller can't skip them:
--   * a seller can't change status or review_note themselves (only staff can)
--   * changing name, category, colour, description or photos sets status back to 'pending';
--     price and stock changes keep it live
