/*
  # Add authorization decision metadata

  1. Changes
    - Add approved_by, approval_notes, denied_at, denial_reason
    - Populate decision fields in create/update authorization RPCs
*/

ALTER TABLE public.authorizations
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approval_notes text,
  ADD COLUMN IF NOT EXISTS denied_at timestamptz,
  ADD COLUMN IF NOT EXISTS denial_reason text;

CREATE OR REPLACE FUNCTION public.create_authorization_with_services(
  p_client_id uuid,
  p_provider_id uuid,
  p_authorization_number text,
  p_diagnosis_code text,
  p_diagnosis_description text,
  p_start_date date,
  p_end_date date,
  p_status text default 'pending',
  p_insurance_provider_id uuid default null,
  p_plan_type text default null,
  p_member_id text default null,
  p_services jsonb default '[]'::jsonb
)
RETURNS public.authorizations
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_org_id uuid;
  v_actor_id uuid;
  v_is_super boolean;
  v_is_admin boolean;
  v_auth public.authorizations;
  v_services_count int;
  svc jsonb;
  v_service_code text;
  v_service_description text;
  v_from_date date;
  v_to_date date;
  v_requested_units int;
  v_approved_units int;
  v_unit_type text;
  v_decision_status text;
  v_status text;
BEGIN
  v_actor_id := app.current_user_id();
  v_is_super := app.current_user_is_super_admin();

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT c.organization_id
    INTO v_org_id
  FROM public.clients c
  WHERE c.id = p_client_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  v_is_admin := app.user_has_role_for_org(v_actor_id, v_org_id, array['org_admin']);

  IF NOT v_is_super AND NOT v_is_admin AND NOT app.user_has_role_for_org(v_actor_id, v_org_id, array['therapist']) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF NOT v_is_super AND NOT v_is_admin AND p_provider_id <> v_actor_id THEN
    RAISE EXCEPTION 'Therapists may only create authorizations for themselves';
  END IF;

  IF p_authorization_number IS NULL OR length(trim(p_authorization_number)) = 0 THEN
    RAISE EXCEPTION 'authorization_number is required';
  END IF;

  IF p_diagnosis_code IS NULL OR length(trim(p_diagnosis_code)) = 0 THEN
    RAISE EXCEPTION 'diagnosis_code is required';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  IF jsonb_typeof(p_services) <> 'array' THEN
    RAISE EXCEPTION 'services must be a JSON array';
  END IF;

  SELECT jsonb_array_length(p_services)
    INTO v_services_count;

  IF v_services_count < 1 THEN
    RAISE EXCEPTION 'At least one service is required';
  END IF;

  v_status := coalesce(nullif(trim(p_status), ''), 'pending');

  INSERT INTO public.authorizations(
    authorization_number,
    client_id,
    provider_id,
    insurance_provider_id,
    diagnosis_code,
    diagnosis_description,
    start_date,
    end_date,
    status,
    organization_id,
    created_by,
    plan_type,
    member_id,
    approved_at,
    approved_by,
    denied_at
  ) VALUES (
    p_authorization_number,
    p_client_id,
    p_provider_id,
    p_insurance_provider_id,
    p_diagnosis_code,
    p_diagnosis_description,
    p_start_date,
    p_end_date,
    v_status,
    v_org_id,
    v_actor_id,
    p_plan_type,
    p_member_id,
    CASE WHEN lower(v_status) = 'approved' THEN now() ELSE NULL END,
    CASE WHEN lower(v_status) = 'approved' THEN v_actor_id ELSE NULL END,
    CASE WHEN lower(v_status) = 'denied' THEN now() ELSE NULL END
  )
  RETURNING * INTO v_auth;

  FOR svc IN SELECT value FROM jsonb_array_elements(p_services) AS value LOOP
    v_service_code := nullif(trim(svc->>'service_code'), '');
    v_service_description := coalesce(nullif(trim(svc->>'service_description'), ''), '');
    v_from_date := (svc->>'from_date')::date;
    v_to_date := (svc->>'to_date')::date;
    v_requested_units := (svc->>'requested_units')::int;
    v_approved_units := nullif((svc->>'approved_units')::int, 0);
    v_unit_type := coalesce(nullif(trim(svc->>'unit_type'), ''), 'Units');
    v_decision_status := coalesce(nullif(trim(svc->>'decision_status'), ''), 'pending');

    IF v_service_code IS NULL THEN
      RAISE EXCEPTION 'service_code is required';
    END IF;
    IF v_from_date IS NULL OR v_to_date IS NULL OR v_to_date < v_from_date THEN
      RAISE EXCEPTION 'Invalid service date range';
    END IF;
    IF v_requested_units IS NULL OR v_requested_units < 1 THEN
      RAISE EXCEPTION 'requested_units must be >= 1';
    END IF;

    INSERT INTO public.authorization_services(
      authorization_id,
      service_code,
      service_description,
      from_date,
      to_date,
      requested_units,
      approved_units,
      unit_type,
      decision_status,
      organization_id,
      created_by
    ) VALUES (
      v_auth.id,
      v_service_code,
      v_service_description,
      v_from_date,
      v_to_date,
      v_requested_units,
      v_approved_units,
      v_unit_type,
      v_decision_status,
      v_org_id,
      v_actor_id
    );
  END LOOP;

  RETURN v_auth;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_authorization_with_services(
  p_authorization_id uuid,
  p_authorization_number text,
  p_client_id uuid,
  p_provider_id uuid,
  p_diagnosis_code text,
  p_diagnosis_description text,
  p_start_date date,
  p_end_date date,
  p_status text,
  p_insurance_provider_id uuid,
  p_plan_type text,
  p_member_id text,
  p_services jsonb default '[]'::jsonb
)
RETURNS public.authorizations
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_actor_id uuid;
  v_is_super boolean;
  v_is_admin boolean;
  v_is_therapist boolean;
  v_existing public.authorizations;
  v_org_id uuid;
  v_auth public.authorizations;
  v_services_count int;
  svc jsonb;
  v_service_code text;
  v_service_description text;
  v_from_date date;
  v_to_date date;
  v_requested_units int;
  v_unit_type text;
  v_decision_status text;
  v_status text;
  v_new_approved_at timestamptz;
  v_new_approved_by uuid;
  v_new_denied_at timestamptz;
BEGIN
  v_actor_id := app.current_user_id();
  v_is_super := app.current_user_is_super_admin();

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_existing
  FROM public.authorizations
  WHERE id = p_authorization_id;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Authorization not found';
  END IF;

  v_org_id := v_existing.organization_id;

  v_is_admin := app.user_has_role_for_org(v_actor_id, v_org_id, array['org_admin']);
  v_is_therapist := app.user_has_role_for_org(v_actor_id, v_org_id, array['therapist']);

  IF NOT v_is_super AND NOT v_is_admin AND NOT v_is_therapist THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- Non-admin therapists can only update their own authorizations.
  IF NOT v_is_super AND NOT v_is_admin AND v_existing.provider_id <> v_actor_id THEN
    RAISE EXCEPTION 'Therapists may only update their own authorizations';
  END IF;

  -- Prevent reassignment by therapists.
  IF NOT v_is_super AND NOT v_is_admin THEN
    IF p_client_id <> v_existing.client_id THEN
      RAISE EXCEPTION 'Therapists may not reassign client_id';
    END IF;
    IF p_provider_id <> v_existing.provider_id THEN
      RAISE EXCEPTION 'Therapists may not reassign provider_id';
    END IF;
  END IF;

  IF p_authorization_number IS NULL OR length(trim(p_authorization_number)) = 0 THEN
    RAISE EXCEPTION 'authorization_number is required';
  END IF;

  IF p_diagnosis_code IS NULL OR length(trim(p_diagnosis_code)) = 0 THEN
    RAISE EXCEPTION 'diagnosis_code is required';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  IF jsonb_typeof(p_services) <> 'array' THEN
    RAISE EXCEPTION 'services must be a JSON array';
  END IF;

  SELECT jsonb_array_length(p_services)
    INTO v_services_count;

  IF v_services_count < 1 THEN
    RAISE EXCEPTION 'At least one service is required';
  END IF;

  v_status := coalesce(nullif(trim(p_status), ''), v_existing.status);

  v_new_approved_at := v_existing.approved_at;
  v_new_approved_by := v_existing.approved_by;
  v_new_denied_at := v_existing.denied_at;

  IF lower(v_status) = 'approved' AND v_existing.approved_at IS NULL THEN
    v_new_approved_at := now();
    v_new_approved_by := v_actor_id;
    v_new_denied_at := null;
  END IF;

  IF lower(v_status) = 'denied' AND v_existing.denied_at IS NULL THEN
    v_new_denied_at := now();
  END IF;

  UPDATE public.authorizations
  SET
    authorization_number = p_authorization_number,
    client_id = p_client_id,
    provider_id = p_provider_id,
    insurance_provider_id = p_insurance_provider_id,
    diagnosis_code = p_diagnosis_code,
    diagnosis_description = p_diagnosis_description,
    start_date = p_start_date,
    end_date = p_end_date,
    status = v_status,
    plan_type = p_plan_type,
    member_id = p_member_id,
    approved_at = v_new_approved_at,
    approved_by = v_new_approved_by,
    denied_at = v_new_denied_at,
    updated_at = now()
  WHERE id = p_authorization_id
  RETURNING * INTO v_auth;

  -- Replace services (strict mapping, no over-posting).
  DELETE FROM public.authorization_services
  WHERE authorization_id = p_authorization_id;

  FOR svc IN SELECT value FROM jsonb_array_elements(p_services) AS value LOOP
    v_service_code := nullif(trim(svc->>'service_code'), '');
    v_service_description := coalesce(nullif(trim(svc->>'service_description'), ''), '');
    v_from_date := (svc->>'from_date')::date;
    v_to_date := (svc->>'to_date')::date;
    v_requested_units := (svc->>'requested_units')::int;
    v_unit_type := coalesce(nullif(trim(svc->>'unit_type'), ''), 'Units');
    v_decision_status := coalesce(nullif(trim(svc->>'decision_status'), ''), 'pending');

    IF v_service_code IS NULL THEN
      RAISE EXCEPTION 'service_code is required';
    END IF;
    IF v_from_date IS NULL OR v_to_date IS NULL OR v_to_date < v_from_date THEN
      RAISE EXCEPTION 'Invalid service date range';
    END IF;
    IF v_requested_units IS NULL OR v_requested_units < 1 THEN
      RAISE EXCEPTION 'requested_units must be >= 1';
    END IF;

    INSERT INTO public.authorization_services(
      authorization_id,
      service_code,
      service_description,
      from_date,
      to_date,
      requested_units,
      unit_type,
      decision_status,
      organization_id,
      created_by
    ) VALUES (
      v_auth.id,
      v_service_code,
      v_service_description,
      v_from_date,
      v_to_date,
      v_requested_units,
      v_unit_type,
      v_decision_status,
      v_org_id,
      v_actor_id
    );
  END LOOP;

  RETURN v_auth;
END;
$$;
