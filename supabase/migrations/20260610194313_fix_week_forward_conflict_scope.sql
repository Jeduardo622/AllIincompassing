-- @migration-intent: Restore the week-forward scheduling RPC when hosted migration history exists but the function is absent.
-- @migration-dependencies: 20260505190000_week_forward_admin_scheduling
-- @migration-rollback: Drop public.apply_schedule_week_forward(uuid[], timestamptz, timestamptz, date, text, boolean).

set search_path = public;

create or replace function public.apply_schedule_week_forward(
  p_source_session_ids uuid[],
  p_displayed_week_start timestamptz,
  p_displayed_week_end timestamptz,
  p_end_date date,
  p_time_zone text,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source_count integer := 0;
  v_generated_count integer := 0;
  v_generated_week_count integer := 0;
  v_conflict jsonb := '[]'::jsonb;
  v_created_sessions jsonb := '[]'::jsonb;
  v_source_org uuid;
  v_first_source record;
  v_source record;
  v_candidate record;
  v_created_session public.sessions;
  v_goal_linked_count integer := 0;
  v_local_start_date date;
  v_local_start_time time;
  v_duration interval;
  v_future_local_date date;
  v_existing_conflict record;
  v_generated_conflict record;
begin
  if v_actor_id is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED',
      'error_message', 'Authentication is required.'
    );
  end if;

  if p_source_session_ids is null or coalesce(array_length(p_source_session_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'success', false,
      'error_code', 'EMPTY_SOURCE',
      'error_message', 'At least one visible source session is required.'
    );
  end if;

  if p_displayed_week_start is null or p_displayed_week_end is null or p_displayed_week_end < p_displayed_week_start then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_WEEK_RANGE',
      'error_message', 'Displayed week range is invalid.'
    );
  end if;

  if p_end_date is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_END_DATE',
      'error_message', 'End date is required.'
    );
  end if;

  if coalesce(nullif(trim(p_time_zone), ''), '') = '' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_TIME_ZONE',
      'error_message', 'Time zone is required.'
    );
  end if;

  create temporary table if not exists week_forward_candidates (
    source_session_id uuid not null,
    organization_id uuid not null,
    therapist_id uuid not null,
    client_id uuid not null,
    program_id uuid not null,
    goal_id uuid not null,
    notes text null,
    location_type text null,
    session_type text null,
    duration_minutes integer null,
    rate_per_hour numeric null,
    total_cost numeric null,
    candidate_start timestamptz not null,
    candidate_end timestamptz not null
  ) on commit drop;

  truncate table week_forward_candidates;

  select count(*)
  into v_source_count
  from public.sessions s
  where s.id = any(p_source_session_ids);

  if v_source_count <> array_length(p_source_session_ids, 1) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'SOURCE_NOT_FOUND',
      'error_message', 'One or more source sessions are missing.'
    );
  end if;

  select s.*
  into v_first_source
  from public.sessions s
  where s.id = p_source_session_ids[1]
  limit 1;

  if v_first_source.id is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'SOURCE_NOT_FOUND',
      'error_message', 'Source sessions could not be loaded.'
    );
  end if;

  v_source_org := v_first_source.organization_id;

  if not (
    app.user_has_role_for_org('admin', v_source_org, v_first_source.therapist_id, v_first_source.client_id, v_first_source.id)
    or app.user_has_role_for_org('super_admin', v_source_org, v_first_source.therapist_id, v_first_source.client_id, v_first_source.id)
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Admin or super-admin access is required for week-forward scheduling.'
    );
  end if;

  for v_source in
    select s.*
    from public.sessions s
    where s.id = any(p_source_session_ids)
    order by s.start_time asc, s.id asc
  loop
    if v_source.organization_id <> v_source_org then
      return jsonb_build_object(
        'success', false,
        'error_code', 'CROSS_ORG_SOURCE',
        'error_message', 'All visible source sessions must belong to the same organization.'
      );
    end if;

    if v_source.status <> 'scheduled' then
      return jsonb_build_object(
        'success', false,
        'error_code', 'SOURCE_STATUS_INVALID',
        'error_message', 'All visible source sessions must be scheduled before applying this week forward.'
      );
    end if;

    if v_source.start_time < p_displayed_week_start or v_source.start_time > p_displayed_week_end then
      return jsonb_build_object(
        'success', false,
        'error_code', 'SOURCE_WEEK_MISMATCH',
        'error_message', 'All visible source sessions must belong to the displayed week.'
      );
    end if;

    v_local_start_date := (v_source.start_time at time zone p_time_zone)::date;
    v_local_start_time := (v_source.start_time at time zone p_time_zone)::time;
    v_duration := v_source.end_time - v_source.start_time;
    v_future_local_date := v_local_start_date + 7;

    while v_future_local_date <= p_end_date loop
      insert into week_forward_candidates (
        source_session_id,
        organization_id,
        therapist_id,
        client_id,
        program_id,
        goal_id,
        notes,
        location_type,
        session_type,
        duration_minutes,
        rate_per_hour,
        total_cost,
        candidate_start,
        candidate_end
      )
      values (
        v_source.id,
        v_source.organization_id,
        v_source.therapist_id,
        v_source.client_id,
        v_source.program_id,
        v_source.goal_id,
        v_source.notes,
        v_source.location_type,
        v_source.session_type,
        v_source.duration_minutes,
        v_source.rate_per_hour,
        v_source.total_cost,
        ((v_future_local_date::text || ' ' || v_local_start_time::text)::timestamp at time zone p_time_zone),
        (((v_future_local_date::text || ' ' || v_local_start_time::text)::timestamp at time zone p_time_zone) + v_duration)
      );

      v_future_local_date := v_future_local_date + 7;
    end loop;
  end loop;

  select count(*), coalesce(count(distinct date_trunc('week', candidate_start at time zone p_time_zone)), 0)
  into v_generated_count, v_generated_week_count
  from week_forward_candidates;

  select
    c.source_session_id,
    e.id as conflicting_session_id,
    c.candidate_start,
    c.candidate_end,
    c.therapist_id,
    c.client_id,
    case
      when e.therapist_id = c.therapist_id then 'THERAPIST_CONFLICT'
      else 'CLIENT_CONFLICT'
    end as conflict_code,
    case
      when e.therapist_id = c.therapist_id then 'Therapist already has a session during this time.'
      else 'Client already has a session during this time.'
    end as conflict_message
  into v_existing_conflict
  from week_forward_candidates c
  join public.sessions e
    on e.organization_id = c.organization_id
   and e.status <> 'cancelled'
   and tstzrange(e.start_time, e.end_time, '[)') && tstzrange(c.candidate_start, c.candidate_end, '[)')
   and (
     e.therapist_id = c.therapist_id
     or e.client_id = c.client_id
   )
  order by c.candidate_start asc, c.source_session_id asc
  limit 1;

  if v_existing_conflict.source_session_id is not null then
    v_conflict := jsonb_build_array(
      jsonb_build_object(
        'sourceSessionId', v_existing_conflict.source_session_id,
        'conflictingSessionId', v_existing_conflict.conflicting_session_id,
        'startTime', v_existing_conflict.candidate_start,
        'endTime', v_existing_conflict.candidate_end,
        'therapistId', v_existing_conflict.therapist_id,
        'clientId', v_existing_conflict.client_id,
        'code', v_existing_conflict.conflict_code,
        'message', v_existing_conflict.conflict_message
      )
    );

    return jsonb_build_object(
      'success', false,
      'error_code', v_existing_conflict.conflict_code,
      'error_message', v_existing_conflict.conflict_message,
      'source_session_count', v_source_count,
      'generated_session_count', v_generated_count,
      'generated_week_count', v_generated_week_count,
      'end_date', p_end_date,
      'conflicts', v_conflict
    );
  end if;

  select
    c1.source_session_id,
    c1.candidate_start,
    c1.candidate_end,
    c1.therapist_id,
    c1.client_id,
    case
      when c1.therapist_id = c2.therapist_id then 'THERAPIST_CONFLICT'
      else 'CLIENT_CONFLICT'
    end as conflict_code,
    case
      when c1.therapist_id = c2.therapist_id then 'Generated sessions would overlap for the same therapist.'
      else 'Generated sessions would overlap for the same client.'
    end as conflict_message
  into v_generated_conflict
  from week_forward_candidates c1
  join week_forward_candidates c2
    on c1.source_session_id <> c2.source_session_id
   and c1.candidate_start < c2.candidate_end
   and c2.candidate_start < c1.candidate_end
   and (
     c1.therapist_id = c2.therapist_id
     or c1.client_id = c2.client_id
   )
  order by c1.candidate_start asc, c1.source_session_id asc
  limit 1;

  if v_generated_conflict.source_session_id is not null then
    v_conflict := jsonb_build_array(
      jsonb_build_object(
        'sourceSessionId', v_generated_conflict.source_session_id,
        'startTime', v_generated_conflict.candidate_start,
        'endTime', v_generated_conflict.candidate_end,
        'therapistId', v_generated_conflict.therapist_id,
        'clientId', v_generated_conflict.client_id,
        'code', v_generated_conflict.conflict_code,
        'message', v_generated_conflict.conflict_message
      )
    );

    return jsonb_build_object(
      'success', false,
      'error_code', v_generated_conflict.conflict_code,
      'error_message', v_generated_conflict.conflict_message,
      'source_session_count', v_source_count,
      'generated_session_count', v_generated_count,
      'generated_week_count', v_generated_week_count,
      'end_date', p_end_date,
      'conflicts', v_conflict
    );
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'success', true,
      'source_session_count', v_source_count,
      'generated_session_count', v_generated_count,
      'generated_week_count', v_generated_week_count,
      'end_date', p_end_date,
      'conflicts', '[]'::jsonb
    );
  end if;

  for v_candidate in
    select *
    from week_forward_candidates
    order by candidate_start asc, source_session_id asc
  loop
    insert into public.sessions (
      organization_id,
      therapist_id,
      client_id,
      program_id,
      goal_id,
      start_time,
      end_time,
      status,
      notes,
      location_type,
      session_type,
      duration_minutes,
      rate_per_hour,
      total_cost
    )
    values (
      v_candidate.organization_id,
      v_candidate.therapist_id,
      v_candidate.client_id,
      v_candidate.program_id,
      v_candidate.goal_id,
      v_candidate.candidate_start,
      v_candidate.candidate_end,
      'scheduled',
      v_candidate.notes,
      v_candidate.location_type,
      v_candidate.session_type,
      v_candidate.duration_minutes,
      v_candidate.rate_per_hour,
      v_candidate.total_cost
    )
    returning *
    into v_created_session;

    v_goal_linked_count := 0;

    insert into public.session_goals (
      session_id,
      goal_id,
      organization_id,
      client_id,
      program_id
    )
    select
      v_created_session.id,
      sg.goal_id,
      v_created_session.organization_id,
      v_created_session.client_id,
      v_created_session.program_id
    from public.session_goals sg
    where sg.session_id = v_candidate.source_session_id
    on conflict (session_id, goal_id) do nothing;

    get diagnostics v_goal_linked_count = row_count;

    if coalesce(v_goal_linked_count, 0) = 0 then
      insert into public.session_goals (
        session_id,
        goal_id,
        organization_id,
        client_id,
        program_id
      )
      values (
        v_created_session.id,
        v_created_session.goal_id,
        v_created_session.organization_id,
        v_created_session.client_id,
        v_created_session.program_id
      )
      on conflict (session_id, goal_id) do nothing;
    end if;

    v_created_sessions := v_created_sessions || jsonb_build_array(
      jsonb_build_object(
        'id', v_created_session.id,
        'client_id', v_created_session.client_id,
        'therapist_id', v_created_session.therapist_id,
        'program_id', v_created_session.program_id,
        'goal_id', v_created_session.goal_id,
        'start_time', v_created_session.start_time,
        'end_time', v_created_session.end_time,
        'status', v_created_session.status,
        'notes', v_created_session.notes,
        'created_at', v_created_session.created_at,
        'created_by', v_created_session.created_by,
        'updated_at', v_created_session.updated_at,
        'updated_by', v_created_session.updated_by,
        'duration_minutes', v_created_session.duration_minutes,
        'location_type', v_created_session.location_type,
        'session_type', v_created_session.session_type,
        'rate_per_hour', v_created_session.rate_per_hour,
        'total_cost', v_created_session.total_cost
      )
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'source_session_count', v_source_count,
    'generated_session_count', v_generated_count,
    'generated_week_count', v_generated_week_count,
    'end_date', p_end_date,
    'conflicts', '[]'::jsonb,
    'created_sessions', v_created_sessions
  );
end;
$$;

revoke execute on function public.apply_schedule_week_forward(uuid[], timestamptz, timestamptz, date, text, boolean) from public;
revoke execute on function public.apply_schedule_week_forward(uuid[], timestamptz, timestamptz, date, text, boolean) from anon;
grant execute on function public.apply_schedule_week_forward(uuid[], timestamptz, timestamptz, date, text, boolean) to authenticated;

notify pgrst, 'reload schema';
