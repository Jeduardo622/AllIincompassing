-- @migration-intent: Conservative unused-index retirement batch 3 (audit tables, non-unique indexes; MCP advisor 2026-04-14).
-- @migration-dependencies: 20260413140000_unused_index_drop_batch2.sql
-- @migration-rollback: Recreate dropped indexes if admin or impersonation lookups by user regress.

begin;

set search_path = public;

drop index if exists public.admin_actions_admin_user_id_idx;
drop index if exists public.impersonation_audit_actor_user_id_idx;

commit;
