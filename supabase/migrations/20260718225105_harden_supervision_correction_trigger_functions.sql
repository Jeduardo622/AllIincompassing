-- @migration-intent: Pin search paths and remove direct browser execution from the correction-history trigger functions.
-- @migration-dependencies: 20260718155154_return_bt_supervision_correction.sql
-- @migration-rollback: Restore the prior mutable search paths and default execute grants only if explicitly required by a reviewed caller.

begin;

alter function public.guard_supervision_session_note_corrections_update() set search_path = '';
alter function public.prevent_supervision_session_note_corrections_delete() set search_path = '';
alter function public.prevent_bt_session_note_amendment_mutations() set search_path = '';

revoke all on function public.guard_supervision_session_note_corrections_update() from public, anon, authenticated;
revoke all on function public.prevent_supervision_session_note_corrections_delete() from public, anon, authenticated;
revoke all on function public.prevent_bt_session_note_amendment_mutations() from public, anon, authenticated;

commit;
