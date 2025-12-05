-- Replay placeholder for migration 20251120174500_single_org_admin_support
-- This migration was executed directly against the hosted database to unblock
-- single-organization admin flows during drift remediation. Its logic already
-- lives in earlier checked-in migrations, so we leave this file intentionally
-- blank to mirror the production schema_migrations history.
begin;

set search_path = public, auth;

-- Ensure organization-aware helpers always resolve the single-tenant org.
create or replace function get_organization_id_from_metadata(p_metadata jsonb)
returns uuid
language sql
immutable
as $$
  select coalesce(
    (
      case
        when p_metadata ? 'organization_id'
          and (p_metadata->>'organization_id') ~* '^[0-9a-fA-F-]{36}$'
        then (p_metadata->>'organization_id')::uuid
      end
    ),
    (
      case
        when p_metadata ? 'organizationId'
          and (p_metadata->>'organizationId') ~* '^[0-9a-fA-F-]{36}$'
        then (p_metadata->>'organizationId')::uuid
      end
    ),
    '5238e88b-6198-4862-80a2-dbe15bbeabdd'::uuid
  );
$$;

-- Normalize existing user metadata to include the canonical organization id.
update auth.users
set raw_user_meta_data = jsonb_set(
  jsonb_set(
    coalesce(raw_user_meta_data, '{}'::jsonb),
    '{organization_id}',
    to_jsonb('5238e88b-6198-4862-80a2-dbe15bbeabdd'::text),
    true
  ),
  '{organizationId}',
  to_jsonb('5238e88b-6198-4862-80a2-dbe15bbeabdd'::text),
  true
);

commit;


