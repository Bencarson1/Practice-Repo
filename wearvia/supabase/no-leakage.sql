-- =====================================================================
-- Wearvia — keep orders on Wearvia ("no leakage")
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it after setup.sql, yards.sql, prices.sql, tailor-quote.sql and
-- tailors-near-me.sql, then merge the app update straight away.
--
-- What it does:
--   1. A contact-details filter in the database (wv_hide_contacts): phone
--      numbers, email addresses, website links, WhatsApp / Instagram /
--      social handles and "call me on…" / "pay me directly" messages are
--      replaced with "[contact details hidden]". Because it runs in the
--      database, nobody can get round it by skipping the app.
--   2. The order chat: every customer and tailor message goes through the
--      filter. A message that had contact details is marked contact_hidden,
--      and the app shows "Contact details are hidden. Please keep your
--      order on Wearvia so you're protected." The original text is kept in
--      hidden_contact_details, which only the Wearvia admin (Nebeda
--      Threads' owner) can read — for safety.
--   3. Tailor profiles (business name, description, city, area), portfolio
--      titles and captions, services and reviews get the same filter —
--      including everything already in the database (originals kept).
--   4. Public tailor profiles, search results and the Google pages show
--      only the business name, area, specialities, photos, rating and
--      reviews. Nobody sees a tailor's full address any more (the old
--      "show my exact address" switch is off for everyone); tailors can't
--      read customers' phone numbers or email addresses (except walk-in
--      customers they added themselves).
--   5. "Delivery and fitting details": the tailor's business address and
--      the customer's delivery address, shown to both only once the
--      customer's deposit is CONFIRMED (wearvia_delivery_details).
--   6. Tailor terms: tailors agree not to take Wearvia customers off the
--      platform. Acceptance is recorded (from the sign-up checkbox, or the
--      box in Business → My profile), and the admin can't approve a new
--      tailor until they've accepted.
--   7. A report at the end. Every line should say OK.
--
-- Safe to run more than once. Nothing is deleted: when text is changed
-- because it had contact details, the original is kept in
-- hidden_contact_details. Existing orders, invoices and payments are never
-- changed (the report checks this). Everything runs in one transaction: if
-- any step fails, nothing is changed.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. A copy of what must not change, for the report at the end
-- ---------------------------------------------------------------------
drop table if exists pg_temp.wv_nl_before;
create temp table wv_nl_before as
  select 'order' as kind, id::text as id, md5(row(designer_id, customer_id, order_number, fabric_id, fabric_yards, fabric_cost,
           tailoring_cost, embroidery_cost, delivery_cost, quote_total, deposit_amount, line_items, deposit_paid_at,
           balance_paid_at, stage, quote_status)::text) as fingerprint
  from public.orders
  union all
  select 'invoice', id::text, md5(row(order_id, total, line_items)::text) from public.invoices
  union all
  select 'payment', id::text, md5(row(order_id, amount, status)::text) from public.payments;

drop table if exists pg_temp.wv_nl_counts;
create temp table wv_nl_counts as
  select 'order_messages' as t, count(*) as n from public.order_messages
  union all select 'designers', count(*) from public.designers
  union all select 'designer_portfolio_items', count(*) from public.designer_portfolio_items
  union all select 'designer_services', count(*) from public.designer_services
  union all select 'reviews', count(*) from public.reviews
  union all select 'customers', count(*) from public.customers
  union all select 'orders', count(*) from public.orders;


-- ---------------------------------------------------------------------
-- 1. The contact-details filter
-- ---------------------------------------------------------------------
-- The same rules as the app's js/no-leakage.js, in the same order: links
-- and emails first (so their digits aren't taken for a phone number), then
-- phone numbers, then handles and "call me on…". A run of digits counts as
-- a phone number when it has 9 or more digits and starts like one (+, 0 or
-- a bracket) or has a group of 3+ digits — so measurements ("38 40 42 44
-- 46"), dates, yards and prices are left alone.

create or replace function public.wv_hide_contacts(p_text text, out body text, out kinds text[])
language plpgsql immutable set search_path = public as $$
declare
  c_token  constant text := '[contact details hidden]';
  c_tlds   constant text := 'com|net|org|co|uk|ng|gh|ke|za|io|me|ly|ee|us|ca|app|shop|store|biz|info|online|site|link|page|africa|fashion|tv';
  c_social constant text := 'ig|insta|instagram|tiktok|tik tok|snap|snapchat|facebook|fb|twitter|telegram|whatsapp|whats app|watsapp|signal';
  v        text := coalesce(p_text, '');
  v_before text;
  m        text;
  v_digits text;
begin
  kinds := '{}';

  -- Links with http(s):// or www.
  v_before := v;
  v := regexp_replace(v, '(https?://|www\.)\S+', c_token, 'gi');
  if v <> v_before then kinds := kinds || 'link'::text; end if;

  -- Email addresses
  v_before := v;
  v := regexp_replace(v, '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', c_token, 'gi');
  if v <> v_before then kinds := kinds || 'email'::text; end if;

  -- Phone numbers
  for m in select distinct x[1] from regexp_matches(v, '\+?\(?[0-9][0-9\s().-]{6,}[0-9]', 'g') as x loop
    v_digits := regexp_replace(m, '[^0-9]', '', 'g');
    if char_length(v_digits) >= 9 and (m ~ '^[+0(]' or m ~ '[0-9]{3}') then
      v := replace(v, m, c_token);
      if not 'phone' = any (kinds) then kinds := kinds || 'phone'::text; end if;
    end if;
  end loop;

  -- Emails written out: "ade at gmail dot com", "ade (at) gmail (dot) com"
  v_before := v;
  v := regexp_replace(v, '\m[a-z0-9._%+-]+(\s+dot\s+[a-z0-9_%+-]+)*\s*[[(]?\s*(at|@)\s*[])]?\s*[a-z0-9-]+\s*[[(]?\s*(dot|\.)\s*[])]?\s*(' || c_tlds || ')\M', c_token, 'gi');
  if v <> v_before and not 'email' = any (kinds) then kinds := kinds || 'email'::text; end if;

  -- Websites without www: nebeda.co.uk, linktr.ee/…, wa.me/…
  v_before := v;
  v := regexp_replace(v, '\m[a-z0-9-]+(\.[a-z0-9-]+)*\.(' || c_tlds || ')\M(/\S*)?', c_token, 'gi');
  if v <> v_before and not 'link' = any (kinds) then kinds := kinds || 'link'::text; end if;

  -- @handles
  v_before := v;
  v := regexp_replace(v, '(^|[^a-z0-9._%+\]-])@[a-z0-9._]{2,30}', '\1' || c_token, 'gi');
  -- "my ig is …", "my number: …", "our page - …"
  v := regexp_replace(v, '\m(my|our)\s+(' || c_social || '|number|phone|mobile|cell|email|e-mail|contact|line|website|site|page|handle)(\s+(handle|page|account|name|id|number|no))?\s*(is|:|-|=)\s*[^[:space:],;!?[]+', c_token, 'gi');
  -- "IG: …", "whatsapp @…", "snap = …"
  v := regexp_replace(v, '\m(' || c_social || ')\s*(handle|page|account|name|id|number|no)?\s*(:|=|@)\s*@?[a-z0-9._+-]{2,30}', c_token, 'gi');
  if v <> v_before then kinds := kinds || 'handle'::text; end if;

  -- "call me on", "text me at", "pay me directly", "outside the app"
  v_before := v;
  v := regexp_replace(v, '\m(call|text|ring|phone|whats\s?app|dm|reach|contact|e-?mail|message|pay)\s+(me|us)\s+(on|at|via|through|directly|outside|privately|off)\M(?!\s+(here|this app|the app|wearvia))', c_token, 'gi');
  v := regexp_replace(v, '\m(outside|off)\s+(of\s+)?(the\s+)?(app|wearvia|platform)\M', c_token, 'gi');
  if v <> v_before then kinds := kinds || 'contact_request'::text; end if;

  -- Numbers written as words: "zero seven one two three …"
  v_before := v;
  v := regexp_replace(v, '\m((zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple)[\s,.-]*){7,}', c_token, 'gi');
  if v <> v_before and not 'phone' = any (kinds) then kinds := kinds || 'phone'::text; end if;

  -- "[hidden] [hidden]" → "[hidden]"
  v := regexp_replace(v, '\[contact details hidden\]([[:space:],.;:/-]*\[contact details hidden\])+', c_token, 'g');
  body := v;
end $$;

-- The app may call it to check text before saving (it changes nothing)
revoke execute on function public.wv_hide_contacts(text) from public;
grant execute on function public.wv_hide_contacts(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. The originals, for the Wearvia admin only
-- ---------------------------------------------------------------------

create table if not exists public.hidden_contact_details (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('chat', 'profile', 'portfolio', 'service', 'review', 'order', 'delivery_address')),
  source_id    uuid not null,       -- the chat message, tailor, portfolio photo … it came from
  field        text not null,
  original     text not null,
  hidden_kinds text[] not null default '{}',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists hidden_contact_details_source_idx on public.hidden_contact_details (source, source_id);

alter table public.hidden_contact_details enable row level security;
drop policy if exists "hidden_contact_details: admin reads" on public.hidden_contact_details;
create policy "hidden_contact_details: admin reads" on public.hidden_contact_details
  for select to authenticated using ((select public.is_admin()));
revoke all on public.hidden_contact_details from public, anon, authenticated;
grant select on public.hidden_contact_details to authenticated;   -- the rule above lets only the admin see rows

-- Runs a text through the filter; if anything was hidden, keeps the original
-- and returns the filtered text
create or replace function public.wv_filter_and_keep(p_source text, p_source_id uuid, p_field text, p_text text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_body  text;
  v_kinds text[];
begin
  if p_text is null or p_text = '' then
    return p_text;
  end if;
  select f.body, f.kinds into v_body, v_kinds from public.wv_hide_contacts(p_text) f;
  if cardinality(v_kinds) = 0 then
    return p_text;
  end if;
  insert into public.hidden_contact_details (source, source_id, field, original, hidden_kinds)
  values (p_source, p_source_id, p_field, p_text, v_kinds);
  return v_body;
end $$;
revoke execute on function public.wv_filter_and_keep(text, uuid, text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. The order chat
-- ---------------------------------------------------------------------

alter table public.order_messages add column if not exists contact_hidden boolean not null default false;

-- Runs after wv_order_messages_before_insert (triggers run in name order),
-- for every message a customer or a tailor's team sends — however it's sent.
-- Wearvia's own messages ("Your quote is ready") are left alone.
create or replace function public.wv_order_messages_no_leakage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_body text;
begin
  new.contact_hidden := false;
  if new.sender_kind <> 'system' then
    v_body := public.wv_filter_and_keep('chat', new.id, 'body', new.body);
    if v_body is distinct from new.body then
      new.body := v_body;
      new.contact_hidden := true;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists wv_order_messages_no_leakage on public.order_messages;
create trigger wv_order_messages_no_leakage before insert on public.order_messages
  for each row execute function public.wv_order_messages_no_leakage();


-- ---------------------------------------------------------------------
-- 4. Tailor profiles: the filter, no public address, and the tailor terms
-- ---------------------------------------------------------------------

alter table public.designers add column if not exists tailor_terms_version     text;
alter table public.designers add column if not exists tailor_terms_accepted_at timestamptz;
alter table public.designers add column if not exists tailor_terms_accepted_by uuid;

-- Runs after wv_designers_before_write (triggers run in name order), so it
-- has the last word on what the public sees.
create or replace function public.wv_designers_no_leakage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb;
  v_tags text[];
  v_tag  text;
begin
  -- The filter, on every public text
  if tg_op = 'INSERT' or new.business_name is distinct from old.business_name then
    new.business_name := public.wv_filter_and_keep('profile', new.id, 'business_name', new.business_name);
  end if;
  if tg_op = 'INSERT' or new.description is distinct from old.description then
    new.description := public.wv_filter_and_keep('profile', new.id, 'description', new.description);
  end if;
  if tg_op = 'INSERT' or new.location is distinct from old.location then
    new.location := public.wv_filter_and_keep('profile', new.id, 'location', new.location);
  end if;
  if tg_op = 'INSERT' or new.city is distinct from old.city then
    new.city := public.wv_filter_and_keep('profile', new.id, 'city', new.city);
  end if;
  if tg_op = 'INSERT' or new.delivery_estimate is distinct from old.delivery_estimate then
    new.delivery_estimate := public.wv_filter_and_keep('profile', new.id, 'delivery_estimate', new.delivery_estimate);
  end if;
  if tg_op = 'INSERT' or new.speciality_tags is distinct from old.speciality_tags then
    v_tags := '{}';
    foreach v_tag in array coalesce(new.speciality_tags, '{}') loop
      if public.wv_filter_and_keep('profile', new.id, 'speciality_tags', v_tag) = v_tag then
        v_tags := v_tags || v_tag;
      end if;
    end loop;
    new.speciality_tags := v_tags;
  end if;
  -- The web address is public too: make it again from the (filtered) name if it had contact details
  if new.slug is not null and cardinality((public.wv_hide_contacts(replace(new.slug, '-', ' '))).kinds) > 0 then
    new.slug := public.wv_unique_designer_slug(new.business_name, new.id);
  end if;

  -- Nobody sees a tailor's full address or exact position: only the area
  -- (e.g. "SE15") and a position rounded to about 1 km. The business address
  -- is shared with a customer once their deposit is confirmed.
  new.show_exact_address := false;
  new.public_address := null;
  if new.latitude is null or new.longitude is null then
    new.public_latitude := null;
    new.public_longitude := null;
  else
    new.public_latitude := round(new.latitude::numeric, 2)::double precision;
    new.public_longitude := round(new.longitude::numeric, 2)::double precision;
  end if;
  new.postcode_area := case
    when new.postcode is null then null
    when new.country_code = 'GB' then nullif(trim(regexp_replace(upper(new.postcode), '\s*[0-9][A-Z]{2}$', '')), '')
    else null end;

  -- The tailor terms: ticked at sign-up ("tailor_terms" in the sign-up details)
  if tg_op = 'INSERT' and new.tailor_terms_accepted_at is null and new.owner_user_id is not null then
    select u.raw_user_meta_data into v_meta from auth.users u where u.id = new.owner_user_id;
    if nullif(trim(coalesce(v_meta->>'tailor_terms', '')), '') is not null then
      new.tailor_terms_version := left(v_meta->>'tailor_terms', 20);
      new.tailor_terms_accepted_at := now();
      new.tailor_terms_accepted_by := new.owner_user_id;
    end if;
  end if;
  -- … and only the tailor accepts them (wearvia_accept_tailor_terms)
  if tg_op = 'UPDATE' and auth.uid() is not null
     and (new.tailor_terms_accepted_at is distinct from old.tailor_terms_accepted_at
          or new.tailor_terms_version is distinct from old.tailor_terms_version)
     and coalesce(current_setting('wearvia.accepting_terms', true), '') <> 'yes' then
    new.tailor_terms_version := old.tailor_terms_version;
    new.tailor_terms_accepted_at := old.tailor_terms_accepted_at;
    new.tailor_terms_accepted_by := old.tailor_terms_accepted_by;
  end if;
  -- A new tailor can't be approved until they've accepted the terms
  -- (tailors approved before the terms existed carry on, and see the terms in My profile)
  if new.admin_status = 'approved' and tg_op = 'UPDATE' and old.admin_status <> 'approved'
     and new.tailor_terms_accepted_at is null and new.id is distinct from public.wv_main_designer_id() then
    raise exception '% hasn''t accepted the Wearvia tailor terms yet. They''ll see them in Business → My profile.', new.business_name;
  end if;
  return new;
end $$;

drop trigger if exists wv_designers_no_leakage on public.designers;
create trigger wv_designers_no_leakage before insert or update on public.designers
  for each row execute function public.wv_designers_no_leakage();

-- The tailor ticks "I agree" (at sign-up, in "Join as a tailor", or in My profile)
create or replace function public.wearvia_accept_tailor_terms(p_designer_id uuid default null, p_version text default null)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(p_designer_id,
                        (select d.id from public.designers d where d.owner_user_id = auth.uid() order by d.created_at limit 1));
  v_at timestamptz;
begin
  if auth.uid() is null or v_id is null
     or not exists (select 1 from public.designers d where d.id = v_id and d.owner_user_id = auth.uid()) then
    raise exception 'Only the owner of the tailor business can accept the tailor terms.';
  end if;
  perform set_config('wearvia.accepting_terms', 'yes', true);
  update public.designers
     set tailor_terms_version = left(coalesce(nullif(trim(p_version), ''), 'current'), 20),
         tailor_terms_accepted_at = now(),
         tailor_terms_accepted_by = auth.uid()
   where id = v_id
  returning tailor_terms_accepted_at into v_at;
  perform set_config('wearvia.accepting_terms', '', true);
  return v_at;
end $$;
revoke execute on function public.wearvia_accept_tailor_terms(uuid, text) from public, anon;
grant execute on function public.wearvia_accept_tailor_terms(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Portfolio, services, reviews and the customer's order notes
-- ---------------------------------------------------------------------

create or replace function public.wv_portfolio_no_leakage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.title is distinct from old.title then
    new.title := public.wv_filter_and_keep('portfolio', new.id, 'title', new.title);
  end if;
  if tg_op = 'INSERT' or new.caption is distinct from old.caption then
    new.caption := public.wv_filter_and_keep('portfolio', new.id, 'caption', new.caption);
  end if;
  if tg_op = 'INSERT' or new.description is distinct from old.description then
    new.description := public.wv_filter_and_keep('portfolio', new.id, 'description', new.description);
  end if;
  if tg_op = 'INSERT' or new.outfit_category is distinct from old.outfit_category then
    new.outfit_category := public.wv_filter_and_keep('portfolio', new.id, 'outfit_category', new.outfit_category);
  end if;
  return new;
end $$;
drop trigger if exists wv_portfolio_no_leakage on public.designer_portfolio_items;
create trigger wv_portfolio_no_leakage before insert or update on public.designer_portfolio_items
  for each row execute function public.wv_portfolio_no_leakage();

create or replace function public.wv_services_no_leakage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    new.name := public.wv_filter_and_keep('service', new.id, 'name', new.name);
  end if;
  if tg_op = 'INSERT' or new.description is distinct from old.description then
    new.description := public.wv_filter_and_keep('service', new.id, 'description', new.description);
  end if;
  return new;
end $$;
drop trigger if exists wv_services_no_leakage on public.designer_services;
create trigger wv_services_no_leakage before insert or update on public.designer_services
  for each row execute function public.wv_services_no_leakage();

create or replace function public.wv_reviews_no_leakage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.review_text is distinct from old.review_text then
    new.review_text := public.wv_filter_and_keep('review', new.id, 'review_text', new.review_text);
  end if;
  return new;
end $$;
drop trigger if exists wv_reviews_no_leakage on public.reviews;
create trigger wv_reviews_no_leakage before insert or update on public.reviews
  for each row execute function public.wv_reviews_no_leakage();

-- The note and link a customer sends with their style photos, and the
-- review on the order. A link to a messaging app (WhatsApp, Telegram …),
-- an email or a phone is removed; a link to an Instagram / TikTok /
-- Pinterest post stays.
create or replace function public.wv_contact_link_pattern() returns text
language sql immutable as $$
  select '(wa\.me|whatsapp|t\.me/|telegram|signal\.|mailto:|tel:|linktr\.ee|bit\.ly|beacons\.ai|calendly)'::text
$$;

create or replace function public.wv_orders_no_leakage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.inspiration_note is distinct from old.inspiration_note then
    new.inspiration_note := public.wv_filter_and_keep('order', new.id, 'inspiration_note', new.inspiration_note);
  end if;
  if tg_op = 'INSERT' or new.review_text is distinct from old.review_text then
    new.review_text := public.wv_filter_and_keep('order', new.id, 'review_text', new.review_text);
  end if;
  if (tg_op = 'INSERT' or new.inspiration_link is distinct from old.inspiration_link)
     and new.inspiration_link ~* public.wv_contact_link_pattern() then
    insert into public.hidden_contact_details (source, source_id, field, original, hidden_kinds)
    values ('order', new.id, 'inspiration_link', new.inspiration_link, array['link']);
    new.inspiration_link := null;
  end if;
  return new;
end $$;
drop trigger if exists wv_orders_no_leakage on public.orders;
create trigger wv_orders_no_leakage before insert or update on public.orders
  for each row execute function public.wv_orders_no_leakage();


-- ---------------------------------------------------------------------
-- 6. What's already in the database gets the same filter
--    (the originals are kept in hidden_contact_details; nothing is deleted)
-- ---------------------------------------------------------------------

-- Chat messages
with changed as (
  select m.id, m.body, f.body as new_body, f.kinds
  from public.order_messages m, lateral public.wv_hide_contacts(m.body) f
  where m.sender_kind <> 'system' and cardinality(f.kinds) > 0
), kept as (
  insert into public.hidden_contact_details (source, source_id, field, original, hidden_kinds, created_by)
  select 'chat', c.id, 'body', c.body, c.kinds, null from changed c
  returning source_id
)
update public.order_messages m
   set body = c.new_body, contact_hidden = true
  from changed c
 where m.id = c.id;

-- Tailors: re-saving runs the new rule (filter, no public address)
update public.designers d
   set description = d.description
 where d.public_address is not null or d.show_exact_address
    or cardinality((public.wv_hide_contacts(concat_ws(' ', d.business_name, d.description, d.location, d.city, d.delivery_estimate,
                                                      array_to_string(d.speciality_tags, ' ')))).kinds) > 0
    or cardinality((public.wv_hide_contacts(replace(coalesce(d.slug, ''), '-', ' '))).kinds) > 0
    or d.public_latitude is distinct from round(d.latitude::numeric, 2)::double precision;

-- Orders: a link to a messaging app in the style link (the money is untouched)
with kept as (
  insert into public.hidden_contact_details (source, source_id, field, original, hidden_kinds, created_by)
  select 'order', o.id, 'inspiration_link', o.inspiration_link, array['link'], null from public.orders o
  where o.inspiration_link ~* public.wv_contact_link_pattern()
  returning source_id
)
update public.orders o set inspiration_link = null where o.id in (select source_id from kept);

-- The filters in the triggers only look at text that changes, so filter what's already there here
update public.designer_portfolio_items p
   set caption = public.wv_filter_and_keep('portfolio', p.id, 'caption', p.caption),
       description = public.wv_filter_and_keep('portfolio', p.id, 'description', p.description),
       outfit_category = public.wv_filter_and_keep('portfolio', p.id, 'outfit_category', p.outfit_category),
       title = public.wv_filter_and_keep('portfolio', p.id, 'title', p.title)
 where cardinality((public.wv_hide_contacts(concat_ws(' ', p.title, p.caption, p.description, p.outfit_category))).kinds) > 0;
update public.designer_services s
   set name = public.wv_filter_and_keep('service', s.id, 'name', s.name),
       description = public.wv_filter_and_keep('service', s.id, 'description', s.description)
 where cardinality((public.wv_hide_contacts(concat_ws(' ', s.name, s.description))).kinds) > 0;
update public.reviews r
   set review_text = public.wv_filter_and_keep('review', r.id, 'review_text', r.review_text)
 where cardinality((public.wv_hide_contacts(r.review_text)).kinds) > 0;
update public.designers d
   set business_name = public.wv_filter_and_keep('profile', d.id, 'business_name', d.business_name),
       description = public.wv_filter_and_keep('profile', d.id, 'description', d.description),
       location = public.wv_filter_and_keep('profile', d.id, 'location', d.location),
       city = public.wv_filter_and_keep('profile', d.id, 'city', d.city),
       delivery_estimate = public.wv_filter_and_keep('profile', d.id, 'delivery_estimate', d.delivery_estimate),
       speciality_tags = array(select t from unnest(d.speciality_tags) t
                               where public.wv_filter_and_keep('profile', d.id, 'speciality_tags', t) = t)
 where cardinality((public.wv_hide_contacts(concat_ws(' ', d.business_name, d.description, d.location, d.city, d.delivery_estimate,
                                                     array_to_string(d.speciality_tags, ' ')))).kinds) > 0;
update public.orders o
   set inspiration_note = public.wv_filter_and_keep('order', o.id, 'inspiration_note', o.inspiration_note),
       review_text = public.wv_filter_and_keep('order', o.id, 'review_text', o.review_text)
 where cardinality((public.wv_hide_contacts(concat_ws(' ', o.inspiration_note, o.review_text))).kinds) > 0;


-- ---------------------------------------------------------------------
-- 7. Customers' phone numbers and emails stay with Wearvia
-- ---------------------------------------------------------------------
-- A tailor's team no longer reads customers' phone or email. They see
-- them only for walk-in customers they added themselves; everyone sees
-- their own; the admin sees all. The app reads them with
-- wearvia_customer_contacts().

revoke select (email, phone) on public.customers from anon, authenticated;
revoke select (notes) on public.customers from anon, authenticated;

create or replace function public.wearvia_customer_contacts()
returns table (id uuid, email text, phone text)
language sql stable security definer set search_path = public as $$
  select c.id, c.email, c.phone from public.customers c
  where c.auth_user_id = auth.uid()
     or public.is_admin()
     or (c.added_by_designer_id is not null and public.can_manage_designer(c.added_by_designer_id))
$$;
revoke execute on function public.wearvia_customer_contacts() from public, anon;
grant execute on function public.wearvia_customer_contacts() to authenticated;

-- … and a team can't overwrite them either (they can still change the name)
create or replace function public.wv_customers_no_leakage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and new.auth_user_id is distinct from auth.uid()
     and not (old.added_by_designer_id is not null and public.can_manage_designer(old.added_by_designer_id)) then
    new.email := old.email;
    new.phone := old.phone;
  end if;
  return new;
end $$;
drop trigger if exists wv_customers_no_leakage on public.customers;
create trigger wv_customers_no_leakage before update on public.customers
  for each row execute function public.wv_customers_no_leakage();


-- ---------------------------------------------------------------------
-- 8. Delivery and fitting details — only after the deposit is confirmed
-- ---------------------------------------------------------------------

-- The customer's delivery address for an order. Nobody reads this table
-- directly: the customer sets it with wearvia_set_delivery_address, and both
-- sides read it with wearvia_delivery_details.
create table if not exists public.order_delivery_addresses (
  order_id   uuid primary key references public.orders (id) on delete cascade,
  address    text not null default '' check (char_length(address) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.order_delivery_addresses enable row level security;
revoke all on public.order_delivery_addresses from public, anon, authenticated;

create or replace function public.wearvia_set_delivery_address(p_order_id uuid, p_address text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_address text := left(regexp_replace(trim(coalesce(p_address, '')), '\s+', ' ', 'g'), 300);
begin
  if p_order_id is null or not exists (select 1 from public.wv_my_order_ids() x where x = p_order_id) then
    raise exception 'Only the customer can set the delivery address for that order.';
  end if;
  v_address := public.wv_filter_and_keep('delivery_address', p_order_id, 'address', v_address);
  insert into public.order_delivery_addresses (order_id, address, updated_at, updated_by)
  values (p_order_id, v_address, now(), auth.uid())
  on conflict (order_id) do update set address = excluded.address, updated_at = now(), updated_by = auth.uid();
  return v_address;
end $$;
revoke execute on function public.wearvia_set_delivery_address(uuid, text) from public, anon;
grant execute on function public.wearvia_set_delivery_address(uuid, text) to authenticated;

-- For every order the signed-in person can see: unlocked once the deposit
-- is confirmed. Before that, the tailor sees nothing and the customer sees
-- only the delivery address they typed themselves.
create or replace function public.wearvia_delivery_details()
returns table (order_id uuid, unlocked boolean, tailor_name text, tailor_address text, delivery_address text)
language sql stable security definer set search_path = public as $$
  select o.id,
         o.deposit_paid_at is not null,
         d.business_name,
         case when o.deposit_paid_at is not null then
           nullif(concat_ws(', ', nullif(trim(d.address_line), ''), nullif(trim(d.city), ''), nullif(trim(d.postcode), ''),
                            (select c.name from public.countries c where c.code = d.country_code)), '') end,
         case when o.deposit_paid_at is not null or o.id in (select public.wv_my_order_ids()) then nullif(a.address, '') end
  from public.orders o
  left join public.designers d on d.id = o.designer_id
  left join public.order_delivery_addresses a on a.order_id = o.id
  where o.id in (select public.wv_my_order_ids()) or o.id in (select public.wv_team_order_ids())
$$;
revoke execute on function public.wearvia_delivery_details() from public, anon;
grant execute on function public.wearvia_delivery_details() to authenticated;


-- ---------------------------------------------------------------------
-- 9. Who can call what
-- ---------------------------------------------------------------------
revoke execute on function public.wv_order_messages_no_leakage() from public, anon, authenticated;
revoke execute on function public.wv_designers_no_leakage() from public, anon, authenticated;
revoke execute on function public.wv_portfolio_no_leakage() from public, anon, authenticated;
revoke execute on function public.wv_services_no_leakage() from public, anon, authenticated;
revoke execute on function public.wv_reviews_no_leakage() from public, anon, authenticated;
revoke execute on function public.wv_orders_no_leakage() from public, anon, authenticated;
revoke execute on function public.wv_contact_link_pattern() from public, anon;
revoke execute on function public.wv_customers_no_leakage() from public, anon, authenticated;

commit;

-- Tell the Supabase API about the new columns, tables and functions straight away
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 10. Report — every line should say "OK".
-- ---------------------------------------------------------------------
-- The checks below try things out and then undo them, so they change nothing.
-- Line 3 signs in as "nobody" (the public) for a moment to see what the
-- public can really read.
drop table if exists pg_temp.wv_nl_live;
create temp table wv_nl_live (n integer, check_name text, result text);
grant all on wv_nl_live to anon;

-- Line 3: what the public can read about tailors
do $$
declare
  v_blocked   integer := 0;
  v_address   integer;
  v_search    integer;
  v_page      integer;
  v_col       text;
begin
  set local role anon;
  foreach v_col in array array['phone', 'address_line', 'postcode', 'latitude', 'longitude', 'admin_note', 'tailor_terms_accepted_by'] loop
    begin
      execute format('select %I from public.designers limit 1', v_col);
    exception when insufficient_privilege then
      v_blocked := v_blocked + 1;
    end;
  end loop;
  select count(*) into v_address from public.designers where public_address is not null;
  select count(*) into v_search from public.wearvia_search_tailors(null, null, null, null, null, null, null, null, null, null, 'distance', 50, 0) s
   where s.public_address is not null
      or cardinality((public.wv_hide_contacts(concat_ws(' ', s.business_name, s.description, s.location, s.city, s.postcode_area))).kinds) > 0;
  select count(*) into v_page from public.designers d, lateral public.wearvia_tailor_page(d.slug) as t(p)
   where d.admin_status = 'approved'
     and (t.p->>'public_address' is not null
          or cardinality((public.wv_hide_contacts(concat_ws(' ', t.p->>'business_name', t.p->>'description', t.p->>'location', t.p->>'city',
               t.p->>'postcode_area', t.p->>'delivery_estimate',
               (select string_agg(concat_ws(' ', x->>'title', x->>'caption', x->>'outfit_category'), ' ') from jsonb_array_elements(t.p->'portfolio') x),
               (select string_agg(concat_ws(' ', x->>'name', x->>'description'), ' ') from jsonb_array_elements(t.p->'services') x),
               (select string_agg(x->>'text', ' ') from jsonb_array_elements(t.p->'reviews') x)))).kinds) > 0);
  reset role;
  insert into wv_nl_live values (3, 'Public profiles, search and tailor pages: no website, phone, email, social or address',
    case when v_blocked = 7 and v_address = 0 and v_search = 0 and v_page = 0
         then 'OK (' || (select count(*) from public.designers where admin_status = 'approved') || ' public tailors checked)'
         else 'NOT LOCKED — tell your developer (' || (7 - v_blocked) || ' private columns readable, ' || v_address || ' addresses, '
              || v_search || ' search results and ' || v_page || ' pages with contact details)' end);
end $$;

-- Line 4: a chat message and a profile, tried for real and then undone
do $$
declare
  v_order   uuid := (select id from public.orders order by created_at limit 1);
  v_msg     record;
  v_desc    text;
  v_public  text;
  v_kept    integer;
  v_ok_chat boolean := true;
  v_ok_prof boolean;
begin
  begin
    if v_order is not null then
      insert into public.order_messages (order_id, sender_kind, sender_id, sender_name, body)
      values (v_order, 'customer', null, 'Report', 'Call me on 07123 456789 or ade@example.com')
      returning body, contact_hidden into v_msg;
      v_ok_chat := v_msg.contact_hidden and v_msg.body not like '%07123%' and v_msg.body not like '%@%';
    end if;
    update public.designers set description = 'Visit www.example-tailor.com or WhatsApp 0803 123 4567', show_exact_address = true,
           address_line = coalesce(address_line, '1 Test Street')
     where id = public.wv_main_designer_id()
    returning description, public_address into v_desc, v_public;
    select count(*) into v_kept from public.hidden_contact_details where created_at = now();
    raise exception using errcode = 'P0001', message = 'wv_undo';
  exception when sqlstate 'P0001' then
    null;   -- everything above is undone
  end;
  v_ok_prof := v_desc not like '%example-tailor%' and v_desc not like '%0803%' and v_public is null;
  insert into wv_nl_live values (4, 'Chat and profiles hide contact details in the database (tried and undone)',
    case when v_ok_chat and v_ok_prof and v_kept >= case when v_order is null then 1 else 2 end
         then 'OK' || case when v_order is null then ' (profile tried; no orders yet to try a chat message)' else '' end
         else 'NOT WORKING — tell your developer' end);
end $$;

with tests(sentence, should_hide) as (values
  ('Call me on 07123 456789', true), ('+44 7123 456 789', true), ('0803 123 4567 whatsapp me', true),
  ('email me: ade.styles@gmail.com', true), ('ade dot styles at gmail dot com', true), ('see www.nebeda.co.uk', true),
  ('https://wa.me/447123456789', true), ('find me on insta @ade_styles', true), ('IG: ade_styles', true),
  ('my ig is ade.styles', true), ('pay me directly and I''ll give you a discount', true), ('let''s do it outside the app', true),
  ('zero seven one two three four five six seven eight nine', true),
  ('Chest 42, waist 36, sleeve 25', false), ('38 40 42 44 46', false), ('Can you have it ready by 25.10.2026?', false),
  ('I need 4.5 yards of the gold lace', false), ('Order NT-1009 and NT-1010', false), ('The total is £1,250.50 with the deposit £750', false),
  ('I saw this style on Instagram yesterday', false), ('Please message me on here when it''s ready', false), ('My postcode is ME7 1AA', false)
),
checks as (
  select 1 as n, 'Existing orders, invoices and payments unchanged' as check_name,
         case when not exists (
                select kind, id, fingerprint from wv_nl_before
                except
                (select 'order', id::text, md5(row(designer_id, customer_id, order_number, fabric_id, fabric_yards, fabric_cost,
                          tailoring_cost, embroidery_cost, delivery_cost, quote_total, deposit_amount, line_items, deposit_paid_at,
                          balance_paid_at, stage, quote_status)::text) from public.orders
                 union all
                 select 'invoice', id::text, md5(row(order_id, total, line_items)::text) from public.invoices
                 union all
                 select 'payment', id::text, md5(row(order_id, amount, status)::text) from public.payments))
              then 'OK (' || (select count(*) from wv_nl_before where kind = 'order') || ' orders checked)'
              else 'CHANGED — tell your developer' end as result
  union all
  select 2, 'Nothing deleted',
         case when not exists (select 1 from wv_nl_counts b
                               where b.n > case b.t
                                 when 'order_messages' then (select count(*) from public.order_messages)
                                 when 'designers' then (select count(*) from public.designers)
                                 when 'designer_portfolio_items' then (select count(*) from public.designer_portfolio_items)
                                 when 'designer_services' then (select count(*) from public.designer_services)
                                 when 'reviews' then (select count(*) from public.reviews)
                                 when 'customers' then (select count(*) from public.customers)
                                 when 'orders' then (select count(*) from public.orders) end)
              then 'OK (' || (select count(*) from public.hidden_contact_details) || ' hidden contact details kept for the admin)'
              else 'SOMETHING IS MISSING — tell your developer' end
  union all
  select n, check_name, result from wv_nl_live
  union all
  select 5, 'The filter catches phones, emails, links, handles and "call me on", and leaves measurements alone',
         case when bool_and((cardinality((public.wv_hide_contacts(t.sentence)).kinds) > 0) = t.should_hide)
              then 'OK (' || count(*) || ' test sentences)'
              else 'WRONG FOR: ' || string_agg(t.sentence, ' · ') filter (where (cardinality((public.wv_hide_contacts(t.sentence)).kinds) > 0) <> t.should_hide) end
  from tests t
  union all
  select 6, 'Filters switched on (chat, profiles, portfolio, services, reviews, order notes)',
         case when (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname in
                     ('wv_order_messages_no_leakage', 'wv_designers_no_leakage', 'wv_portfolio_no_leakage', 'wv_services_no_leakage',
                      'wv_reviews_no_leakage', 'wv_orders_no_leakage', 'wv_customers_no_leakage')) = 7
               and not exists (select 1 from public.order_messages m where m.sender_kind <> 'system'
                               and cardinality((public.wv_hide_contacts(m.body)).kinds) > 0)
              then 'OK (' || (select count(*) from public.order_messages where contact_hidden) || ' chat messages with hidden details)'
              else 'NOT SWITCHED ON — tell your developer' end
  union all
  select 7, 'Original messages: only the Wearvia admin can read them',
         case when (select relrowsecurity from pg_class where oid = 'public.hidden_contact_details'::regclass)
               and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hidden_contact_details') = 1
               and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hidden_contact_details' and qual ilike '%is_admin%')
               and not has_table_privilege('anon', 'public.hidden_contact_details', 'select')
               and not has_table_privilege('authenticated', 'public.hidden_contact_details', 'insert, update, delete')
              then 'OK' else 'NOT LOCKED — tell your developer' end
  union all
  select 8, 'Tailors can''t read customers'' phone numbers or emails',
         case when not has_column_privilege('authenticated', 'public.customers', 'phone', 'select')
               and not has_column_privilege('authenticated', 'public.customers', 'email', 'select')
               and not has_column_privilege('anon', 'public.customers', 'phone', 'select')
               and has_function_privilege('authenticated', 'public.wearvia_customer_contacts()', 'execute')
              then 'OK' else 'NOT LOCKED — tell your developer' end
  union all
  select 9, 'Delivery and fitting details only after the deposit is confirmed',
         case when (select relrowsecurity from pg_class where oid = 'public.order_delivery_addresses'::regclass)
               and not has_table_privilege('authenticated', 'public.order_delivery_addresses', 'select, insert, update, delete')
               and not has_table_privilege('anon', 'public.order_delivery_addresses', 'select')
               and has_function_privilege('authenticated', 'public.wearvia_delivery_details()', 'execute')
               and not has_function_privilege('anon', 'public.wearvia_delivery_details()', 'execute')
               and has_function_privilege('authenticated', 'public.wearvia_set_delivery_address(uuid, text)', 'execute')
               and (select prosrc from pg_proc where oid = 'public.wearvia_delivery_details()'::regprocedure) ilike '%deposit_paid_at is not null%'
              then 'OK (' || (select count(*) from public.orders where deposit_paid_at is not null) || ' orders with a confirmed deposit)'
              else 'NOT LOCKED — tell your developer' end
  union all
  select 10, 'Tailor terms recorded; new tailors can''t be approved without them',
         case when has_function_privilege('authenticated', 'public.wearvia_accept_tailor_terms(uuid, text)', 'execute')
               and not has_column_privilege('authenticated', 'public.designers', 'tailor_terms_accepted_at', 'update')
               and (select prosrc from pg_proc where oid = 'public.wv_designers_no_leakage()'::regprocedure) ilike '%hasn''''t accepted%'
              then 'OK (' || (select count(*) from public.designers where tailor_terms_accepted_at is null) || ' tailors still to accept — they see the terms in My profile)'
              else 'MISSING — tell your developer' end
)
select check_name, result from (
  select n, check_name, result from checks
  union all
  select 99, 'ALL DONE', case when bool_and(result like 'OK%') then 'OK — you can merge the app update'
                              else 'NOT OK — see the lines above and tell your developer' end
  from checks
) report
order by n;
