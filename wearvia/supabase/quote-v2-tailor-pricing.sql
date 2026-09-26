-- NebedaHub quote v2: each tailor sets the service price for each order.
-- Run after worldwide.sql. Safe to run again.

begin;

-- Remove older quote RPC signatures so the app cannot fall back to a platform price list.
drop function if exists public.wearvia_send_quote(uuid, numeric, uuid, text);
drop function if exists public.wearvia_send_quote(uuid, numeric, uuid, text, text);

create or replace function public.wearvia_send_quote(
  p_order_id uuid,
  p_yards numeric,
  p_fabric_id uuid,
  p_note text,
  p_unit text,
  p_tailoring numeric,
  p_embroidery numeric,
  p_delivery numeric,
  p_extra_label text,
  p_extra numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o            public.orders%rowtype;
  v_designer   public.designers%rowtype;
  v_fabric     public.fabrics%rowtype;
  v_unit       text := coalesce(nullif(lower(trim(p_unit)), ''), 'yd');
  v_len        numeric := round(coalesce(p_yards, 0), 2);
  v_yards      numeric;
  v_cur        text;
  v_fcur       text;
  v_fx         record;
  v_rate       numeric;
  v_rate_date  date;
  v_rate_src   text;
  v_emb_name   text;
  v_tailoring  numeric;
  v_emb_cost   numeric;
  v_delivery   numeric;
  v_extra      numeric;
  v_extra_label text;
  v_cost_fc    numeric;
  v_cost       numeric;
  v_total      numeric;
  v_deposit    numeric;
  v_lines      jsonb;
  v_per        numeric;
  v_note       text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not public.can_manage_designer(o.designer_id) then
    raise exception 'Only the tailor''s team can send a quote for that order.';
  end if;
  if o.quote_status = 'accepted' then
    raise exception 'The customer has already accepted the quote for %. It cannot be changed now.', o.order_number;
  end if;

  if v_unit in ('yard', 'yards') then v_unit := 'yd'; end if;
  if v_unit in ('metre', 'metres', 'meter', 'meters') then v_unit := 'm'; end if;
  if v_unit not in ('yd', 'm') then
    raise exception 'Enter the fabric in yards or metres.';
  end if;

  select * into v_designer from public.designers where id = o.designer_id;
  if not found then
    raise exception 'That tailor was not found.';
  end if;

  select * into v_fabric from public.fabrics where id = coalesce(p_fabric_id, o.fabric_id);
  if not found then
    raise exception 'Choose a fabric for the quote.';
  end if;
  if v_len <= 0 or v_len > 100 or v_len * 4 <> round(v_len * 4) then
    raise exception 'Enter the % needed, in quarters (for example 4.5 or 5.25).', case when v_unit = 'm' then 'metres' else 'yards' end;
  end if;
  v_yards := case when v_unit = 'm' then round(v_len / 0.9144, 4) else v_len end;
  if v_fabric.deleted_at is not null or v_fabric.status <> 'approved' or coalesce(v_fabric.sold_out, false) then
    raise exception '% is not on sale any more. Choose another fabric.', v_fabric.name;
  end if;
  if v_yards < coalesce(v_fabric.min_order_yards, 0) - 0.005 then
    raise exception 'The smallest order for % is %.', v_fabric.name, public.wv_length_text(v_fabric.min_order_yards, v_unit);
  end if;
  if v_yards > coalesce(v_fabric.yards_available, 0) then
    raise exception 'Only % of % is left in stock.', public.wv_length_text(v_fabric.yards_available, v_unit), v_fabric.name;
  end if;

  v_cur := coalesce(v_designer.currency_code, o.currency_code, 'GBP');
  v_fcur := coalesce(v_fabric.currency_code, 'GBP');
  v_emb_name := coalesce(nullif(o.embroidery, ''), 'None');

  -- These service prices come from the tailor for this order. NebedaHub does not supply them.
  if p_tailoring is null or p_tailoring < 0 then
    raise exception 'Enter your tailoring price for this order.';
  end if;
  if coalesce(p_embroidery, 0) < 0 or coalesce(p_delivery, 0) < 0 or coalesce(p_extra, 0) < 0 then
    raise exception 'Quote charges must be 0 or more.';
  end if;
  v_tailoring := public.wv_round_money(p_tailoring, v_cur);
  v_emb_cost := public.wv_round_money(coalesce(p_embroidery, 0), v_cur);
  v_delivery := public.wv_round_money(coalesce(p_delivery, 0), v_cur);
  v_extra := public.wv_round_money(coalesce(p_extra, 0), v_cur);
  v_extra_label := left(coalesce(nullif(trim(p_extra_label), ''), 'Extra charge'), 80);

  v_per := case when v_unit = 'm' then v_fabric.price_per_yard / 0.9144 else v_fabric.price_per_yard end;
  v_cost_fc := public.wv_round_money(v_len * v_per, v_fcur);
  if v_fcur = v_cur then
    v_cost := v_cost_fc;
  else
    select * into v_fx from public.wv_fx(v_fcur, v_cur);
    v_rate := v_fx.rate;
    v_rate_date := v_fx.rate_date;
    v_rate_src := v_fx.source;
    v_cost := public.wv_round_money(v_cost_fc * v_rate, v_cur);
  end if;

  v_total := public.wv_round_money(v_cost + v_tailoring + v_emb_cost + v_delivery + v_extra, v_cur);
  v_deposit := public.wv_round_money(v_total * 0.6, v_cur);
  v_lines := public.wv_quote_lines_fx(
    v_fabric.name, v_len, v_unit, v_fabric.price_per_yard, v_fcur, v_cost_fc,
    v_rate, v_rate_date, v_cur, v_cost, o.outfit_type, v_tailoring, v_emb_name, v_emb_cost, v_delivery);
  if v_extra > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', v_extra_label, 'amount', v_extra, 'kind', 'extra'));
  end if;

  update public.orders
     set fabric_id = v_fabric.id,
         fabric_supplier_id = v_fabric.supplier_id,
         fabric_yards = v_yards,
         fabric_cost = v_cost,
         tailoring_cost = v_tailoring,
         embroidery_cost = v_emb_cost,
         delivery_cost = v_delivery,
         quote_total = v_total,
         deposit_amount = v_deposit,
         line_items = v_lines,
         currency_code = v_cur,
         fabric_currency_code = v_fcur,
         fabric_price_per_yard = v_fabric.price_per_yard,
         fabric_cost_in_fabric_currency = v_cost_fc,
         exchange_rate = v_rate,
         exchange_rate_date = v_rate_date,
         exchange_rate_source = v_rate_src,
         fabric_unit = v_unit,
         quote_status = 'quoted',
         quoted_at = now(),
         quoted_by = auth.uid(),
         fabric_problem = null
   where id = o.id;

  if v_note is not null then
    insert into public.order_messages (order_id, sender_kind, sender_id, sender_name, body)
    values (o.id, 'team', auth.uid(), public.wv_chat_name_for(true, o.id), left(v_note, 2000));
  end if;

  perform public.wv_post_system_message(o.id,
    'Your quote is ready. Total ' || public.wv_money_text(v_total, v_cur)
    || ', deposit ' || public.wv_money_text(v_deposit, v_cur)
    || ' (60%). Open the quote to see the itemised charges. Tap "Accept quote" to go ahead, or ask a question here.');

  return jsonb_build_object('order_number', o.order_number, 'fabric', v_fabric.name,
    'yards', v_yards, 'length', v_len, 'unit', v_unit, 'currency', v_cur,
    'total', v_total, 'deposit', v_deposit, 'line_items', v_lines,
    'fabric_currency', v_fcur, 'fabric_amount', v_cost_fc, 'exchange_rate', v_rate, 'rate_date', v_rate_date);
end $$;

revoke all on function public.wearvia_send_quote(uuid, numeric, uuid, text, text, numeric, numeric, numeric, text, numeric) from public, anon;
grant execute on function public.wearvia_send_quote(uuid, numeric, uuid, text, text, numeric, numeric, numeric, text, numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
