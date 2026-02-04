begin;

create or replace function public.get_sessions_optimized(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_therapist_id uuid default null,
  p_client_id uuid default null
)
returns table (session_data jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_user_organization_id();
begin
  if v_org is null then
    raise exception using errcode = '42501', message = 'Organization context is required';
  end if;

  return query
  select jsonb_build_object(
    'id', s.id,
    'start_time', s.start_time,
    'end_time', s.end_time,
    'status', s.status,
    'notes', s.notes,
    'created_at', s.created_at,
    'created_by', s.created_by,
    'updated_at', s.updated_at,
    'updated_by', s.updated_by,
    'therapist_id', s.therapist_id,
    'client_id', s.client_id,
    'program_id', s.program_id,
    'goal_id', s.goal_id,
    'started_at', s.started_at,
    'duration_minutes', s.duration_minutes,
    'location_type', s.location_type,
    'session_type', s.session_type,
    'rate_per_hour', s.rate_per_hour,
    'total_cost', s.total_cost,
    'therapist', jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'email', t.email,
      'service_type', t.service_type
    ),
    'client', jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'email', c.email,
      'service_preference', c.service_preference
    )
  ) as session_data
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
    and (p_therapist_id is null or s.therapist_id = p_therapist_id)
    and (p_client_id is null or s.client_id = p_client_id)
  order by s.start_time;
end;
$$;

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
      'id', s.id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'notes', s.notes,
      'created_at', s.created_at,
      'created_by', s.created_by,
      'updated_at', s.updated_at,
      'updated_by', s.updated_by,
      'therapist_id', s.therapist_id,
      'client_id', s.client_id,
      'program_id', s.program_id,
      'goal_id', s.goal_id,
      'started_at', s.started_at,
      'duration_minutes', s.duration_minutes,
      'location_type', s.location_type,
      'session_type', s.session_type,
      'rate_per_hour', s.rate_per_hour,
      'total_cost', s.total_cost,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  )
  into v_sessions
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
  order by s.start_time;

  select jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'email', t.email,
      'service_type', t.service_type
    )
  )
  into v_therapists
  from public.therapists t
  where t.organization_id = v_org
    and t.is_active = true
  order by t.full_name;

  select jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'email', c.email,
      'service_preference', c.service_preference
    )
  )
  into v_clients
  from public.clients c
  where c.organization_id = v_org
    and c.is_active = true
  order by c.full_name;

  return jsonb_build_object(
    'sessions', coalesce(v_sessions, '[]'::jsonb),
    'therapists', coalesce(v_therapists, '[]'::jsonb),
    'clients', coalesce(v_clients, '[]'::jsonb)
  );
end;
$$;

commit;
