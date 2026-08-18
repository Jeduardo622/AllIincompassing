-- @migration-intent: Repair live Supabase performance advisor drift for admin_invite_tokens.target_therapist_id foreign-key coverage.
-- @migration-dependencies: 20260730170000_therapist_invite_target_lifecycle.sql
-- @migration-scope: Index-only; no table, RLS, grant, RPC, or data changes.
-- @migration-rollback: drop index if exists public.admin_invite_tokens_target_therapist_id_idx;

begin;

set search_path = public;

create index if not exists admin_invite_tokens_target_therapist_id_idx
  on public.admin_invite_tokens (target_therapist_id);

commit;
