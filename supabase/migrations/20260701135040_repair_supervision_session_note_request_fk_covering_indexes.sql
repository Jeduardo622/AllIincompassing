-- @migration-intent: Repair live Supabase performance advisor drift for unindexed foreign keys on public.supervision_session_note_requests.
-- @migration-dependencies: 20260629233000_create_supervision_session_note_workflow.sql
-- @migration-scope: Index-only; no table, RLS, grant, RPC, or data changes.
-- @migration-rollback: drop index if exists public.supervision_session_note_requests_bt_therapist_id_idx; drop index if exists public.supervision_session_note_requests_client_id_idx; drop index if exists public.supervision_session_note_requests_requested_by_idx;

begin;

set search_path = public;

create index if not exists supervision_session_note_requests_bt_therapist_id_idx
  on public.supervision_session_note_requests (bt_therapist_id);

create index if not exists supervision_session_note_requests_client_id_idx
  on public.supervision_session_note_requests (client_id);

create index if not exists supervision_session_note_requests_requested_by_idx
  on public.supervision_session_note_requests (requested_by);

commit;
