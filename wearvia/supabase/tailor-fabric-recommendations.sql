-- NebedaHub: tailor marketplace fabric recommendations.
-- Tailor recommends 1-3 approved fabrics before quoting; customer chooses one.

alter table public.orders
  add column if not exists fabric_plan text not null default 'marketplace';

do $
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_fabric_plan_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_fabric_plan_check
      check (fabric_plan in ('marketplace','recommend','own','later'));
  end if;
end $;

create table if not exists public.fabric_recommendations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  fabric_id uuid not null references public.fabrics(id),
  designer_id uuid not null references public.designers(id),
  recommended_by uuid not null default auth.uid(),
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending','selected','replaced','dismissed')),
  created_at timestamptz not null default now(),
  selected_at timestamptz
);

create index if not exists fabric_recommendations_order_idx
  on public.fabric_recommendations(order_id, created_at desc);
create index if not exists fabric_recommendations_fabric_idx
  on public.fabric_recommendations(fabric_id);

alter table public.fabric_recommendations enable row level security;

drop policy if exists "fabric recommendations: customer or team reads" on public.fabric_recommendations;
create policy "fabric recommendations: customer or team reads"
on public.fabric_recommendations
for select to authenticated
using (
  order_id in (select public.wv_my_order_ids())
  or order_id in (select public.wv_team_order_ids())
);

revoke insert, update, delete on public.fabric_recommendations from anon, authenticated;
grant select on public.fabric_recommendations to authenticated;

create or replace function public.wearvia_recommend_fabrics(
  p_order_id uuid,
  p_fabric_ids uuid[],
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_batch uuid := gen_random_uuid();
  v_ids uuid[];
  v_count integer;
  v_names text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then raise exception 'Order not found'; end if;
  if not public.can_manage_designer(v_order.designer_id) then
    raise exception 'You do not have permission to recommend fabric for this order';
  end if;
  if coalesce(v_order.quote_status, 'accepted') <> 'requested' then
    raise exception 'Fabric recommendations can only be changed before a quote is sent';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_fabric_ids, '{}'::uuid[])) x;
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count < 1 or v_count > 3 then
    raise exception 'Choose between 1 and 3 fabrics to recommend';
  end if;

  if (
    select count(*) from public.fabrics f
    where f.id = any(v_ids)
      and f.status = 'approved'
      and f.deleted_at is null
      and not f.sold_out
      and f.yards_available >= greatest(coalesce(f.min_order_yards, 1), 0.01)
      and public.wv_supplier_is_live(f.supplier_id)
  ) <> v_count then
    raise exception 'One or more selected fabrics are no longer available';
  end if;

  update public.fabric_recommendations
  set status = 'replaced'
  where order_id = p_order_id and status = 'pending';

  insert into public.fabric_recommendations
    (batch_id, order_id, fabric_id, designer_id, recommended_by, note)
  select v_batch, p_order_id, f.id, v_order.designer_id, auth.uid(),
         left(coalesce(trim(p_note), ''), 500)
  from public.fabrics f where f.id = any(v_ids);

  select string_agg(f.name, ', ' order by f.name) into v_names
  from public.fabrics f where f.id = any(v_ids);

  insert into public.order_messages(order_id, sender_kind, sender_id, sender_name, body)
  values (
    p_order_id, 'system', null, 'NebedaHub',
    case when v_count = 1
      then 'Your tailor recommended a fabric from the NebedaHub marketplace: ' || v_names || '. Open the recommendation in your order to review and choose it.'
      else 'Your tailor recommended ' || v_count || ' fabrics from the NebedaHub marketplace: ' || v_names || '. Open the recommendations in your order and choose the one you prefer.'
    end
  );

  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', v_count);
end;
$$;

create or replace function public.wearvia_choose_recommended_fabric(
  p_order_id uuid,
  p_recommendation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_rec public.fabric_recommendations%rowtype;
  v_fabric public.fabrics%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then raise exception 'Order not found'; end if;
  if not (p_order_id in (select public.wv_my_order_ids())) then
    raise exception 'You do not have permission to choose fabric for this order';
  end if;
  if coalesce(v_order.quote_status, 'accepted') <> 'requested' then
    raise exception 'This order already has a quote. Ask the tailor in chat before changing fabric';
  end if;

  select * into v_rec
  from public.fabric_recommendations
  where id = p_recommendation_id
    and order_id = p_order_id
    and status = 'pending';
  if v_rec.id is null then raise exception 'That recommendation is no longer available'; end if;

  select * into v_fabric from public.fabrics where id = v_rec.fabric_id;
  if v_fabric.id is null
     or v_fabric.status <> 'approved'
     or v_fabric.deleted_at is not null
     or v_fabric.sold_out
     or v_fabric.yards_available < greatest(coalesce(v_fabric.min_order_yards, 1), 0.01)
     or not public.wv_supplier_is_live(v_fabric.supplier_id) then
    raise exception 'That fabric is no longer available. Ask your tailor for another recommendation';
  end if;

  update public.fabric_recommendations
  set status = case when id = v_rec.id then 'selected' else 'dismissed' end,
      selected_at = case when id = v_rec.id then now() else selected_at end
  where order_id = p_order_id
    and batch_id = v_rec.batch_id
    and status = 'pending';

  update public.orders
  set fabric_id = v_fabric.id,
      fabric_supplier_id = v_fabric.supplier_id,
      fabric_problem = null,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_messages(order_id, sender_kind, sender_id, sender_name, body)
  values (
    p_order_id, 'system', null, 'NebedaHub',
    'Fabric selected: ' || v_fabric.name || '. Your tailor can now confirm the amount needed and include the fabric in your quote.'
  );

  return jsonb_build_object('ok', true, 'fabric_id', v_fabric.id, 'fabric_name', v_fabric.name);
end;
$$;

revoke all on function public.wearvia_recommend_fabrics(uuid, uuid[], text) from public;
revoke all on function public.wearvia_choose_recommended_fabric(uuid, uuid) from public;
grant execute on function public.wearvia_recommend_fabrics(uuid, uuid[], text) to authenticated;
grant execute on function public.wearvia_choose_recommended_fabric(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
