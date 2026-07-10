-- @migration-intent: Keep the public goal-target delete capability wrapper invoker-scoped so the exposed RPC does not elevate authenticated callers.
-- @migration-dependencies: 20260710153231_goal_target_lifecycle_authz.sql
-- @migration-rollback: Restore SECURITY DEFINER only if the public wrapper must elevate callers; the app helper remains the narrowly scoped authority boundary.

begin;

alter function public.current_user_can_delete_goal_targets(uuid) security invoker;

notify pgrst, 'reload schema';

commit;
