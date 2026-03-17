-- @migration-intent: Ensure hold confirmation persists required program and goal identifiers when creating or updating sessions.
-- @migration-dependencies: 20260316160000_ensure_transcript_tables_exist.sql
-- @migration-rollback: Restore prior confirm_session_hold(uuid, jsonb) implementation if booking confirmation compatibility regressions are observed.

set search_path = public;

create or replace function public.confirm_session_hold(
  p_hold_key uuid,
  p_session jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold public.session_holds;
  v_session public.sessions;
  v_session_id uuid;
  v_therapist_id uuid;
  v_client_id uuid;
  v_program_id uuid;
  v_goal_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_notes text;
  v_location text;
  v_session_type text;
  v_rate numeric;
  v_total numeric;
  v_raw_duration numeric;
  v_duration integer;
  v_cpt_increment constant integer := 15;
  v_org uuid;
begin
  delete from public.session_holds
  where expires_at <= timezone('utc', now());

  select *
  into v_hold
  from public.session_holds
  where hold_key = p_hold_key
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'HOLD_NOT_FOUND', 'error_message', 'Hold has expired or does not exist.');
  end if;

  v_org := v_hold.organization_id;

  v_session_id := nullif(p_session->>'id', '')::uuid;
  v_therapist_id := nullif(p_session->>'therapist_id', '')::uuid;
  v_client_id := nullif(p_session->>'client_id', '')::uuid;
  v_program_id := nullif(p_session->>'program_id', '')::uuid;
  v_goal_id := nullif(p_session->>'goal_id', '')::uuid;
  v_start := nullif(p_session->>'start_time', '')::timestamptz;
  v_end := nullif(p_session->>'end_time', '')::timestamptz;
  v_status := coalesce(nullif(p_session->>'status', ''), 'scheduled');
  v_notes := nullif(p_session->>'notes', '');
  v_location := nullif(p_session->>'location_type', '');
  v_session_type := nullif(p_session->>'session_type', '');
  v_rate := nullif(p_session->>'rate_per_hour', '')::numeric;
  v_total := nullif(p_session->>'total_cost', '')::numeric;
  v_raw_duration := coalesce(
    nullif(p_session->>'duration_minutes', '')::numeric,
    (extract(epoch from (v_end - v_start)) / 60)::numeric
  );

  v_duration := greatest(v_cpt_increment, (round(v_raw_duration / v_cpt_increment)::int) * v_cpt_increment);

  if v_therapist_id is null or v_client_id is null or v_program_id is null or v_goal_id is null or v_start is null or v_end is null then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'MISSING_FIELDS', 'error_message', 'Missing required session fields.');
  end if;

  if v_hold.therapist_id <> v_therapist_id or v_hold.start_time <> v_start or v_hold.end_time <> v_end then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'HOLD_MISMATCH', 'error_message', 'Session details do not match the held slot.');
  end if;

  if v_hold.client_id <> v_client_id then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'CLIENT_MISMATCH', 'error_message', 'Client differs from the hold.');
  end if;

  if v_hold.expires_at <= timezone('utc', now()) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'HOLD_EXPIRED', 'error_message', 'Hold has expired.');
  end if;

  if not exists (
    select 1
    from public.therapists t
    where t.id = v_therapist_id
      and t.organization_id = v_org
  ) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'error_message', 'Therapist not in organization scope.');
  end if;

  if not exists (
    select 1
    from public.clients c
    where c.id = v_client_id
      and c.organization_id = v_org
  ) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'error_message', 'Client not in organization scope.');
  end if;

  if exists (
    select 1
    from public.sessions s
    where s.organization_id = v_org
      and s.therapist_id = v_therapist_id
      and (v_session_id is null or s.id <> v_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'THERAPIST_CONFLICT', 'error_message', 'Therapist already has a session during this time.');
  end if;

  if exists (
    select 1
    from public.sessions s
    where s.organization_id = v_org
      and s.client_id = v_client_id
      and (v_session_id is null or s.id <> v_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'CLIENT_CONFLICT', 'error_message', 'Client already has a session during this time.');
  end if;

  if v_session_id is null then
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
      rate_per_hour,
      total_cost,
      duration_minutes
    )
    values (
      v_org,
      v_therapist_id,
      v_client_id,
      v_program_id,
      v_goal_id,
      v_start,
      v_end,
      v_status,
      v_notes,
      v_location,
      v_session_type,
      v_rate,
      v_total,
      v_duration
    )
    returning * into v_session;
  else
    update public.sessions
    set
      organization_id = v_org,
      therapist_id = v_therapist_id,
      client_id = v_client_id,
      program_id = v_program_id,
      goal_id = v_goal_id,
      start_time = v_start,
      end_time = v_end,
      status = v_status,
      notes = v_notes,
      location_type = v_location,
      session_type = v_session_type,
      rate_per_hour = v_rate,
      total_cost = v_total,
      duration_minutes = v_duration
    where id = v_session_id
      and organization_id = v_org
    returning * into v_session;
  end if;

  delete from public.session_holds where id = v_hold.id;

  return jsonb_build_object('success', true, 'session', row_to_json(v_session));
end;
$$;
