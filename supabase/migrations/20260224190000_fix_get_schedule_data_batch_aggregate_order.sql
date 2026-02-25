begin;

create or replace function public.get_schedule_data_batch(
  p_start_date timestamptz,
  p_end_date timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_user_organization_id();
  v_sessions jsonb := '[]'::jsonb;
  v_therapists jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
begin
  if v_org is null then
    raise exception using errcode = '42501', message = 'Organization context is required';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', src.id,
      'start_time', src.start_time,
      'end_time', src.end_time,
      'status', src.status,
      'notes', src.notes,
      'created_at', src.created_at,
      'created_by', src.created_by,
      'updated_at', src.updated_at,
      'updated_by', src.updated_by,
      'therapist_id', src.therapist_id,
      'client_id', src.client_id,
      'program_id', src.program_id,
      'goal_id', src.goal_id,
      'started_at', src.started_at,
      'duration_minutes', src.duration_minutes,
      'location_type', src.location_type,
      'session_type', src.session_type,
      'rate_per_hour', src.rate_per_hour,
      'total_cost', src.total_cost,
      'therapist', jsonb_build_object(
        'id', src.therapist_entity_id,
        'full_name', src.therapist_full_name
      ),
      'client', jsonb_build_object(
        'id', src.client_entity_id,
        'full_name', src.client_full_name
      )
    )
    order by src.start_time
  )
  into v_sessions
  from (
    select
      s.id,
      s.start_time,
      s.end_time,
      s.status,
      s.notes,
      s.created_at,
      s.created_by,
      s.updated_at,
      s.updated_by,
      s.therapist_id,
      s.client_id,
      s.program_id,
      s.goal_id,
      s.started_at,
      s.duration_minutes,
      s.location_type,
      s.session_type,
      s.rate_per_hour,
      s.total_cost,
      t.id as therapist_entity_id,
      t.full_name as therapist_full_name,
      c.id as client_entity_id,
      c.full_name as client_full_name
    from public.sessions s
    join public.therapists t
      on s.therapist_id = t.id
     and t.organization_id = v_org
    join public.clients c
      on s.client_id = c.id
     and c.organization_id = v_org
    where s.organization_id = v_org
      and s.start_time >= p_start_date
      and s.start_time <= p_end_date
  ) as src;

  select jsonb_agg(
    jsonb_build_object(
      'id', src.id,
      'full_name', src.full_name,
      'email', src.email,
      'service_type', src.service_type
    )
    order by src.full_name
  )
  into v_therapists
  from (
    select t.id, t.full_name, t.email, t.service_type
    from public.therapists t
    where t.organization_id = v_org
      and t.deleted_at is null
  ) as src;

  select jsonb_agg(
    jsonb_build_object(
      'id', src.id,
      'full_name', src.full_name,
      'email', src.email,
      'service_preference', src.service_preference
    )
    order by src.full_name
  )
  into v_clients
  from (
    select c.id, c.full_name, c.email, c.service_preference
    from public.clients c
    where c.organization_id = v_org
      and c.deleted_at is null
  ) as src;

  return jsonb_build_object(
    'sessions', coalesce(v_sessions, '[]'::jsonb),
    'therapists', coalesce(v_therapists, '[]'::jsonb),
    'clients', coalesce(v_clients, '[]'::jsonb)
  );
end;
$$;

commit;
