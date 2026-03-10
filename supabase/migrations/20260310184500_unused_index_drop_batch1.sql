-- @migration-intent: Drop low-risk zero-scan non-unique indexes on small lookup-oriented tables.
-- @migration-dependencies: 20260310182500_policy_consolidation_batch1.sql
-- @migration-rollback: Recreate dropped indexes with original names/columns if query performance regresses.

begin;

set search_path = public;

drop index if exists public.billing_modifiers_code_idx;
drop index if exists public.billing_modifiers_active_idx;
drop index if exists public.cpt_codes_code_idx;
drop index if exists public.cpt_codes_active_idx;
drop index if exists public.locations_name_idx;
drop index if exists public.service_lines_name_idx;
drop index if exists public.file_cabinet_settings_category_idx;

commit;
