-- Session hold infrastructure for transactional scheduling
set search_path = public;

create extension if not exists btree_gist;

create table if not exists session_holds (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references therapists(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  hold_key uuid not null unique,
  session_id uuid null references sessions(id) on delete set null,
  expires_at timestamptz not null default timezone('utc', now()) + interval '5 minutes',
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists session_holds_therapist_start_time_idx
  on session_holds (therapist_id, start_time);

create index if not exists session_holds_expires_at_idx
  on session_holds (expires_at);

alter table session_holds
  drop constraint if exists session_holds_therapist_time_excl;

alter table session_holds
  add constraint session_holds_therapist_time_excl
    exclude using gist (
      therapist_id with =,
      tstzrange(start_time, end_time, '[)') with &&
    );

alter table session_holds
  drop constraint if exists session_holds_client_time_excl;

alter table session_holds
  add constraint session_holds_client_time_excl
    exclude using gist (
      client_id with =,
      tstzrange(start_time, end_time, '[)') with &&
    );

alter table session_holds enable row level security;

drop policy if exists "session_holds_disallow_select" on session_holds;
create policy "session_holds_disallow_select"
  on session_holds
  for select
  using (false);

drop policy if exists "session_holds_disallow_insert" on session_holds;
create policy "session_holds_disallow_insert"
  on session_holds
  for insert
  with check (false);

drop policy if exists "session_holds_disallow_update" on session_holds;
create policy "session_holds_disallow_update"
  on session_holds
  for update
  using (false)
  with check (false);

drop policy if exists "session_holds_disallow_delete" on session_holds;
create policy "session_holds_disallow_delete"
  on session_holds
  for delete
  using (false);

create or replace function acquire_session_hold(
  p_therapist_id uuid,
  p_client_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_session_id uuid default null,
  p_hold_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold session_holds;
  v_constraint_name text;
begin
  delete from session_holds where expires_at <= timezone('utc', now());

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
  p_session jsonb
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
begin
  delete from session_holds where expires_at <= timezone('utc', now());

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

  -- CPT codes require reporting in quarter-hour increments; round the raw duration
  -- instead of truncating so billing receives the compliant value.
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
      duration_minutes
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
      v_duration
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
           duration_minutes = v_duration
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
