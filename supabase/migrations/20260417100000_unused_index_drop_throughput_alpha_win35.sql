-- @migration-intent: WIN-35 throughput wave — alpha: five conservative unused-index drops (clients, client_issues, authorization_services, admin_actions, therapist_documents); MCP advisor 2026-04-17.
-- @migration-dependencies: 20260416120000_ai_cache_admin_manage_policy_drop.sql
-- @migration-rollback: Recreate dropped btree indexes from historical schema migrations if selective lookups regress.

begin;

set search_path = public;

drop index if exists public.clients_updated_by_idx;
drop index if exists public.client_issues_created_by_idx;
drop index if exists public.authorization_services_org_auth_idx;
drop index if exists public.admin_actions_organization_id_idx;
drop index if exists public.therapist_documents_org_id_idx;

commit;
