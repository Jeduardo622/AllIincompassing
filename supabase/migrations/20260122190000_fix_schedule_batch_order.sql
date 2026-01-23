BEGIN;

CREATE OR REPLACE FUNCTION public.get_schedule_data_batch(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_sessions jsonb := '[]'::jsonb;
  v_therapists jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context is required';
  END IF;

  SELECT jsonb_agg(
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
    ORDER BY s.start_time
  )
  INTO v_sessions
  FROM public.sessions s
  JOIN public.therapists t
    ON s.therapist_id = t.id
   AND t.organization_id = v_org
  JOIN public.clients c
    ON s.client_id = c.id
   AND c.organization_id = v_org
  WHERE s.organization_id = v_org
    AND s.start_time >= p_start_date
    AND s.start_time <= p_end_date;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'email', t.email,
      'service_type', t.service_type,
      'specialties', t.specialties,
      'availability_hours', t.availability_hours
    )
    ORDER BY t.full_name
  )
  INTO v_therapists
  FROM public.therapists t
  WHERE t.status = 'active'
    AND t.organization_id = v_org;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'email', c.email,
      'service_preference', c.service_preference,
      'availability_hours', c.availability_hours
    )
    ORDER BY c.full_name
  )
  INTO v_clients
  FROM public.clients c
  WHERE c.organization_id = v_org;

  RETURN jsonb_build_object(
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb)
  );
END;
$$;

COMMIT;
