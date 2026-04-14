-- @migration-intent: WIN-35 throughput wave — beta: five unused-index drops (session_audit_logs, scheduling_orchestration_runs, impersonation_audit); disjoint tables from alpha; MCP advisor 2026-04-17.
-- @migration-dependencies: 20260417100000_unused_index_drop_throughput_alpha_win35.sql
-- @migration-rollback: Recreate dropped btree indexes if audit/orchestration lookups regress.

begin;

set search_path = public;

drop index if exists public.session_audit_logs_org_created_idx;
drop index if exists public.session_audit_logs_actor_created_idx;
drop index if exists public.scheduling_orchestration_runs_org_idx;
drop index if exists public.scheduling_orchestration_runs_request_idx;
drop index if exists public.impersonation_audit_target_idx;

commit;
