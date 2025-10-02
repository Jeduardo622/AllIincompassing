set search_path = public;

create or replace function acquire_session_hold(
  p_therapist_id uuid,
  p_client_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_session_id uuid default null,
  p_hold_seconds integer default 300,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold session_holds;
  v_constraint_name text;
  v_original_sub text;
  v_original_role text;
  v_actor_is_authorized boolean;
begin
  delete from session_holds where expires_at <= timezone('utc', now());

  if p_actor_id is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Actor is required to manage session holds.'
    );
  end if;

  v_original_sub := current_setting('request.jwt.claim.sub', true);
  v_original_role := current_setting('request.jwt.claim.role', true);

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_actor_is_authorized := (
    app.user_has_role_for_org('therapist', null, p_therapist_id, null, p_session_id)
    or app.user_has_role_for_org('admin', null, p_therapist_id, null, p_session_id)
    or app.user_has_role_for_org('super_admin', null, p_therapist_id, null, p_session_id)
  );

  perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_original_role, ''), true);

  if not v_actor_is_authorized then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Actor is not permitted to manage holds for this therapist.'
    );
  end if;

  if p_start_time >= p_end_time then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_RANGE',
      'error_message', 'End time must be after start time.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.therapist_id = p_therapist_id
      and (p_session_id is null or s.id <> p_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_CONFLICT',
      'error_message', 'Therapist already has a session during this time.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.client_id = p_client_id
      and (p_session_id is null or s.id <> p_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_CONFLICT',
      'error_message', 'Client already has a session during this time.'
    );
  end if;

  if exists (
    select 1
    from session_holds h
    where h.therapist_id = p_therapist_id
      and h.expires_at > timezone('utc', now())
      and tstzrange(h.start_time, h.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_HOLD_CONFLICT',
      'error_message', 'Therapist already has a hold during this time.'
    );
  end if;

  if exists (
    select 1
    from session_holds h
    where h.client_id = p_client_id
      and h.expires_at > timezone('utc', now())
      and tstzrange(h.start_time, h.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_HOLD_CONFLICT',
      'error_message', 'Client already has a hold during this time.'
    );
  end if;

  begin
    insert into session_holds (
      therapist_id,
      client_id,
      start_time,
      end_time,
      session_id,
      expires_at
    )
    values (
      p_therapist_id,
      p_client_id,
      p_start_time,
      p_end_time,
      p_session_id,
      timezone('utc', now()) + make_interval(secs => coalesce(p_hold_seconds, 300))
    )
    returning * into v_hold;
  exception
    when unique_violation then
      return jsonb_build_object(
        'success', false,
        'error_code', 'HOLD_EXISTS',
        'error_message', 'A hold already exists for this time.'
      );
    when exclusion_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'session_holds_therapist_time_excl' then
        return jsonb_build_object(
          'success', false,
          'error_code', 'THERAPIST_HOLD_CONFLICT',
          'error_message', 'Therapist already has a hold during this time.'
        );
      elsif v_constraint_name = 'session_holds_client_time_excl' then
        return jsonb_build_object(
          'success', false,
          'error_code', 'CLIENT_HOLD_CONFLICT',
          'error_message', 'Client already has a hold during this time.'
        );
      else
        raise;
      end if;
  end;

  return jsonb_build_object(
    'success', true,
    'hold', row_to_json(v_hold)
  );
end;
$$;

create or replace function confirm_session_hold(
  p_hold_key uuid,
  p_session jsonb,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold session_holds;
  v_session sessions;
  v_session_id uuid;
  v_therapist_id uuid;
  v_client_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_notes text;
  v_location text;
  v_session_type text;
  v_rate numeric;
  v_total numeric;
  v_cpt_increment constant integer := 15;
  v_raw_duration numeric;
  v_duration integer;
  v_original_sub text;
  v_original_role text;
  v_actor_is_authorized boolean;
begin
  delete from session_holds where expires_at <= timezone('utc', now());

  if p_actor_id is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Actor is required to confirm session holds.'
    );
  end if;

  select *
    into v_hold
    from session_holds
   where hold_key = p_hold_key
   for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error_code', 'HOLD_NOT_FOUND',
      'error_message', 'Hold has expired or does not exist.'
    );
  end if;

  v_original_sub := current_setting('request.jwt.claim.sub', true);
  v_original_role := current_setting('request.jwt.claim.role', true);

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_actor_is_authorized := (
    app.user_has_role_for_org('therapist', null, v_hold.therapist_id, null, v_hold.session_id)
    or app.user_has_role_for_org('admin', null, v_hold.therapist_id, null, v_hold.session_id)
    or app.user_has_role_for_org('super_admin', null, v_hold.therapist_id, null, v_hold.session_id)
  );

  perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_original_role, ''), true);

  if not v_actor_is_authorized then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Actor is not permitted to confirm this hold.'
    );
  end if;

  v_session_id := nullif(p_session->>'id', '')::uuid;
  v_therapist_id := nullif(p_session->>'therapist_id', '')::uuid;
  v_client_id := nullif(p_session->>'client_id', '')::uuid;
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

  v_duration := greatest(
    v_cpt_increment,
    (round(v_raw_duration / v_cpt_increment)::int) * v_cpt_increment
  );

  if v_therapist_id is null or v_client_id is null or v_start is null or v_end is null then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_FIELDS',
      'error_message', 'Missing required session fields.'
    );
  end if;

  if v_hold.therapist_id <> v_therapist_id or v_hold.start_time <> v_start or v_hold.end_time <> v_end then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'HOLD_MISMATCH',
      'error_message', 'Session details do not match the held slot.'
    );
  end if;

  if v_hold.client_id <> v_client_id then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_MISMATCH',
      'error_message', 'Client differs from the hold.'
    );
  end if;

  if v_hold.expires_at <= timezone('utc', now()) then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'HOLD_EXPIRED',
      'error_message', 'Hold has expired.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.therapist_id = v_therapist_id
      and (v_session_id is null or s.id <> v_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_CONFLICT',
      'error_message', 'Therapist already has a session during this time.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.client_id = v_client_id
      and (v_session_id is null or s.id <> v_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_CONFLICT',
      'error_message', 'Client already has a session during this time.'
    );
  end if;

  if v_session_id is null then
    insert into sessions (
      therapist_id,
      client_id,
      start_time,
      end_time,
      status,
      notes,
      location_type,
      session_type,
      rate_per_hour,
      total_cost,
      duration_minutes,
      created_by,
      updated_by
    )
    values (
      v_therapist_id,
      v_client_id,
      v_start,
      v_end,
      v_status,
      v_notes,
      v_location,
      v_session_type,
      v_rate,
      v_total,
      v_duration,
      p_actor_id,
      p_actor_id
    )
    returning * into v_session;
  else
    update sessions
       set therapist_id = v_therapist_id,
           client_id = v_client_id,
           start_time = v_start,
           end_time = v_end,
           status = v_status,
           notes = v_notes,
           location_type = v_location,
           session_type = v_session_type,
           rate_per_hour = v_rate,
           total_cost = v_total,
           duration_minutes = v_duration,
           updated_by = coalesce(p_actor_id, updated_by)
     where id = v_session_id
     returning * into v_session;
  end if;

  delete from session_holds where id = v_hold.id;

  return jsonb_build_object(
    'success', true,
    'session', row_to_json(v_session)
  );
end;
$$;
