-- @migration-intent: Remove redundant overlapping permissive policies on low-risk telemetry/cache tables without changing intended access.
-- @migration-dependencies: 20260310162000_harden_ai_guidance_documents_rls.sql,20260310174500_fk_index_batch2_remaining.sql
-- @migration-rollback: Recreate dropped policies with their previous definitions if policy-access regressions are observed.

begin;

set search_path = public;

-- ai_cache: keep ai_cache_select_scope and remove redundant consolidated select policy
drop policy if exists consolidated_select_700633 on public.ai_cache;

-- ai_processing_logs: keep ai_processing_logs_select_scope and remove legacy duplicate select policy
drop policy if exists "Users can view AI processing logs for their sessions" on public.ai_processing_logs;

-- ai_response_cache: keep explicit admin/service-role policies and remove broad consolidated overlap
drop policy if exists consolidated_all_4c9184 on public.ai_response_cache;

commit;
