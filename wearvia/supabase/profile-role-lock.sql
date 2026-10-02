-- ============================================================
-- profile-role-lock.sql — stop anyone making themselves an admin
--
-- WHY: the policy "profiles: update own or admin" lets a signed-in person
-- update their OWN profiles row. Nothing else stops them changing the
-- `role` column to 'admin' — which would give them full control of
-- NebedaHub (approve themselves, read every customer, order and chat).
-- This trigger is the lock that blocks it. It was referenced by the app
-- and the admin-bootstrap code but was missing from the SQL, so this file
-- adds it.
--
-- HOW TO APPLY: Supabase → SQL Editor → paste this whole file → Run.
-- Safe to run more than once. It changes no data.
--
-- CHECK IT WORKED afterwards (should list wv_profiles_lock_role):
--   select tgname from pg_trigger
--   where tgrelid = 'public.profiles'::regclass and not tgisinternal;
-- ============================================================

-- Only an existing admin may change someone's role. Everyone else keeps
-- the role they have; trying to change it is refused. This matches the
-- app's existing code, which already copes with the lock refusing:
--   * a new seller's customer→supplier upgrade just stays "customer" if
--     refused (public.wearvia_after_sign_in, "exception when others");
--   * the first-admin bootstrap turns this trigger off for its one change
--     (public.wearvia_make_admin / set-admin function).
create or replace function public.wv_lock_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an administrator can change a profile role.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- A plain "user" trigger, so `alter table public.profiles disable trigger user`
-- in the admin-bootstrap function switches it off for that one change.
drop trigger if exists wv_profiles_lock_role on public.profiles;
create trigger wv_profiles_lock_role
  before update of role on public.profiles
  for each row execute function public.wv_lock_profile_role();

-- Belt and braces: make sure nobody signed in can write the role column
-- directly even if default grants are loose. (RLS still limits which rows;
-- this limits which columns.) The app never needs to; roles are set by the
-- security-definer functions above.
revoke update (role) on public.profiles from anon, authenticated;

notify pgrst, 'reload schema';
