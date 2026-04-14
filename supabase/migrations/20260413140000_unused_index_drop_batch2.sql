-- @migration-intent: Conservative unused-index retirement batch 2 (lookup-oriented, non-unique indexes).
-- @migration-dependencies: 20260310184500_unused_index_drop_batch1.sql
-- @migration-rollback: Recreate dropped indexes with original definitions if name search or plan-code lookups regress.

begin;

set search_path = public;

drop index if exists public.referring_providers_name_idx;
drop index if exists public.organization_plans_plan_code_idx;

commit;
