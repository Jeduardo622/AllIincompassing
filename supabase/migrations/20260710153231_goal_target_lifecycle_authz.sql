-- @migration-intent: Add exact BCBA goal-target deletion authority while preserving organization scope and trial history.
-- @migration-dependencies: 20260706023600_bcba_exact_capability_matrix.sql,20260703173000_goal_targets_trial_events.sql,20260707121500_super_admin_bcba_role_precedence.sql
-- @migration-rollback: Drop the goal-target delete policy and delete capability wrappers, then revoke DELETE on public.goal_targets from authenticated.

begin;

create or replace function app.current_user_can_delete_goal_targets(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_user_has_exact_role_for_org(
    target_organization_id,
    array['bcba']::text[]
  );
$$;

revoke execute on function app.current_user_can_delete_goal_targets(uuid) from public, anon;
grant execute on function app.current_user_can_delete_goal_targets(uuid) to authenticated, service_role;

create or replace function public.current_user_can_delete_goal_targets(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_user_can_delete_goal_targets(target_organization_id);
$$;

revoke execute on function public.current_user_can_delete_goal_targets(uuid) from public, anon;
grant execute on function public.current_user_can_delete_goal_targets(uuid) to authenticated, service_role;

revoke delete on table public.goal_targets from anon;
grant delete on table public.goal_targets to authenticated;

drop policy if exists goal_targets_bcba_delete_archived_unused on public.goal_targets;
create policy goal_targets_bcba_delete_archived_unused
  on public.goal_targets
  for delete
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_delete_goal_targets(organization_id)
    and status = 'archived'
    and not exists (
      select 1
      from public.trial_events
      where trial_events.target_id = goal_targets.id
    )
  );

notify pgrst, 'reload schema';

commit;
