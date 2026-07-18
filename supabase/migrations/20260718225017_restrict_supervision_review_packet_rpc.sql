-- @migration-intent: Restore the intended authenticated-only execute boundary after replacing the supervision review packet RPC.
-- @migration-dependencies: 20260718155154_return_bt_supervision_correction.sql
-- @migration-rollback: Regrant execute to public and anon only if unauthenticated supervision packet access is explicitly approved.

begin;

revoke all on function public.get_pending_supervision_review_packets() from public, anon;
revoke all on function public.get_pending_supervision_review_packets() from authenticated;
grant execute on function public.get_pending_supervision_review_packets() to authenticated, service_role;

commit;
