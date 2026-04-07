-- @migration-intent: Nullable org/creator columns before 20251224093500_client_flow_rls (policies reference organization_id). Full backfill + NOT NULL + RLS refresh remains in 20251224161628_20251224120000_authorizations_org_scope.sql.
-- @migration-dependencies: public.authorizations, public.authorization_services, public.organizations
-- @migration-rollback: (columns may be required by later migrations; do not drop here)

set search_path = public;

alter table public.authorizations
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists documents jsonb default '[]'::jsonb;

alter table public.authorization_services
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id);
