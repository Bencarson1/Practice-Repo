-- ============================================================
-- Sign-in protection: account lockout + per-IP rate limiting
--
-- Rules (never a permanent lock):
--   - 3 wrong passwords for one email        -> sign-in paused for 15 minutes
--   - after that pause, 2 more wrong         -> paused for 30 minutes
--   - every further 2 wrong                  -> paused for 30 minutes again
--   - a correct sign-in, a password change/reset, or a day with no
--     wrong attempts starts the count afresh
--   - per IP address: 20 sign-in attempts per 15 minutes, 100 per day
--
-- How it fits together:
--   1. The app signs in through the `secure-sign-in` Edge Function, which calls
--      login_guard_check() first, then Supabase Auth, then records the result.
--   2. The Custom Access Token hook below refuses to issue a session for a
--      password sign-in while the account is locked, so a lock also holds for
--      anyone calling the Supabase sign-in API directly.
--   3. Unknown emails are counted and locked the same way, so the lockout never
--      reveals which emails have an account.
--
-- Turn the hook on once: Supabase dashboard -> Authentication -> Hooks ->
-- "Customize Access Token (JWT) Claims" -> Postgres -> public.nebedahub_access_token_hook
-- Safe to run more than once.
-- ============================================================

create table if not exists public.login_lockouts (
  email text primary key,                 -- lower-cased
  failures int not null default 0,        -- wrong attempts since the last lock (or since the start)
  first_failed_at timestamptz,
  locked_until timestamptz,
  lockouts int not null default 0,        -- how many times this email has been locked recently
  updated_at timestamptz not null default now()
);
alter table public.login_lockouts enable row level security;
revoke all on public.login_lockouts from anon, authenticated, public;

create table if not exists public.login_ip_attempts (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists login_ip_attempts_ip_at on public.login_ip_attempts (ip, at);
create index if not exists login_ip_attempts_at on public.login_ip_attempts (at);
alter table public.login_ip_attempts enable row level security;
revoke all on public.login_ip_attempts from anon, authenticated, public;

-- Message shown when an account is locked (same wording everywhere).
create or replace function public.login_lock_message(p_seconds int)
returns text language sql immutable set search_path = '' as $$
  select 'Too many failed sign-in attempts. Sign-in for this account is paused for about '
    || greatest(1, ceil(p_seconds / 60.0))::int
    || case when greatest(1, ceil(p_seconds / 60.0))::int = 1 then ' minute' else ' minutes' end
    || '. You can reset your password to get back in straight away.';
$$;

-- Before checking a password: IP limits, then the account lock.
-- Returns {status: 'ok'} or {status: 'ip_limited' | 'locked', retry_after, message}.
create or replace function public.login_guard_check(p_email text, p_ip text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e text := lower(trim(p_email));
  v_ip text := coalesce(nullif(trim(p_ip), ''), 'unknown');
  n15 int; nday int; oldest timestamptz; v_until timestamptz; wait int;
begin
  -- occasional clean-up of old attempt records
  if random() < 0.02 then
    delete from public.login_ip_attempts where at < now() - interval '1 day';
    delete from public.login_lockouts
      where updated_at < now() - interval '1 day' and (locked_until is null or locked_until < now());
  end if;

  select count(*) filter (where at > now() - interval '15 minutes'), count(*)
    into n15, nday
    from public.login_ip_attempts where ip = v_ip and at > now() - interval '1 day';
  if n15 >= 20 then
    select min(at) into oldest from public.login_ip_attempts
      where ip = v_ip and at > now() - interval '15 minutes';
    wait := greatest(1, ceil(extract(epoch from (oldest + interval '15 minutes' - now()))))::int;
    return jsonb_build_object('status', 'ip_limited', 'retry_after', wait,
      'message', 'Too many sign-in attempts from this network. Please wait ' || greatest(1, ceil(wait / 60.0))::int || ' minute(s) and try again.');
  end if;
  if nday >= 100 then
    return jsonb_build_object('status', 'ip_limited', 'retry_after', 3600,
      'message', 'Too many sign-in attempts from this network today. Please try again later.');
  end if;
  insert into public.login_ip_attempts (ip) values (v_ip);

  select locked_until into v_until from public.login_lockouts where email = e;
  if v_until is not null and v_until > now() then
    wait := ceil(extract(epoch from (v_until - now())))::int;
    return jsonb_build_object('status', 'locked', 'retry_after', wait, 'message', public.login_lock_message(wait));
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- After a wrong password. Returns {status: 'failed', remaining} or {status: 'locked', retry_after, message, lockouts}.
create or replace function public.login_guard_failure(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e text := lower(trim(p_email));
  r public.login_lockouts%rowtype;
  allowed int; v_until timestamptz; wait int; have boolean;
begin
  select * into r from public.login_lockouts where email = e for update;
  have := found;
  -- a clean day (and no active lock) starts afresh
  if have and r.updated_at < now() - interval '1 day' and (r.locked_until is null or r.locked_until < now()) then
    delete from public.login_lockouts where email = e;
    have := false;
  end if;
  if not have then
    insert into public.login_lockouts (email, failures, first_failed_at, lockouts, updated_at)
      values (e, 1, now(), 0, now())
      on conflict (email) do update set failures = 1, first_failed_at = now(), locked_until = null, lockouts = 0, updated_at = now()
      returning * into r;
  else
    if r.first_failed_at is not null and r.first_failed_at > now() - interval '15 minutes' then
      r.failures := r.failures + 1;
    else
      r.failures := 1; r.first_failed_at := now();
    end if;
    update public.login_lockouts set failures = r.failures, first_failed_at = r.first_failed_at, updated_at = now() where email = e;
  end if;

  allowed := case when r.lockouts > 0 then 2 else 3 end;
  if r.failures < allowed then
    return jsonb_build_object('status', 'failed', 'remaining', allowed - r.failures);
  end if;

  v_until := now() + case when r.lockouts = 0 then interval '15 minutes' else interval '30 minutes' end;
  update public.login_lockouts
     set failures = 0, first_failed_at = null, locked_until = v_until, lockouts = r.lockouts + 1, updated_at = now()
   where email = e;
  wait := ceil(extract(epoch from (v_until - now())))::int;
  return jsonb_build_object('status', 'locked', 'retry_after', wait, 'message', public.login_lock_message(wait), 'lockouts', r.lockouts + 1);
end $$;

-- After a correct password.
create or replace function public.login_guard_success(p_email text)
returns void language sql security definer set search_path = '' as $$
  delete from public.login_lockouts where email = lower(trim(p_email));
$$;

-- Only the Edge Function (service role) may call these.
revoke execute on function public.login_guard_check(text, text) from public, anon, authenticated;
revoke execute on function public.login_guard_failure(text) from public, anon, authenticated;
revoke execute on function public.login_guard_success(text) from public, anon, authenticated;
grant execute on function public.login_guard_check(text, text) to service_role;
grant execute on function public.login_guard_failure(text) to service_role;
grant execute on function public.login_guard_success(text) to service_role;

-- A password change or reset always unlocks sign-in.
create or replace function public.login_lockout_clear_on_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password and new.email is not null then
    delete from public.login_lockouts where email = lower(new.email);
  end if;
  return new;
end $$;
revoke execute on function public.login_lockout_clear_on_password_change() from public, anon, authenticated;
drop trigger if exists login_lockout_clear_on_password_change on auth.users;
create trigger login_lockout_clear_on_password_change
  after update of encrypted_password on auth.users
  for each row execute function public.login_lockout_clear_on_password_change();

-- Custom Access Token hook: no session for a password sign-in while the account is locked.
-- Everything else (token refresh, reset links, sign-up confirmation) is left alone.
create or replace function public.nebedahub_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_until timestamptz; wait int;
begin
  if event->>'authentication_method' = 'password' then
    select l.locked_until into v_until
      from public.login_lockouts l
     where l.email = lower(coalesce(event->'claims'->>'email', ''));
    if v_until is not null and v_until > now() then
      wait := ceil(extract(epoch from (v_until - now())))::int;
      return jsonb_build_object('error', jsonb_build_object('http_code', 429, 'message', public.login_lock_message(wait)));
    end if;
  end if;
  return event;
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.nebedahub_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function public.login_lock_message(int) to supabase_auth_admin;
revoke execute on function public.nebedahub_access_token_hook(jsonb) from public, anon, authenticated;
grant select on public.login_lockouts to supabase_auth_admin;
drop policy if exists "auth server reads lockouts" on public.login_lockouts;
create policy "auth server reads lockouts" on public.login_lockouts
  for select to supabase_auth_admin using (true);
