/*
  @migration-intent: Align dashboard client/therapist "active" counts with row status, not client created_at window.
  @migration-dependencies: 20260320120000_dashboard_authz_hardening.sql
  @migration-rollback: Re-apply prior get_dashboard_data body from 20260320120000_dashboard_authz_hardening.sql if emergency rollback is required.
  Remote project wnnjeqheqxxyrgsjmygy: applied via Supabase MCP apply_migration (version matches hosted history).
*/

set search_path = public;

begin;

create or replace function get_dashboard_data()
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_org uuid;
  v_is_org_admin boolean;
  v_is_super_admin boolean;
  result jsonb;
  today_sessions jsonb;
  incomplete_sessions jsonb;
  billing_alerts jsonb;
  client_metrics jsonb;
  therapist_metrics jsonb;
begin
  set local row_security = on;

  v_org := app.current_user_organization_id();
  if v_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  v_is_org_admin := app.user_has_role_for_org(
    app.current_user_id(),
    v_org,
    array['org_admin'::text, 'admin'::text]
  );
  v_is_super_admin := app.current_user_is_super_admin();

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
  from sessions s
  join therapists t on t.id = s.therapist_id
  join clients c on c.id = s.client_id
  where s.organization_id = v_org
    and t.organization_id = v_org
    and c.organization_id = v_org
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
  from sessions s
  join therapists t on t.id = s.therapist_id
  join clients c on c.id = s.client_id
  where s.organization_id = v_org
    and t.organization_id = v_org
    and c.organization_id = v_org
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
  from billing_records br
  where br.organization_id = v_org
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
  from clients c
  where c.organization_id = v_org;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where coalesce(nullif(trim(lower(t.status)), ''), 'active') = 'active'),
    'totalHours', coalesce(sum(coalesce(t.weekly_hours_max, 0)), 0)
  ) into therapist_metrics
  from therapists t
  where t.organization_id = v_org;

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

-- Preserve grants from prior migration
revoke execute on function get_dashboard_data() from authenticated;
grant execute on function get_dashboard_data() to dashboard_consumer;
grant execute on function get_dashboard_data() to service_role;

commit;
