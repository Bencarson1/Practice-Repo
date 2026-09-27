-- NebedaHub homepage manager
create table if not exists public.homepage_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.homepage_settings enable row level security;

drop policy if exists "homepage settings are public" on public.homepage_settings;
create policy "homepage settings are public"
on public.homepage_settings for select
to anon, authenticated
using (true);

drop policy if exists "admins manage homepage settings" on public.homepage_settings;
create policy "admins manage homepage settings"
on public.homepage_settings for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('homepage-images','homepage-images', true)
on conflict (id) do update set public = true;

drop policy if exists "homepage images public read" on storage.objects;
create policy "homepage images public read"
on storage.objects for select
to public
using (bucket_id = 'homepage-images');

drop policy if exists "admins upload homepage images" on storage.objects;
create policy "admins upload homepage images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'homepage-images' and public.is_admin());

drop policy if exists "admins update homepage images" on storage.objects;
create policy "admins update homepage images"
on storage.objects for update
to authenticated
using (bucket_id = 'homepage-images' and public.is_admin())
with check (bucket_id = 'homepage-images' and public.is_admin());

drop policy if exists "admins delete homepage images" on storage.objects;
create policy "admins delete homepage images"
on storage.objects for delete
to authenticated
using (bucket_id = 'homepage-images' and public.is_admin());

insert into public.homepage_settings(key,value) values
('hero_title','Design it. Find the fabric. Choose the tailor.'),
('hero_text','NebedaHub brings custom fashion, trusted tailors and marketplace fabrics into one connected order.'),
('hero_image','https://images.unsplash.com/photo-1648328414427-fc902f51808c?auto=format&fit=crop&w=1600&q=88'),
('category_agbada','https://images.unsplash.com/photo-1782566208081-6b5135fddf23?auto=format&fit=crop&w=700&q=82'),
('category_kaftan','https://images.unsplash.com/photo-1776880470534-2e19345ab02b?auto=format&fit=crop&w=700&q=82'),
('category_senator','https://images.unsplash.com/photo-1775754787083-238dd19e1545?auto=format&fit=crop&w=700&q=82'),
('category_bubu','https://images.unsplash.com/photo-1663044022557-7d5d4c1d5318?auto=format&fit=crop&w=700&q=82'),
('category_two_piece','https://images.unsplash.com/photo-1663043994777-7ed4b4e6cba3?auto=format&fit=crop&w=700&q=82'),
('category_dress','https://images.unsplash.com/photo-1648328414427-fc902f51808c?auto=format&fit=crop&w=700&q=82'),
('category_wedding','https://images.unsplash.com/photo-1648328414427-fc902f51808c?auto=format&fit=crop&w=700&q=82'),
('category_suit','https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=700&q=82'),
('category_order','Agbada,Kaftan,Senator,Bubu,Two Piece,Dress,Wedding,Suit'),
('hidden_categories','')
on conflict (key) do nothing;
