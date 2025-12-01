/*
  # Function fixes for lint failures

  Updates several plpgsql routines to:
    - Rely on the public schema search_path.
    - Avoid referencing nonexistent columns.
    - Clean up SQL that previously failed lint checks.
*/

-- Dropdown data helper: avoid referencing columns that may not exist at parse time
CREATE OR REPLACE FUNCTION public.get_dropdown_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_therapists jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_locations jsonb := '[]'::jsonb;
  v_has_org_col boolean;
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('therapists', v_therapists, 'clients', v_clients, 'locations', v_locations);
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', t.id, 'full_name', t.full_name))
  INTO v_therapists
  FROM (
    SELECT DISTINCT id, full_name
    FROM therapists
    WHERE status = 'active' AND organization_id = v_org
    ORDER BY full_name
  ) t;

  SELECT jsonb_agg(jsonb_build_object('id', c.id, 'full_name', c.full_name))
  INTO v_clients
  FROM (
    SELECT DISTINCT id, full_name
    FROM clients
    WHERE organization_id = v_org
    ORDER BY full_name
  ) c;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations'
      AND column_name = 'organization_id'
  ) INTO v_has_org_col;

  IF v_has_org_col THEN
    EXECUTE format($sql$
      SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name))
      FROM (
        SELECT DISTINCT id, name
        FROM locations
        WHERE is_active = true AND organization_id = $1
        ORDER BY name
      ) l
    $sql$)
    INTO v_locations
    USING v_org;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name))
    INTO v_locations
    FROM (
      SELECT DISTINCT id, name
      FROM locations
      WHERE is_active = true
      ORDER BY name
    ) l;
  END IF;

  RETURN jsonb_build_object(
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb),
    'locations', COALESCE(v_locations, '[]'::jsonb)
  );
END;
$function$;

-- Cache helper: qualify columns to avoid ambiguity
CREATE OR REPLACE FUNCTION public.get_cached_ai_response(p_cache_key text)
RETURNS TABLE(response_text text, metadata jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.ai_response_cache AS arc
  SET
    hit_count = arc.hit_count + 1,
    last_hit_at = now()
  WHERE
    arc.cache_key = p_cache_key
    AND arc.expires_at > now()
  RETURNING arc.response_text, arc.metadata;
END;
$function$;

-- Session creation helper: normalize modifiers array comparison
CREATE OR REPLACE FUNCTION public.insert_session_with_billing(
  p_session jsonb,
  p_cpt_code text,
  p_modifiers text[] DEFAULT '{}'::text[],
  p_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
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
  if v_therapist is null or v_client is null or v_start is null or v_end is null then
    return jsonb_build_object('success', false, 'error', 'missing_required_fields');
  end if;
  if v_start >= v_end then
    return jsonb_build_object('success', false, 'error', 'invalid_time_range');
  end if;
  if not (app.user_has_role_for_org('therapist', null, v_therapist, null, v_session_id)
          or app.user_has_role_for_org('admin') or app.user_has_role_for_org('super_admin')) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  v_duration := greatest(15, (round(v_duration_raw / 15)::int) * 15);
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
  select id into v_cpt_id from cpt_codes where code = upper(p_cpt_code) and is_active limit 1;
  if v_cpt_id is null then
    return jsonb_build_object('success', false, 'error', 'unknown_cpt_code');
  end if;
  delete from session_cpt_entries where session_id = v_session_id;
  insert into session_cpt_entries (
    session_id, cpt_code_id, line_number, units, billed_minutes, is_primary, notes
  ) values (
    v_session_id, v_cpt_id, 1, ceil(v_duration::numeric/15), v_duration, true, v_session_type
  );
  delete from session_cpt_modifiers where session_cpt_entry_id in (
    select id from session_cpt_entries where session_id = v_session_id
  );

  with normalized_modifiers as (
    select distinct upper(trim(modifier)) as code
    from unnest(coalesce(p_modifiers, '{}'::text[])) as modifier
    where length(trim(modifier)) > 0
  )
  insert into session_cpt_modifiers (session_cpt_entry_id, modifier_id, position)
  select
    e.id,
    m.id,
    row_number() over (order by nm.code)
  from session_cpt_entries e
  join normalized_modifiers nm on true
  join billing_modifiers m on m.code = nm.code
  where e.session_id = v_session_id;

  return jsonb_build_object('success', true, 'session', row_to_json(v_session));
end;
$function$;

-- Transcript pruning: avoid invalid alias references
CREATE OR REPLACE FUNCTION public.prune_session_transcripts(retention_days integer DEFAULT 30)
RETURNS TABLE(deleted_transcripts integer, deleted_segments integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_retention_days integer := GREATEST(COALESCE(retention_days, 30), 0);
  v_cutoff timestamptz := NOW() - (v_retention_days || ' days')::interval;
  v_deleted_segments integer := 0;
  v_deleted_transcripts integer := 0;
BEGIN
  DELETE FROM public.session_transcript_segments AS sts
  USING public.sessions AS s
  WHERE s.id = sts.session_id
    AND (
      NOT COALESCE(s.has_transcription_consent, false)
      OR COALESCE(sts.created_at, 'epoch'::timestamptz) < v_cutoff
    );

  GET DIAGNOSTICS v_deleted_segments = ROW_COUNT;

  DELETE FROM public.session_transcripts AS st
  USING public.sessions AS s
  WHERE s.id = st.session_id
    AND (
      NOT COALESCE(s.has_transcription_consent, false)
      OR COALESCE(st.created_at, 'epoch'::timestamptz) < v_cutoff
    );

  GET DIAGNOSTICS v_deleted_transcripts = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_transcripts, v_deleted_segments;
END;
$function$;

-- Compliance helpers: ensure search_path and array typing
CREATE OR REPLACE FUNCTION public.validate_session_note_compliance(p_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    note_data RECORD;
    issues text[] := ARRAY[]::text[];
    result JSONB;
    issue_count integer;
BEGIN
    SELECT * INTO note_data FROM ai_session_notes WHERE id = p_note_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'compliant', false,
            'insurance_ready', false,
            'issues', jsonb_build_array('Session note not found')
        );
    END IF;

    IF note_data.current_clinical_status IS NULL OR length(note_data.current_clinical_status) < 50 THEN
        issues := array_append(issues, 'Clinical status description too brief');
    END IF;

    IF jsonb_array_length(note_data.targeted_goals) = 0 THEN
        issues := array_append(issues, 'No targeted goals documented');
    END IF;

    IF jsonb_array_length(note_data.interventions_used) = 0 THEN
        issues := array_append(issues, 'No interventions documented');
    END IF;

    IF jsonb_array_length(note_data.behavioral_observations) = 0 THEN
        issues := array_append(issues, 'No behavioral observations documented');
    END IF;

    IF jsonb_array_length(note_data.data_collection_summary) = 0 THEN
        issues := array_append(issues, 'No quantified data documented');
    END IF;

    IF note_data.signature IS NULL OR note_data.signed_at IS NULL THEN
        issues := array_append(issues, 'Session note not signed');
    END IF;

    issue_count := COALESCE(array_length(issues, 1), 0);

    result := jsonb_build_object(
        'compliant', issue_count = 0,
        'insurance_ready', issue_count = 0,
        'issues', COALESCE(to_jsonb(issues), '[]'::jsonb)
    );

    UPDATE ai_session_notes
    SET
        california_compliant = (issue_count = 0),
        insurance_ready = (issue_count = 0),
        updated_at = NOW()
    WHERE id = p_note_id;

    RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_session_notes_with_compliance(
  p_client_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  note_id uuid,
  session_date date,
  therapist_name text,
  ai_confidence_score numeric,
  california_compliant boolean,
  insurance_ready boolean,
  signed_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        asn.id,
        asn.session_date,
        COALESCE(up.full_name, 'Unknown Therapist') as therapist_name,
        asn.ai_confidence_score,
        asn.california_compliant,
        asn.insurance_ready,
        asn.signed_at,
        asn.created_at
    FROM ai_session_notes asn
    LEFT JOIN user_profiles up ON asn.therapist_id = up.id
    WHERE asn.client_id = p_client_id
    ORDER BY asn.session_date DESC
    LIMIT p_limit;
END;
$function$;

