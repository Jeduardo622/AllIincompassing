-- @migration-intent: Add goal_notes jsonb column to client_session_notes to persist per-goal narrative text keyed by goal UUID.
-- @migration-dependencies: 20250522035224_sweet_hall.sql
-- @migration-rollback: ALTER TABLE public.client_session_notes DROP COLUMN IF EXISTS goal_notes;

-- Add per-goal note text to client_session_notes.
--
-- goal_notes is a jsonb object keyed by goal UUID. Shape:
--   { "<goal_id>": "<note_text>" }
--
-- NULL when no per-goal notes were entered (existing notes stay valid).
-- The column is intentionally nullable so legacy rows require no backfill.

ALTER TABLE public.client_session_notes
  ADD COLUMN goal_notes jsonb NULL;

COMMENT ON COLUMN public.client_session_notes.goal_notes IS
  'Per-goal note text keyed by goal UUID. Shape: { "<goal_id>": "<note_text>" }. NULL when no per-goal notes entered.';
