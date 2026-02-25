BEGIN;

ALTER TABLE public.service_contracts
  ADD COLUMN IF NOT EXISTS authorized_units numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION app.create_client(p_client_data jsonb)
RETURNS public.clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_full_name text;
  v_payload jsonb := COALESCE(p_client_data, '{}'::jsonb);
  v_status_input text := lower(NULLIF(trim(v_payload->>'status'), ''));
  v_status text;
  v_effective_date date;
  v_termination_date date;
  v_result public.clients;

  v_contracts jsonb := COALESCE(
    v_payload->'service_contracts',
    v_payload->'insurance_info'->'service_contracts',
    '[]'::jsonb
  );
  v_contract jsonb;
  v_provider_raw text;
  v_provider text;
  v_units_raw text;
  v_units numeric;
  v_cpt_codes text[];
  v_contract_id uuid;
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
      FROM concat_ws(
        ' ',
        NULLIF(v_payload->>'first_name', ''),
        NULLIF(v_payload->>'middle_name', ''),
        NULLIF(v_payload->>'last_name', '')
      )
    );
  END IF;

  IF v_full_name IS NULL OR v_full_name = '' THEN
    v_full_name := 'Client';
  END IF;

  IF v_status_input IS NULL THEN
    v_status := 'active';
  ELSIF v_status_input = 'pending' THEN
    v_status := 'active';
  ELSIF v_status_input IN ('active', 'inactive', 'on_hold', 'discharged') THEN
    v_status := v_status_input;
  ELSE
    RAISE EXCEPTION 'Invalid client status: %', v_status_input USING ERRCODE = '22023';
  END IF;

  IF NULLIF(v_payload->>'auth_start_date', '') IS NOT NULL THEN
    v_effective_date := (v_payload->>'auth_start_date')::date;
  ELSE
    v_effective_date := CURRENT_DATE;
  END IF;

  IF NULLIF(v_payload->>'auth_end_date', '') IS NOT NULL THEN
    v_termination_date := (v_payload->>'auth_end_date')::date;
  ELSE
    v_termination_date := NULL;
  END IF;

  v_payload := v_payload
    || jsonb_build_object('organization_id', v_org)
    || jsonb_build_object('full_name', v_full_name)
    || jsonb_build_object('status', v_status);

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
    auth_units,
    auth_start_date,
    auth_end_date,
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
    input.auth_units,
    CASE
      WHEN input.auth_start_date IS NULL OR input.auth_start_date = '' THEN NULL
      ELSE input.auth_start_date::date
    END,
    CASE
      WHEN input.auth_end_date IS NULL OR input.auth_end_date = '' THEN NULL
      ELSE input.auth_end_date::date
    END,
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
    auth_units numeric,
    auth_start_date text,
    auth_end_date text,
    availability_hours jsonb,
    documents jsonb,
    notes text,
    status text,
    organization_id uuid,
    full_name text
  )
  RETURNING * INTO v_result;

  IF jsonb_typeof(v_contracts) = 'array' THEN
    FOR v_contract IN
      SELECT value FROM jsonb_array_elements(v_contracts)
    LOOP
      v_provider_raw := lower(trim(COALESCE(v_contract->>'provider', v_contract->>'payer_name', '')));
      IF v_provider_raw = 'private' THEN
        v_provider := 'Private';
      ELSIF v_provider_raw = 'iehp' THEN
        v_provider := 'IEHP';
      ELSIF v_provider_raw IN ('caloptima', 'cal optima') THEN
        v_provider := 'CalOptima';
      ELSE
        CONTINUE;
      END IF;

      v_units_raw := trim(COALESCE(v_contract->>'units', '0'));
      IF v_units_raw ~ '^\d+(\.\d+)?$' THEN
        v_units := GREATEST(v_units_raw::numeric, 0);
      ELSE
        v_units := 0;
      END IF;

      SELECT COALESCE(array_agg(upper(trim(code))), ARRAY[]::text[])
      INTO v_cpt_codes
      FROM jsonb_array_elements_text(COALESCE(v_contract->'cpt_codes', '[]'::jsonb)) AS code;

      INSERT INTO public.service_contracts (
        organization_id,
        client_id,
        payer_name,
        effective_date,
        termination_date,
        reimbursement_method,
        authorized_units,
        created_by,
        updated_by
      )
      VALUES (
        v_org,
        v_result.id,
        v_provider,
        v_effective_date,
        v_termination_date,
        'ACH',
        v_units,
        v_actor,
        v_actor
      )
      RETURNING id INTO v_contract_id;

      IF COALESCE(array_length(v_cpt_codes, 1), 0) > 0 THEN
        INSERT INTO public.service_contract_rates (
          contract_id,
          organization_id,
          cpt_code_id,
          rate,
          modifiers
        )
        SELECT
          v_contract_id,
          v_org,
          cpt.id,
          0,
          ARRAY[]::text[]
        FROM public.cpt_codes cpt
        WHERE upper(cpt.code) = ANY(v_cpt_codes)
        ON CONFLICT (contract_id, cpt_code_id)
        DO UPDATE SET
          rate = EXCLUDED.rate,
          modifiers = EXCLUDED.modifiers;
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION app.create_client(jsonb) TO authenticated;

COMMIT;
