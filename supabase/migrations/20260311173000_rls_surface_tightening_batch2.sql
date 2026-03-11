-- @migration-intent: Reduce overlapping permissive policy surface and tighten anonymous table grants on audit/telemetry scheduling tables.
-- @migration-dependencies: 20260310190000_auth_access_hardening.sql,20260310182500_policy_consolidation_batch1.sql
-- @migration-rollback: Recreate dropped legacy policies and re-grant anon access for impacted tables if client flows regress.

begin;

set search_path = public;

-- admin_actions: retain scoped insert/select policies and service-role manage policy.
drop policy if exists admin_actions_admin_read on public.admin_actions;
drop policy if exists admin_actions_admin_insert on public.admin_actions;

-- Harden anonymous grants on sensitive internal tables.
revoke all on table public.admin_actions from anon;
revoke all on table public.session_transcripts from anon;
revoke all on table public.session_transcript_segments from anon;
revoke all on table public.scheduling_orchestration_runs from anon;

commit;
