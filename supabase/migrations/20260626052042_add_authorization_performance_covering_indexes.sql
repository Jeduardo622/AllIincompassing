-- @migration-intent: Restore planner coverage for Supabase performance advisor findings on authorization_services.organization_id and client_session_notes.authorization_id.
-- @migration-dependencies: 20251224161628_20251224120000_authorizations_org_scope.sql, 20260417120000_unused_index_drop_throughput_gamma_win35.sql
-- @migration-scope: Index-only; no table, RLS, grant, RPC, or data changes.
-- @migration-rollback: drop index if exists public.authorization_services_org_auth_idx; drop index if exists public.client_session_notes_authorization_id_idx;

begin;

set search_path = public;

create index if not exists authorization_services_org_auth_idx
  on public.authorization_services (organization_id, authorization_id);

create index if not exists client_session_notes_authorization_id_idx
  on public.client_session_notes (authorization_id);

commit;
