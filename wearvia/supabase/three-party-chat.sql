-- NebedaHub three-party order chat
-- Customer + tailor/designer + fabric seller
-- Applied to production on 2026-09-28.

create or replace function public.wv_is_order_seller(p_order_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.fabric_order_lines l
    join public.suppliers s on s.id=l.supplier_id
    where l.order_id=p_order_id
      and s.owner_user_id=auth.uid()
      and l.status <> 'cancelled'
  )
$$;

create or replace function public.wv_seller_chat_name(p_order_id uuid) returns text
language sql stable security definer set search_path=public as $$
  select coalesce(s.name,'Fabric seller')
  from public.fabric_order_lines l
  join public.suppliers s on s.id=l.supplier_id
  where l.order_id=p_order_id and s.owner_user_id=auth.uid() and l.status <> 'cancelled'
  order by l.created_at limit 1
$$;

create or replace function public.wearvia_seller_chat_orders()
returns table(
  id uuid,
  order_number text,
  designer_id uuid,
  fabric_id uuid,
  fabric_supplier_id uuid,
  customer_first_name text,
  quote_status text,
  stage text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql stable security definer set search_path=public as $$
  select distinct o.id, o.order_number, o.designer_id, o.fabric_id, l.supplier_id,
         split_part(coalesce(c.name,'Customer'),' ',1),
         coalesce(o.quote_status,'accepted'),
         o.stage::text, o.created_at, o.updated_at
  from public.fabric_order_lines l
  join public.suppliers s on s.id=l.supplier_id
  join public.orders o on o.id=l.order_id
  left join public.customers c on c.id=o.customer_id
  where s.owner_user_id=auth.uid() and l.status <> 'cancelled'
  order by o.created_at desc
$$;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid='public.order_messages'::regclass
             and contype='c' and pg_get_constraintdef(oid) ilike '%sender_kind%'
  loop
    execute format('alter table public.order_messages drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.order_messages
  add constraint order_messages_sender_kind_check check (sender_kind in ('customer','team','seller','system'));

do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid='public.order_chat_reads'::regclass
             and contype='c' and pg_get_constraintdef(oid) ilike '%side%'
  loop
    execute format('alter table public.order_chat_reads drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.order_chat_reads
  add constraint order_chat_reads_side_check check (side in ('customer','team','seller'));

create or replace function public.wv_order_messages_before_insert() returns trigger
language plpgsql set search_path=public as $$
declare
  v_team boolean;
  v_uid uuid := auth.uid();
  v_path text;
begin
  new.created_at := now();
  new.body := trim(coalesce(new.body,''));
  new.photos := coalesce(new.photos,'{}');

  if current_user in ('authenticated','anon') then
    v_team := public.wv_is_team();
    new.sender_id := v_uid;

    if v_team then
      new.sender_kind := 'team';
      new.sender_name := public.wv_chat_name(true);
    elsif new.order_id in (select public.wv_my_order_ids()) then
      new.sender_kind := 'customer';
      new.sender_name := public.wv_chat_name(false);
    elsif public.wv_is_order_seller(new.order_id) then
      new.sender_kind := 'seller';
      new.sender_name := public.wv_seller_chat_name(new.order_id);
    else
      raise exception 'You are not part of this order chat.';
    end if;

    foreach v_path in array new.photos loop
      if v_path is null or split_part(v_path,'/',1) <> v_uid::text or v_path like '%..%' then
        raise exception 'That photo can''t be attached.';
      end if;
    end loop;
  end if;

  if new.body='' and cardinality(new.photos)=0 then
    raise exception 'Type a message or add a photo.';
  end if;
  return new;
end $$;

create or replace function public.wearvia_mark_chat_read(p_order_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_side text;
begin
  if public.wv_is_team()
     and exists(select 1 from public.orders o where o.id=p_order_id and public.can_manage_designer(o.designer_id)) then
    v_side := 'team';
  elsif p_order_id in (select public.wv_my_order_ids()) then
    v_side := 'customer';
  elsif public.wv_is_order_seller(p_order_id) then
    v_side := 'seller';
  else
    return;
  end if;

  insert into public.order_chat_reads(order_id,side,last_read_at)
  values(p_order_id,v_side,now())
  on conflict(order_id,side) do update set last_read_at=excluded.last_read_at;
end $$;

drop policy if exists "order_messages: customer or team reads" on public.order_messages;
drop policy if exists "order_messages: participants read" on public.order_messages;
create policy "order_messages: participants read" on public.order_messages
  for select to authenticated
  using (
    order_id in (select public.wv_my_order_ids())
    or (select public.wv_is_team())
    or public.wv_is_order_seller(order_id)
  );

drop policy if exists "order_messages: customer or team writes" on public.order_messages;
drop policy if exists "order_messages: participants write" on public.order_messages;
create policy "order_messages: participants write" on public.order_messages
  for insert to authenticated
  with check (
    order_id in (select public.wv_my_order_ids())
    or (select public.wv_is_team())
    or public.wv_is_order_seller(order_id)
  );

drop policy if exists "order_chat_reads: customer or team reads" on public.order_chat_reads;
drop policy if exists "order_chat_reads: participants read" on public.order_chat_reads;
create policy "order_chat_reads: participants read" on public.order_chat_reads
  for select to authenticated
  using (
    order_id in (select public.wv_my_order_ids())
    or (select public.wv_is_team())
    or public.wv_is_order_seller(order_id)
  );

create or replace function public.wv_can_see_chat_photo(p_name text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.order_messages m
    where p_name = any(m.photos)
      and (
        m.order_id in (select public.wv_my_order_ids())
        or public.wv_is_order_seller(m.order_id)
      )
  )
$$;

revoke execute on function public.wearvia_seller_chat_orders() from public, anon;
grant execute on function public.wearvia_seller_chat_orders() to authenticated;
revoke execute on function public.wv_is_order_seller(uuid) from public, anon;
grant execute on function public.wv_is_order_seller(uuid) to authenticated;

notify pgrst, 'reload schema';
