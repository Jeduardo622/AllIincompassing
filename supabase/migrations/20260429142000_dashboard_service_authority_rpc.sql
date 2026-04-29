/*
  @migration-intent: Add a service-role-only dashboard authority RPC for Edge-mediated dashboard aggregation.
  @migration-dependencies: 20260421223930_fix_dashboard_active_counts.sql
  @migration-rollback: DROP FUNCTION IF EXISTS public.get_dashboard_data_for_org(uuid, uuid); keep direct get_dashboard_data() authenticated execute revoked.
*/

set search_path = public;

begin;

create or replace function public.get_dashboard_data_for_org(
  actor_user_id uuid,
  target_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_actor_org uuid;
  v_actor_active boolean := false;
  v_is_org_admin boolean := false;
  v_is_super_admin boolean := false;
  result jsonb;
  today_sessions jsonb;
  incomplete_sessions jsonb;
  billing_alerts jsonb;
  client_metrics jsonb;
  therapist_metrics jsonb;
begin
  if actor_user_id is null then
    raise exception using errcode = '42501', message = 'Dashboard actor required';
  end if;

  if target_organization_id is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = actor_user_id
      and coalesce(p.is_active, true) = true
  ) into v_actor_active;

  if coalesce(v_actor_active, false) is not true then
    raise exception using errcode = '42501', message = 'Active dashboard actor required';
  end if;

  select app.resolve_user_organization_id(actor_user_id)
  into v_actor_org;

  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = actor_user_id
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
      and r.name = 'super_admin'
  ) into v_is_super_admin;

  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = actor_user_id
      and v_actor_org = target_organization_id
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
      and r.name in ('admin', 'org_admin', 'org_super_admin')
  ) into v_is_org_admin;

  if coalesce(v_is_org_admin, false) is not true and coalesce(v_is_super_admin, false) is not true then
    raise exception using errcode = '42501', message = 'Admin dashboard access required';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'client_id', s.client_id,
      'therapist_id', s.therapist_id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  ) into today_sessions
  from public.sessions s
  join public.therapists t on t.id = s.therapist_id
  join public.clients c on c.id = s.client_id
  where s.organization_id = target_organization_id
    and t.organization_id = target_organization_id
    and c.organization_id = target_organization_id
    and date(s.start_time at time zone 'UTC') = current_date;

  select jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'client_id', s.client_id,
      'therapist_id', s.therapist_id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  ) into incomplete_sessions
  from public.sessions s
  join public.therapists t on t.id = s.therapist_id
  join public.clients c on c.id = s.client_id
  where s.organization_id = target_organization_id
    and t.organization_id = target_organization_id
    and c.organization_id = target_organization_id
    and s.status = 'completed'
    and (s.notes is null or s.notes = '');

  select jsonb_agg(
    jsonb_build_object(
      'id', br.id,
      'session_id', br.session_id,
      'amount', br.amount,
      'status', br.status,
      'created_at', br.created_at
    )
  ) into billing_alerts
  from public.billing_records br
  where br.organization_id = target_organization_id
    and br.status in ('pending', 'rejected');

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where coalesce(nullif(trim(lower(c.status)), ''), 'active') = 'active'),
    'totalUnits', coalesce(sum(
      coalesce(c.one_to_one_units, 0) +
      coalesce(c.supervision_units, 0) +
      coalesce(c.parent_consult_units, 0)
    ), 0)
  ) into client_metrics
  from public.clients c
  where c.organization_id = target_organization_id;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where coalesce(nullif(trim(lower(t.status)), ''), 'active') = 'active'),
    'totalHours', coalesce(sum(coalesce(t.weekly_hours_max, 0)), 0)
  ) into therapist_metrics
  from public.therapists t
  where t.organization_id = target_organization_id;

  result := jsonb_build_object(
    'todaySessions', coalesce(today_sessions, '[]'::jsonb),
    'incompleteSessions', coalesce(incomplete_sessions, '[]'::jsonb),
    'billingAlerts', coalesce(billing_alerts, '[]'::jsonb),
    'clientMetrics', coalesce(client_metrics, '{}'::jsonb),
    'therapistMetrics', coalesce(therapist_metrics, '{}'::jsonb)
  );

  return result;
end;
$$;

revoke all on function public.get_dashboard_data_for_org(uuid, uuid) from public;
revoke execute on function public.get_dashboard_data_for_org(uuid, uuid) from anon;
revoke execute on function public.get_dashboard_data_for_org(uuid, uuid) from authenticated;
revoke execute on function public.get_dashboard_data_for_org(uuid, uuid) from dashboard_consumer;
grant execute on function public.get_dashboard_data_for_org(uuid, uuid) to service_role;

-- Preserve the dashboard contract: browser-authenticated users cannot call the legacy aggregate RPC directly.
revoke execute on function public.get_dashboard_data() from public;
revoke execute on function public.get_dashboard_data() from anon;
revoke execute on function public.get_dashboard_data() from authenticated;
grant execute on function public.get_dashboard_data() to dashboard_consumer;
grant execute on function public.get_dashboard_data() to service_role;

commit;
