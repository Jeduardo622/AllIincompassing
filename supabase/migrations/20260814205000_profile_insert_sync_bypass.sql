-- @migration-intent: Let the trusted auth/profile sync insert path honor the same transaction-local profile authorization bypass already used by update guards.
-- @migration-dependencies: 20260313124500_profiles_insert_authz_guard.sql,20260407105500_enforce_profile_immutability_respect_bypass.sql,20260703195500_sync_user_profile_organization_scope.sql
-- @migration-rollback: Restore app.normalize_profile_insert_authz_fields() from 20260313124500_profiles_insert_authz_guard.sql in a compensating forward migration.

begin;

create or replace function app.normalize_profile_insert_authz_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  jwt_role text := current_setting('request.jwt.claim.role', true);
  is_service_role boolean := coalesce(jwt_role, '') = 'service_role';
begin
  if coalesce(current_setting('app.bypass_profile_role_guard', true), '') = 'on' then
    return new;
  end if;

  if is_service_role or app.current_user_is_super_admin() then
    return new;
  end if;

  new.role := 'client'::role_type;
  new.organization_id := null;
  new.is_active := coalesce(new.is_active, true);
  return new;
end;
$$;

commit;
