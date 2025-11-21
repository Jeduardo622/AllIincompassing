BEGIN;

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

COMMIT;

