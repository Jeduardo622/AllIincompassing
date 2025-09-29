BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

UPDATE public.clients
SET updated_at = COALESCE(updated_at, created_at, timezone('utc', now()));

CREATE OR REPLACE FUNCTION app.set_client_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := v_actor;
    END IF;

    IF NEW.updated_by IS NULL THEN
      NEW.updated_by := COALESCE(v_actor, NEW.created_by);
    END IF;

    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := timezone('utc', now());
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := OLD.created_by;
    END IF;

    IF v_actor IS NOT NULL THEN
      NEW.updated_by := v_actor;
    ELSIF NEW.updated_by IS NULL THEN
      NEW.updated_by := COALESCE(OLD.updated_by, OLD.created_by, NEW.created_by);
    END IF;

    NEW.updated_at := timezone('utc', now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_set_audit_fields ON public.clients;
CREATE TRIGGER clients_set_audit_fields
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION app.set_client_audit_fields();

ALTER POLICY "Clients scoped access"
  ON public.clients
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, id) THEN (
        public.clients.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = public.clients.id
            AND s.therapist_id = auth.uid()
        )
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, id) THEN (
        public.clients.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = public.clients.id
            AND s.therapist_id = auth.uid()
        )
      )
      ELSE false
    END
  );

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
    NULLIF(input.date_of_birth, ''),
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

GRANT EXECUTE ON FUNCTION app.create_client(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION app.client_email_exists(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN false;
  END IF;

  v_org := app.current_user_organization_id();
  IF v_org IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    app.user_has_role_for_org('admin', v_org)
    OR app.user_has_role_for_org('super_admin', v_org)
    OR app.user_has_role_for_org('therapist', v_org)
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE lower(c.email) = lower(p_email)
      AND c.organization_id = v_org
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app.client_email_exists(text) TO authenticated;

COMMIT;
