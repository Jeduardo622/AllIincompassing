-- @migration-intent: Backfill the primary session_goals row for already-started sessions whose goal linkage disappeared after confirm/start persistence.
-- @migration-dependencies: 20260402182221_repair_goal_notes_and_session_goals_close_notes.sql,20251111130500_session_audit_rpc_wrapper.sql
-- @migration-rollback: Remove rows identified by the paired session_goals_backfilled audit events if rollback is required and no downstream note coverage depends on them.

set search_path = public;

with target_sessions as (
  select
    s.id as session_id,
    s.organization_id,
    s.client_id,
    s.program_id,
    s.goal_id
  from public.sessions s
  where s.goal_id is not null
    and (
      s.started_at is not null
      or s.status in ('in_progress', 'completed', 'no-show')
    )
    and not exists (
      select 1
      from public.session_goals sg
      where sg.session_id = s.id
    )
),
inserted_session_goals as (
  insert into public.session_goals (
    session_id,
    goal_id,
    organization_id,
    client_id,
    program_id
  )
  select
    ts.session_id,
    ts.goal_id,
    ts.organization_id,
    ts.client_id,
    ts.program_id
  from target_sessions ts
  on conflict (session_id, goal_id) do nothing
  returning session_id, goal_id, organization_id
)
insert into public.session_audit_logs (
  session_id,
  organization_id,
  therapist_id,
  actor_id,
  event_type,
  event_payload
)
select
  s.id,
  s.organization_id,
  s.therapist_id,
  null,
  'session_goals_backfilled',
  jsonb_build_object(
    'repair', '20260610021608_backfill_started_sessions_missing_session_goals',
    'goalId', isg.goal_id,
    'reason', 'missing_session_goals_for_started_session'
  )
from inserted_session_goals isg
join public.sessions s
  on s.id = isg.session_id;
