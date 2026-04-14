-- @migration-intent: WIN-35 S3 — drop redundant permissive policy ai_cache_admin_manage on public.ai_cache; scoped policies (insert/select/delete) retain equivalent admin predicates per 20251111103000_rls_phase3.sql.
-- @migration-dependencies: 20260416110000_unused_index_drop_beta_win35.sql
-- @migration-rollback: Recreate policy ai_cache_admin_manage from 20251014_rls_and_functions_hardening.sql if admin access regressions are observed.

begin;

set search_path = public;

do $$
begin
  if to_regclass('public.ai_cache') is not null then
    execute 'drop policy if exists ai_cache_admin_manage on public.ai_cache';
  end if;
end $$;

commit;
