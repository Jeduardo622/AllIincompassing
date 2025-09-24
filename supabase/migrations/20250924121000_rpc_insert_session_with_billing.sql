-- Create RPC: insert_session_with_billing
-- Inserts/updates a session and persists CPT + modifiers atomically
-- SECURITY DEFINER with strict org/role checks

create or replace function public.insert_session_with_billing(
  p_session jsonb,
  p_cpt_code text,
  p_modifiers text[] default '{}',
  p_session_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_session sessions;
  v_session_id uuid := p_session_id;
  v_therapist uuid := nullif(p_session->>'therapist_id','')::uuid;
  v_client uuid := nullif(p_session->>'client_id','')::uuid;
  v_start timestamptz := nullif(p_session->>'start_time','')::timestamptz;
  v_end timestamptz := nullif(p_session->>'end_time','')::timestamptz;
  v_status text := coalesce(nullif(p_session->>'status',''),'scheduled');
  v_notes text := nullif(p_session->>'notes','');
  v_location text := nullif(p_session->>'location_type','');
  v_session_type text := nullif(p_session->>'session_type','');
  v_rate numeric := nullif(p_session->>'rate_per_hour','')::numeric;
  v_total numeric := nullif(p_session->>'total_cost','')::numeric;
  v_duration_raw numeric := coalesce(nullif(p_session->>'duration_minutes','')::numeric,
                            (extract(epoch from (v_end - v_start)) / 60)::numeric);
  v_duration integer;
  v_cpt_id uuid;
begin
  -- basic validation
  if v_therapist is null or v_client is null or v_start is null or v_end is null then
    return jsonb_build_object('success', false, 'error', 'missing_required_fields');
  end if;
  if v_start >= v_end then
    return jsonb_build_object('success', false, 'error', 'invalid_time_range');
  end if;

  -- org/role check: therapist must be caller or caller is admin
  if not (app.user_has_role_for_org('therapist', null, v_therapist, null, v_session_id)
          or app.user_has_role_for_org('admin') or app.user_has_role_for_org('super_admin')) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  -- round duration to 15-minute increments (CPT compliant)
  v_duration := greatest(15, (round(v_duration_raw / 15)::int) * 15);

  -- upsert session
  if v_session_id is null then
    insert into sessions (
      therapist_id, client_id, start_time, end_time, status, notes,
      location_type, session_type, rate_per_hour, total_cost, duration_minutes
    ) values (
      v_therapist, v_client, v_start, v_end, v_status, v_notes,
      v_location, v_session_type, v_rate, v_total, v_duration
    ) returning * into v_session;
    v_session_id := v_session.id;
  else
    update sessions set
      therapist_id = v_therapist,
      client_id = v_client,
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

  -- resolve cpt code
  select id into v_cpt_id from cpt_codes where code = upper(p_cpt_code) and is_active limit 1;
  if v_cpt_id is null then
    return jsonb_build_object('success', false, 'error', 'unknown_cpt_code');
  end if;

  -- replace session_cpt_entries
  delete from session_cpt_entries where session_id = v_session_id;
  insert into session_cpt_entries (
    session_id, cpt_code_id, line_number, units, billed_minutes, is_primary, notes
  ) values (
    v_session_id, v_cpt_id, 1, ceil(v_duration::numeric/15), v_duration, true, v_session_type
  );

  -- replace session_cpt_modifiers
  delete from session_cpt_modifiers where session_cpt_entry_id in (
    select id from session_cpt_entries where session_id = v_session_id
  );
  insert into session_cpt_modifiers (session_cpt_entry_id, modifier_id, position)
  select e.id, m.id, row_number() over ()
  from session_cpt_entries e
  join billing_modifiers m on m.code = any (
    select array_agg(upper(x)) from unnest(coalesce(p_modifiers,'{}'::text[])) x
  )
  where e.session_id = v_session_id;

  return jsonb_build_object('success', true, 'session', row_to_json(v_session));
end;
$$;

-- RLS exposure: allow only authenticated
revoke all on function public.insert_session_with_billing(jsonb, text, text[], uuid) from public;
grant execute on function public.insert_session_with_billing(jsonb, text, text[], uuid) to authenticated;


