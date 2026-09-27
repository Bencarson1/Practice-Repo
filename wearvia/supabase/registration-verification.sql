-- NebedaHub tailor and seller registration verification
-- Safe to run more than once.

alter table public.designers
  add column if not exists owner_name text not null default '',
  add column if not exists verification_id_path text,
  add column if not exists verification_address_path text,
  add column if not exists business_registration_path text,
  add column if not exists verification_submitted_at timestamptz;

alter table public.suppliers
  add column if not exists business_description text not null default '',
  add column if not exists delivery_areas text not null default '',
  add column if not exists verification_id_path text,
  add column if not exists verification_address_path text,
  add column if not exists business_registration_path text,
  add column if not exists verification_submitted_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-files','verification-files',false,10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "wearvia: upload own verification files" on storage.objects;
create policy "wearvia: upload own verification files"
on storage.objects for insert to authenticated
with check (
  bucket_id='verification-files'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists "wearvia: view verification files" on storage.objects;
create policy "wearvia: view verification files"
on storage.objects for select to authenticated
using (
  bucket_id='verification-files'
  and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_admin()))
);

drop policy if exists "wearvia: delete own verification files" on storage.objects;
create policy "wearvia: delete own verification files"
on storage.objects for delete to authenticated
using (
  bucket_id='verification-files'
  and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_admin()))
);

grant update (
  owner_name, verification_id_path, verification_address_path,
  business_registration_path, verification_submitted_at
) on public.designers to authenticated;

grant insert (
  business_description, delivery_areas, verification_id_path,
  verification_address_path, business_registration_path, verification_submitted_at
) on public.suppliers to authenticated;

grant update (
  business_description, delivery_areas, verification_id_path,
  verification_address_path, business_registration_path, verification_submitted_at
) on public.suppliers to authenticated;

create or replace function public.wearvia_set_designer_status(p_designer_id uuid, p_status text, p_note text default '')
returns text
language plpgsql security definer set search_path=public as $$
declare
  v_designer public.designers%rowtype;
begin
  if not public.is_admin() then raise exception 'Only the NebedaHub admin can approve or hide tailors.'; end if;
  if p_status not in ('approved','hidden','pending') then raise exception 'Unknown status %.', p_status; end if;
  select * into v_designer from public.designers where id=p_designer_id;
  if not found then raise exception 'That tailor was not found.'; end if;
  if p_status='approved' then
    if v_designer.owner_user_id is null then raise exception 'This tailor has no verified owner account and cannot be approved.'; end if;
    if v_designer.tailor_terms_accepted_at is null then raise exception '% has not accepted the NebedaHub tailor terms yet.', v_designer.business_name; end if;
    if nullif(trim(v_designer.owner_name),'') is null
       or nullif(trim(v_designer.address_line),'') is null
       or nullif(trim(v_designer.description),'') is null
       or cardinality(coalesce(v_designer.speciality_tags,'{}'))=0
       or v_designer.verification_id_path is null
       or v_designer.verification_address_path is null then
      raise exception '% has not completed the required identity and business verification yet.', v_designer.business_name;
    end if;
  end if;
  update public.designers
  set admin_status=p_status,
      admin_note=case when p_status='hidden' then left(coalesce(trim(p_note),''),500) else '' end
  where id=p_designer_id;
  return p_status;
end $$;

create or replace function public.wearvia_review_seller(p_supplier_id uuid, p_status text, p_note text default '')
returns text
language plpgsql security definer set search_path=public as $$
declare
  v_shop public.suppliers%rowtype;
begin
  if not public.is_admin() then raise exception 'Only the NebedaHub admin can review fabric sellers.'; end if;
  if p_status not in ('approved','declined','hidden','pending') then raise exception 'Unknown status %.', p_status; end if;
  select * into v_shop from public.suppliers where id=p_supplier_id;
  if not found then raise exception 'That fabric shop does not exist.'; end if;
  if p_status='approved' then
    if v_shop.owner_user_id is null then raise exception 'This fabric shop has no verified owner account and cannot be approved.'; end if;
    if v_shop.seller_terms_accepted_at is null then raise exception '% has not accepted the NebedaHub seller terms yet.', v_shop.name; end if;
    if nullif(trim(v_shop.contact_name),'') is null
       or nullif(trim(v_shop.address_line),'') is null
       or nullif(trim(v_shop.business_description),'') is null
       or nullif(trim(v_shop.delivery_areas),'') is null
       or v_shop.verification_id_path is null
       or v_shop.verification_address_path is null
       or cardinality(coalesce(v_shop.sample_photos,'{}')) < 2 then
      raise exception '% has not completed the required identity and business verification yet.', v_shop.name;
    end if;
  end if;
  perform set_config('wearvia.seller_review','on',true);
  update public.suppliers
  set admin_status=p_status,
      admin_note=case when p_status in ('declined','hidden') then left(coalesce(trim(p_note),''),500) else '' end,
      reviewed_at=now()
  where id=p_supplier_id;
  perform set_config('wearvia.seller_review','',true);
  return p_status;
end $$;

notify pgrst, 'reload schema';


-- Final approval checks also require the public business/profile photos.
create or replace function public.wearvia_set_designer_status(p_designer_id uuid, p_status text, p_note text default '')
returns text
language plpgsql security definer set search_path=public as $$
declare
  v_designer public.designers%rowtype;
  v_portfolio_count integer;
begin
  if not public.is_admin() then raise exception 'Only the NebedaHub admin can approve or hide tailors.'; end if;
  if p_status not in ('approved','hidden','pending') then raise exception 'Unknown status %.', p_status; end if;
  select * into v_designer from public.designers where id=p_designer_id;
  if not found then raise exception 'That tailor was not found.'; end if;
  if p_status='approved' then
    select count(*) into v_portfolio_count from public.designer_portfolio_items where designer_id=p_designer_id;
    if v_designer.owner_user_id is null then raise exception 'This tailor has no verified owner account and cannot be approved.'; end if;
    if v_designer.tailor_terms_accepted_at is null then raise exception '% has not accepted the NebedaHub tailor terms yet.', v_designer.business_name; end if;
    if nullif(trim(v_designer.owner_name),'') is null
       or nullif(trim(v_designer.address_line),'') is null
       or nullif(trim(v_designer.description),'') is null
       or cardinality(coalesce(v_designer.speciality_tags,'{}'))=0
       or v_designer.profile_image_url is null
       or v_portfolio_count < 2
       or v_designer.verification_id_path is null
       or v_designer.verification_address_path is null then
      raise exception '% has not completed the required identity, profile and work verification yet.', v_designer.business_name;
    end if;
  end if;
  update public.designers
  set admin_status=p_status,
      admin_note=case when p_status='hidden' then left(coalesce(trim(p_note),''),500) else '' end
  where id=p_designer_id;
  return p_status;
end $$;

create or replace function public.wearvia_review_seller(p_supplier_id uuid, p_status text, p_note text default '')
returns text
language plpgsql security definer set search_path=public as $$
declare
  v_shop public.suppliers%rowtype;
begin
  if not public.is_admin() then raise exception 'Only the NebedaHub admin can review fabric sellers.'; end if;
  if p_status not in ('approved','declined','hidden','pending') then raise exception 'Unknown status %.', p_status; end if;
  select * into v_shop from public.suppliers where id=p_supplier_id;
  if not found then raise exception 'That fabric shop does not exist.'; end if;
  if p_status='approved' then
    if v_shop.owner_user_id is null then raise exception 'This fabric shop has no verified owner account and cannot be approved.'; end if;
    if v_shop.seller_terms_accepted_at is null then raise exception '% has not accepted the NebedaHub seller terms yet.', v_shop.name; end if;
    if nullif(trim(v_shop.contact_name),'') is null
       or nullif(trim(v_shop.address_line),'') is null
       or nullif(trim(v_shop.business_description),'') is null
       or nullif(trim(v_shop.delivery_areas),'') is null
       or v_shop.logo_url is null
       or v_shop.verification_id_path is null
       or v_shop.verification_address_path is null
       or cardinality(coalesce(v_shop.sample_photos,'{}')) < 2 then
      raise exception '% has not completed the required identity, business and photo verification yet.', v_shop.name;
    end if;
  end if;
  perform set_config('wearvia.seller_review','on',true);
  update public.suppliers
  set admin_status=p_status,
      admin_note=case when p_status in ('declined','hidden') then left(coalesce(trim(p_note),''),500) else '' end,
      reviewed_at=now()
  where id=p_supplier_id;
  perform set_config('wearvia.seller_review','',true);
  return p_status;
end $$;

notify pgrst, 'reload schema';
