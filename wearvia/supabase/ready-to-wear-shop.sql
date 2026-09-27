-- Ready-to-wear storefront fields
-- Safe to run more than once.

alter table public.ready_to_wear_items
  add column if not exists category text not null default 'Other',
  add column if not exists description text not null default '',
  add column if not exists sizes text[] not null default '{}',
  add column if not exists sku text not null default '',
  add column if not exists featured boolean not null default false;

create index if not exists ready_to_wear_designer_active_idx
  on public.ready_to_wear_items (designer_id, active, created_at desc);

notify pgrst, 'reload schema';
