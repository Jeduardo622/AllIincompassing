-- @migration-intent: Return therapist/client availability_hours from get_dropdown_data and get_schedule_data_batch so Schedule conflict checks receive real weekly windows.
-- @migration-dependencies: 20251231150000_lock_down_scheduling_rpcs.sql, 20260224210217_fix_get_schedule_data_batch_deleted_filters.sql
-- @migration-rollback: Restore get_dropdown_data and get_schedule_data_batch from those dependencies (directory payloads without availability_hours columns).
--
-- Version aligned with Supabase hosted migration registry (20260408142721).

BEGIN;

create or replace function public.get_dropdown_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_user_organization_id();
  v_therapists jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_locations jsonb := '[]'::jsonb;
  v_has_org_col boolean;
begin
  if v_org is null then
    return jsonb_build_object(
      'therapists', v_therapists,
      'clients', v_clients,
      'locations', v_locations
    );
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'availability_hours', t.availability_hours
    )
    order by t.full_name
  )
  into v_therapists
  from (
    select distinct id, full_name, availability_hours
    from public.therapists
    where status = 'active'
      and organization_id = v_org
  ) t;

  select jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'availability_hours', c.availability_hours
    )
    order by c.full_name
  )
  into v_clients
  from (
    select distinct id, full_name, availability_hours
    from public.clients
    where organization_id = v_org
  ) c;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'locations'
      and column_name = 'organization_id'
  ) into v_has_org_col;

  if v_has_org_col then
    execute format($sql$
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from (
        select distinct id, name
        from public.locations
        where is_active = true and organization_id = $1
      ) l
    $sql$)
    into v_locations
    using v_org;
  else
    select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by name)
    into v_locations
    from (
      select distinct id, name
      from public.locations
      where is_active = true
    ) l;
  end if;

  return jsonb_build_object(
    'therapists', coalesce(v_therapists, '[]'::jsonb),
    'clients', coalesce(v_clients, '[]'::jsonb),
    'locations', coalesce(v_locations, '[]'::jsonb)
  );
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
      'service_type', src.service_type,
      'availability_hours', src.availability_hours
    )
    order by src.full_name
  )
  into v_therapists
  from (
    select t.id, t.full_name, t.email, t.service_type, t.availability_hours
    from public.therapists t
    where t.organization_id = v_org
      and t.deleted_at is null
  ) as src;

  select jsonb_agg(
    jsonb_build_object(
      'id', src.id,
      'full_name', src.full_name,
      'email', src.email,
      'service_preference', src.service_preference,
      'availability_hours', src.availability_hours
    )
    order by src.full_name
  )
  into v_clients
  from (
    select c.id, c.full_name, c.email, c.service_preference, c.availability_hours
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

COMMIT;
