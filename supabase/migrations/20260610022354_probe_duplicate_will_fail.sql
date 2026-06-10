-- @migration-intent: Preserve hosted migration history after a transactional no-op Supabase tool probe executed during the session_goals disappearance trace.
-- @migration-dependencies: none
-- @migration-rollback: No rollback required; this migration intentionally performs no schema or data changes.

begin;
select 1;
rollback;
