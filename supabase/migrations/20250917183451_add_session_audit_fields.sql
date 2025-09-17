set search_path = public;

alter table sessions
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_by uuid references auth.users(id);

update sessions
   set updated_at = coalesce(created_at, updated_at);

update sessions
   set updated_by = created_by
 where updated_by is null
   and created_by is not null;

create or replace function set_sessions_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user uuid;
begin
  v_auth_user := auth.uid();

  if tg_op = 'INSERT' then
    if new.updated_at is null then
      new.updated_at := timezone('utc', now());
    end if;

    if new.created_by is null and v_auth_user is not null then
      new.created_by := v_auth_user;
    end if;

    if new.updated_by is null then
      if v_auth_user is not null then
        new.updated_by := v_auth_user;
      elsif new.created_by is not null then
        new.updated_by := new.created_by;
      end if;
    end if;

    if new.created_by is null and new.updated_by is not null then
      new.created_by := new.updated_by;
    end if;
  elsif tg_op = 'UPDATE' then
    new.updated_at := timezone('utc', now());

    if new.created_by is null then
      new.created_by := old.created_by;
    end if;

    if new.updated_by is null then
      if v_auth_user is not null then
        new.updated_by := v_auth_user;
      elsif old.updated_by is not null then
        new.updated_by := old.updated_by;
      elsif old.created_by is not null then
        new.updated_by := old.created_by;
      elsif new.created_by is not null then
        new.updated_by := new.created_by;
      end if;
    end if;

    if new.created_by is null and new.updated_by is not null then
      new.created_by := new.updated_by;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sessions_set_audit_fields on sessions;

create trigger sessions_set_audit_fields
before insert or update on sessions
for each row
execute function set_sessions_audit_fields();

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

create or replace function get_sessions_optimized(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_therapist_id uuid default null,
  p_client_id uuid default null
) returns table (
  session_data jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
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
  from sessions s
  join therapists t on s.therapist_id = t.id
  join clients c on s.client_id = c.id
  where s.start_time >= p_start_date
    and s.start_time <= p_end_date
    and (p_therapist_id is null or s.therapist_id = p_therapist_id)
    and (p_client_id is null or s.client_id = p_client_id)
  order by s.start_time;
end;
$$;

create or replace function get_schedule_data_batch(
  p_start_date timestamptz,
  p_end_date timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions jsonb;
  v_therapists jsonb;
  v_clients jsonb;
begin
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
  from sessions s
  join therapists t on s.therapist_id = t.id
  join clients c on s.client_id = c.id
  where s.start_time >= p_start_date
    and s.start_time <= p_end_date;

  select jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'email', t.email,
      'service_type', t.service_type,
      'specialties', t.specialties,
      'availability_hours', t.availability_hours
    )
  )
  into v_therapists
  from therapists t
  where t.status = 'active';

  select jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'email', c.email,
      'service_preference', c.service_preference,
      'availability_hours', c.availability_hours
    )
  )
  into v_clients
  from clients c;

  return jsonb_build_object(
    'sessions', coalesce(v_sessions, '[]'::jsonb),
    'therapists', coalesce(v_therapists, '[]'::jsonb),
    'clients', coalesce(v_clients, '[]'::jsonb)
  );
end;
$$;
