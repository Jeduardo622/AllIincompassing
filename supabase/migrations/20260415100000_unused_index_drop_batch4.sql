-- @migration-intent: Conservative unused-index retirement batch 4 (feature_flag_plan_history lookup indexes; MCP advisor 2026-04-15).
-- @migration-dependencies: 20260414153000_unused_index_drop_batch3.sql
-- @migration-rollback: Recreate indexes from 20251223190000_view_security_and_indexes.sql if plan-history lookups regress.

begin;

set search_path = public;

drop index if exists public.feature_flag_plan_history_actor_id_idx;
drop index if exists public.feature_flag_plan_history_plan_code_idx;

commit;
