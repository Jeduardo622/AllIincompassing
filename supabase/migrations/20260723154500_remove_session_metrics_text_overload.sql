-- @migration-intent: Remove the legacy text overload so PostgREST resolves session metrics calls to the date signature without ambiguity.
-- @migration-dependencies: 20251231150000_lock_down_scheduling_rpcs.sql
-- @migration-rollback: Recreate the reviewed text wrapper from 20251231150000, revoke execute from PUBLIC and anon, grant execute to authenticated, then reload the PostgREST schema.

begin;

drop function if exists public.get_session_metrics(text, text, uuid, uuid);

notify pgrst, 'reload schema';

commit;
