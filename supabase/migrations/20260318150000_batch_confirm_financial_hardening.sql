-- @migration-intent: Add atomic batch confirmation RPC, preserve hold on non-persisted update, and enforce booking financial guardrails.
-- @migration-dependencies: 20260317043000_confirm_session_hold_program_goal_required.sql,20260311102000_confirm_session_hold_with_enrichment.sql
-- @migration-rollback: Re-run prior confirm_session_hold migrations and drop confirm_session_holds_batch_with_enrichment if regression requires rollback.

set search_path = public;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_rate_per_hour_non_negative'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_rate_per_hour_non_negative
      check (rate_per_hour is null or rate_per_hour >= 0) not valid;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_total_cost_non_negative'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_total_cost_non_negative
      check (total_cost is null or total_cost >= 0) not valid;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_total_cost_consistency'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_total_cost_consistency
      check (
        total_cost is null
        or rate_per_hour is null
        or duration_minutes is null
        or duration_minutes <= 0
        or abs(total_cost - round(((rate_per_hour * duration_minutes)::numeric / 60), 2)) <= 0.05
      ) not valid;
  end if;
end
$$;

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
  v_expected_total numeric;
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

  if v_rate is not null and v_rate < 0 then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_FINANCIAL_VALUE', 'error_message', 'rate_per_hour cannot be negative.');
  end if;

  if v_total is not null and v_total < 0 then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_FINANCIAL_VALUE', 'error_message', 'total_cost cannot be negative.');
  end if;

  if v_total is not null and v_rate is not null and v_duration > 0 then
    v_expected_total := round(((v_rate * v_duration)::numeric / 60), 2);
    if abs(v_total - v_expected_total) > 0.05 then
      return jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_FINANCIAL_TOTAL',
        'error_message', 'total_cost must align with rate_per_hour and duration_minutes.',
        'expected_total_cost', v_expected_total
      );
    end if;
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

    if not found then
      return jsonb_build_object(
        'success', false,
        'error_code', 'SESSION_NOT_FOUND',
        'error_message', 'Session not found in organization scope.'
      );
    end if;
  end if;

  delete from public.session_holds where id = v_hold.id;

  return jsonb_build_object('success', true, 'session', row_to_json(v_session));
end;
$$;

create or replace function public.confirm_session_holds_batch_with_enrichment(
  p_occurrences jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occurrence jsonb;
  v_confirm_result jsonb;
  v_hold_key uuid;
  v_session jsonb;
  v_cpt jsonb;
  v_goal_ids uuid[];
  v_sessions jsonb := '[]'::jsonb;
  v_index integer := 0;
  v_failed_code text := null;
  v_failed_message text := null;
begin
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' or jsonb_array_length(p_occurrences) = 0 then
    return jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_FIELDS',
      'error_message', 'At least one occurrence is required.'
    );
  end if;

  begin
    for v_occurrence in
      select value
      from jsonb_array_elements(p_occurrences)
    loop
      v_index := v_index + 1;
      v_hold_key := nullif(v_occurrence->>'hold_key', '')::uuid;
      v_session := v_occurrence->'session';
      v_cpt := coalesce(v_occurrence->'cpt', null);

      if v_hold_key is null or v_session is null or jsonb_typeof(v_session) <> 'object' then
        v_failed_code := 'MISSING_FIELDS';
        v_failed_message := 'Each occurrence must include hold_key and session.';
        raise exception 'batch_confirm_validation_failed';
      end if;

      if v_occurrence ? 'goal_ids' and jsonb_typeof(v_occurrence->'goal_ids') = 'array' then
        select coalesce(array_agg(nullif(value#>>'{}', '')::uuid), array[]::uuid[])
          into v_goal_ids
        from jsonb_array_elements(v_occurrence->'goal_ids');
      else
        v_goal_ids := null;
      end if;

      v_confirm_result := public.confirm_session_hold_with_enrichment(
        v_hold_key,
        v_session,
        v_cpt,
        v_goal_ids,
        p_actor_id
      );

      if coalesce((v_confirm_result->>'success')::boolean, false) is not true then
        v_failed_code := coalesce(v_confirm_result->>'error_code', 'CONFIRM_FAILED');
        v_failed_message := coalesce(v_confirm_result->>'error_message', 'Unable to confirm occurrence');
        raise exception 'batch_confirm_occurrence_failed';
      end if;

      v_sessions := v_sessions || jsonb_build_array(v_confirm_result->'session');
    end loop;

  exception
    when others then
      return jsonb_build_object(
        'success', false,
        'error_code', coalesce(v_failed_code, 'BATCH_CONFIRM_FAILED'),
        'error_message', coalesce(v_failed_message, SQLERRM),
        'failed_index', nullif(v_index, 0)
      );
  end;

  return jsonb_build_object(
    'success', true,
    'sessions', v_sessions,
    'session', v_sessions->0
  );
end;
$$;

revoke execute on function public.confirm_session_holds_batch_with_enrichment(jsonb, uuid) from public;
revoke execute on function public.confirm_session_holds_batch_with_enrichment(jsonb, uuid) from anon;
revoke execute on function public.confirm_session_holds_batch_with_enrichment(jsonb, uuid) from authenticated;
grant execute on function public.confirm_session_holds_batch_with_enrichment(jsonb, uuid) to service_role;
