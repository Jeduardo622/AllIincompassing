BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS assessment_units numeric DEFAULT 0;

UPDATE public.clients
SET assessment_units = 0
WHERE assessment_units IS NULL;

COMMENT ON COLUMN public.clients.assessment_units IS 'Authorized assessment service units';

CREATE OR REPLACE FUNCTION app.create_client(p_client_data jsonb)
RETURNS public.clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_full_name text;
  v_payload jsonb := COALESCE(p_client_data, '{}'::jsonb);
  v_result public.clients;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  v_org := app.current_user_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Organization context is required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    app.user_has_role_for_org('admin', v_org)
    OR app.user_has_role_for_org('super_admin', v_org)
    OR app.user_has_role_for_org('therapist', v_org, v_actor)
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create client' USING ERRCODE = 'P0001';
  END IF;

  v_full_name := NULLIF(v_payload->>'full_name', '');
  IF v_full_name IS NULL THEN
    v_full_name := trim(
      BOTH ' '
      FROM concat_ws(' ',
        NULLIF(v_payload->>'first_name', ''),
        NULLIF(v_payload->>'middle_name', ''),
        NULLIF(v_payload->>'last_name', '')
      )
    );
  END IF;

  IF v_full_name IS NULL OR v_full_name = '' THEN
    v_full_name := 'Client';
  END IF;

  v_payload := v_payload
    || jsonb_build_object('organization_id', v_org)
    || jsonb_build_object('full_name', v_full_name);

  INSERT INTO public.clients (
    email,
    first_name,
    middle_name,
    last_name,
    date_of_birth,
    gender,
    client_id,
    phone,
    cin_number,
    parent1_first_name,
    parent1_last_name,
    parent1_phone,
    parent1_email,
    parent1_relationship,
    parent2_first_name,
    parent2_last_name,
    parent2_phone,
    parent2_email,
    parent2_relationship,
    address_line1,
    address_line2,
    city,
    state,
    zip_code,
    service_preference,
    insurance_info,
    referral_source,
    one_to_one_units,
    supervision_units,
    parent_consult_units,
    assessment_units,
    availability_hours,
    documents,
    notes,
    status,
    organization_id,
    full_name
  )
  SELECT
    NULLIF(input.email, ''),
    NULLIF(input.first_name, ''),
    NULLIF(input.middle_name, ''),
    NULLIF(input.last_name, ''),
    CASE
      WHEN input.date_of_birth IS NULL OR input.date_of_birth = '' THEN NULL
      ELSE input.date_of_birth::date
    END,
    NULLIF(input.gender, ''),
    NULLIF(input.client_id, ''),
    NULLIF(input.phone, ''),
    NULLIF(input.cin_number, ''),
    NULLIF(input.parent1_first_name, ''),
    NULLIF(input.parent1_last_name, ''),
    NULLIF(input.parent1_phone, ''),
    NULLIF(input.parent1_email, ''),
    NULLIF(input.parent1_relationship, ''),
    NULLIF(input.parent2_first_name, ''),
    NULLIF(input.parent2_last_name, ''),
    NULLIF(input.parent2_phone, ''),
    NULLIF(input.parent2_email, ''),
    NULLIF(input.parent2_relationship, ''),
    NULLIF(input.address_line1, ''),
    NULLIF(input.address_line2, ''),
    NULLIF(input.city, ''),
    NULLIF(input.state, ''),
    NULLIF(input.zip_code, ''),
    COALESCE(input.service_preference, ARRAY[]::text[]),
    input.insurance_info,
    NULLIF(input.referral_source, ''),
    input.one_to_one_units,
    input.supervision_units,
    input.parent_consult_units,
    input.assessment_units,
    input.availability_hours,
    input.documents,
    NULLIF(input.notes, ''),
    COALESCE(NULLIF(input.status, ''), 'active'),
    v_org,
    COALESCE(NULLIF(input.full_name, ''), v_full_name)
  FROM jsonb_to_record(v_payload) AS input (
    email text,
    first_name text,
    middle_name text,
    last_name text,
    date_of_birth text,
    gender text,
    client_id text,
    phone text,
    cin_number text,
    parent1_first_name text,
    parent1_last_name text,
    parent1_phone text,
    parent1_email text,
    parent1_relationship text,
    parent2_first_name text,
    parent2_last_name text,
    parent2_phone text,
    parent2_email text,
    parent2_relationship text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    zip_code text,
    service_preference text[],
    insurance_info jsonb,
    referral_source text,
    one_to_one_units numeric,
    supervision_units numeric,
    parent_consult_units numeric,
    assessment_units numeric,
    availability_hours jsonb,
    documents jsonb,
    notes text,
    status text,
    organization_id uuid,
    full_name text
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION app.create_client(jsonb) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_consumer'
  ) THEN
    CREATE ROLE dashboard_consumer;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION get_dashboard_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_org uuid;
  result jsonb;
  today_sessions jsonb;
  incomplete_sessions jsonb;
  billing_alerts jsonb;
  client_metrics jsonb;
  therapist_metrics jsonb;
BEGIN
  SET LOCAL row_security = on;

  v_org := app.current_user_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context required';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'client_id', s.client_id,
      'therapist_id', s.therapist_id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  ) INTO today_sessions
  FROM sessions s
  JOIN therapists t ON t.id = s.therapist_id
  JOIN clients c ON c.id = s.client_id
  WHERE s.organization_id = v_org
    AND t.organization_id = v_org
    AND c.organization_id = v_org
    AND DATE(s.start_time AT TIME ZONE 'UTC') = CURRENT_DATE;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'client_id', s.client_id,
      'therapist_id', s.therapist_id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  ) INTO incomplete_sessions
  FROM sessions s
  JOIN therapists t ON t.id = s.therapist_id
  JOIN clients c ON c.id = s.client_id
  WHERE s.organization_id = v_org
    AND t.organization_id = v_org
    AND c.organization_id = v_org
    AND s.status = 'completed'
    AND (s.notes IS NULL OR s.notes = '');

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', br.id,
      'session_id', br.session_id,
      'amount', br.amount,
      'status', br.status,
      'created_at', br.created_at
    )
  ) INTO billing_alerts
  FROM billing_records br
  WHERE br.organization_id = v_org
    AND br.status IN ('pending', 'rejected');

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE c.created_at > CURRENT_DATE - INTERVAL '30 days'),
    'totalUnits', COALESCE(SUM(
      COALESCE(c.one_to_one_units, 0) +
      COALESCE(c.supervision_units, 0) +
      COALESCE(c.parent_consult_units, 0) +
      COALESCE(c.assessment_units, 0)
    ), 0)
  ) INTO client_metrics
  FROM clients c
  WHERE c.organization_id = v_org;

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE t.status = 'active'),
    'totalHours', COALESCE(SUM(COALESCE(t.weekly_hours_max, 0)), 0)
  ) INTO therapist_metrics
  FROM therapists t
  WHERE t.organization_id = v_org;

  result := jsonb_build_object(
    'todaySessions', COALESCE(today_sessions, '[]'::jsonb),
    'incompleteSessions', COALESCE(incomplete_sessions, '[]'::jsonb),
    'billingAlerts', COALESCE(billing_alerts, '[]'::jsonb),
    'clientMetrics', COALESCE(client_metrics, '{}'::jsonb),
    'therapistMetrics', COALESCE(therapist_metrics, '{}'::jsonb)
  );

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_dashboard_data() FROM authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_data() TO dashboard_consumer;
GRANT EXECUTE ON FUNCTION get_dashboard_data() TO service_role;

COMMIT;

