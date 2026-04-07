-- @migration-intent: Remove redundant overlapping permissive policies on low-risk telemetry/cache tables without changing intended access.
-- @migration-dependencies: 20260310162000_harden_ai_guidance_documents_rls.sql,20260310174500_fk_index_batch2_remaining.sql
-- @migration-rollback: Recreate dropped policies with their previous definitions if policy-access regressions are observed.

begin;

set search_path = public;

-- Tables may be absent on full replay (see rls_phase3 / secure_misc_tables guards).
do $$
begin
  if to_regclass('public.ai_cache') is not null then
    execute 'drop policy if exists consolidated_select_700633 on public.ai_cache';
  end if;
  if to_regclass('public.ai_processing_logs') is not null then
    execute format(
      'drop policy if exists %I on public.ai_processing_logs',
      'Users can view AI processing logs for their sessions'
    );
  end if;
  if to_regclass('public.ai_response_cache') is not null then
    execute 'drop policy if exists consolidated_all_4c9184 on public.ai_response_cache';
  end if;
end $$;

commit;
