-- @migration-intent: Add versioned per-goal session measurement payload storage to client_session_notes for Session Data Collection 2.0.
-- @migration-dependencies: 20260402182221_repair_goal_notes_and_session_goals_close_notes.sql
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
