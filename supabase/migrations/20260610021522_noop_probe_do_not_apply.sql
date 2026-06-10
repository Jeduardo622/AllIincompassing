-- @migration-intent: Preserve hosted migration history after a no-op Supabase tool probe executed during the session_goals disappearance trace.
-- @migration-dependencies: none
-- @migration-rollback: No rollback required; this migration intentionally performs no schema or data changes.

set search_path = public;

select 1;
