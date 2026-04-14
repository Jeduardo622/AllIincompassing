-- @migration-intent: WIN-35 S2 — unused-index batch on tables disjoint from S1 (feature_flags, organization_plans, function_idempotency_keys); advisor unused_index 2026-04-16.
-- @migration-dependencies: 20260416100000_unused_index_drop_alpha_win35.sql
-- @migration-rollback: Recreate dropped btree indexes if plan-history / idempotency lookups regress.

begin;

set search_path = public;

drop index if exists public.feature_flags_created_by_idx;
drop index if exists public.feature_flags_updated_by_idx;
drop index if exists public.organization_plans_assigned_by_idx;
drop index if exists public.function_idempotency_keys_endpoint_created_idx;

commit;
