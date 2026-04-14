-- @migration-intent: Remove legacy consolidated_* permissive policies on public.admin_actions that duplicate scoped admin_actions_insert_only / admin_actions_select_scoped (advisor multiple_permissive_policies).
-- @migration-dependencies: 20260415100000_unused_index_drop_batch4.sql,20251224120000_metadata_constraints_and_impersonation_queue.sql
-- @migration-rollback: Recreate prior consolidated_* policy definitions only if a historical migration documents them; prefer restoring from backup if access regressions occur.

begin;

set search_path = public;

do $$
begin
  if to_regclass('public.admin_actions') is not null then
    execute 'drop policy if exists consolidated_insert_700633 on public.admin_actions';
    execute 'drop policy if exists consolidated_select_700633 on public.admin_actions';
  end if;
end $$;

commit;
