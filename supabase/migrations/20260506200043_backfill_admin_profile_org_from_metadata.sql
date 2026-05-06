-- @migration-intent: Backfill admin profile organization_id from already-authoritative auth metadata so org-scoped admin access resolves correctly.
-- @migration-dependencies: public.profiles, public.user_roles, public.roles, public.get_organization_id_from_metadata(jsonb)
-- @migration-rollback: For affected users only, manually set public.profiles.organization_id back to null if the metadata-derived org was incorrect.

begin;

set local app.bypass_profile_role_guard = 'on';

with admin_profiles_to_backfill as (
  select
    p.id,
    public.get_organization_id_from_metadata(u.raw_user_meta_data) as metadata_org_id
  from auth.users u
  join public.profiles p on p.id = u.id
  join public.user_roles ur on ur.user_id = u.id
  join public.roles r on r.id = ur.role_id
  where r.name = 'admin'
    and coalesce(ur.is_active, true) = true
    and (ur.expires_at is null or ur.expires_at > now())
    and p.organization_id is null
    and public.get_organization_id_from_metadata(u.raw_user_meta_data) is not null
)
update public.profiles p
set organization_id = b.metadata_org_id,
    updated_at = now()
from admin_profiles_to_backfill b
where p.id = b.id;

commit;
