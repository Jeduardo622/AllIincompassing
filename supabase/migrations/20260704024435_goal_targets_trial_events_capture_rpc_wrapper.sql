-- @migration-intent: Expose the trial-event capture authorization RPC in the public PostgREST namespace.
-- @migration-dependencies: 20260703173000_goal_targets_trial_events.sql
-- @migration-rollback: Preserve this wrapper when replaying from repo migrations because 20260703173000 already creates it; only drop it in the legacy hosted chain after confirming no earlier applied migration created or depends on the public wrapper.

begin;

create or replace function public.current_user_can_capture_trial_event(target_organization_id uuid, target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select app.current_user_can_capture_trial_event(target_organization_id, target_client_id);
$$;

grant execute on function public.current_user_can_capture_trial_event(uuid, uuid) to authenticated, service_role;
revoke execute on function public.current_user_can_capture_trial_event(uuid, uuid) from public, anon;

notify pgrst, 'reload schema';

commit;
