-- @migration-intent: Repair hosted Supabase drift after PR #686 when the prior covering-index migration was present in repo history but absent from live migration history.
-- @migration-dependencies: 20260626052042_add_authorization_performance_covering_indexes.sql
-- @migration-scope: Index-only; no table, RLS, grant, RPC, or data changes.
-- @migration-rollback: drop index if exists public.authorization_services_org_auth_idx; drop index if exists public.client_session_notes_authorization_id_idx;

begin;

set search_path = public;

create index if not exists authorization_services_org_auth_idx
  on public.authorization_services (organization_id, authorization_id);

create index if not exists client_session_notes_authorization_id_idx
  on public.client_session_notes (authorization_id);

commit;
