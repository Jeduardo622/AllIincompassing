-- @migration-intent: Repair hosted schema drift by ensuring client_session_notes.goal_measurements exists for Session Data Collection 2.0.
-- @migration-dependencies: 20260416141755_repair_client_session_notes_goal_ids_if_still_uuid.sql
-- @migration-rollback: alter table public.client_session_notes drop constraint if exists client_session_notes_goal_measurements_object_chk; alter table public.client_session_notes drop column if exists goal_measurements;

alter table public.client_session_notes
  add column if not exists goal_measurements jsonb;

comment on column public.client_session_notes.goal_measurements is
  'Session Data Collection 2.0: versioned per-goal measurement payload keyed by goal UUID.';

alter table public.client_session_notes
  drop constraint if exists client_session_notes_goal_measurements_object_chk;

alter table public.client_session_notes
  add constraint client_session_notes_goal_measurements_object_chk
  check (
    goal_measurements is null
    or jsonb_typeof(goal_measurements) = 'object'
  );
