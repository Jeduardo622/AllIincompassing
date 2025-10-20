BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

-- Table to capture guardian onboarding requests that require administrative review.
CREATE TABLE IF NOT EXISTS public.guardian_link_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guardian_email text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  invite_token text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_client_ids uuid[] NOT NULL DEFAULT '{}',
  approved_client_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  processed_at timestamptz,
  processed_by uuid REFERENCES auth.users(id),
  resolution_notes text
);

COMMENT ON TABLE public.guardian_link_queue IS 'Administrative queue for new guardian accounts that must be linked to dependents.';
COMMENT ON COLUMN public.guardian_link_queue.metadata IS 'JSONB blob describing signup hints, invite codes, and processing annotations.';
COMMENT ON COLUMN public.guardian_link_queue.requested_client_ids IS 'Client ids requested by the guardian (if provided during signup).';
COMMENT ON COLUMN public.guardian_link_queue.approved_client_ids IS 'Client ids linked by an administrator when approving the guardian request.';

CREATE INDEX IF NOT EXISTS guardian_link_queue_status_idx ON public.guardian_link_queue (status);
CREATE INDEX IF NOT EXISTS guardian_link_queue_guardian_idx ON public.guardian_link_queue (guardian_id);
CREATE INDEX IF NOT EXISTS guardian_link_queue_org_idx ON public.guardian_link_queue (organization_id);

ALTER TABLE public.guardian_link_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.touch_guardian_link_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guardian_link_queue_touch ON public.guardian_link_queue;
CREATE TRIGGER guardian_link_queue_touch
  BEFORE UPDATE ON public.guardian_link_queue
  FOR EACH ROW
  EXECUTE FUNCTION app.touch_guardian_link_queue();

DROP POLICY IF EXISTS guardian_link_queue_guardian_read ON public.guardian_link_queue;
CREATE POLICY guardian_link_queue_guardian_read
  ON public.guardian_link_queue
  FOR SELECT
  TO authenticated
  USING (guardian_id = auth.uid());

DROP POLICY IF EXISTS guardian_link_queue_admin_read ON public.guardian_link_queue;
CREATE POLICY guardian_link_queue_admin_read
  ON public.guardian_link_queue
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin'])
  );

DROP POLICY IF EXISTS guardian_link_queue_admin_update ON public.guardian_link_queue;
CREATE POLICY guardian_link_queue_admin_update
  ON public.guardian_link_queue
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin'])
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin'])
  );

CREATE OR REPLACE FUNCTION app.ensure_user_role_by_name(
  p_user_id uuid,
  p_role_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role_id uuid;
  v_user_role_id uuid;
  v_now timestamptz := timezone('utc', now());
BEGIN
  IF p_user_id IS NULL OR p_role_name IS NULL THEN
    RAISE EXCEPTION 'User id and role name are required.';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE name = p_role_name
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Role % not found', p_role_name;
  END IF;

  UPDATE public.user_roles
  SET
    is_active = true,
    expires_at = NULL,
    granted_at = COALESCE(granted_at, v_now)
  WHERE user_id = p_user_id
    AND role_id = v_role_id
  RETURNING id INTO v_user_role_id;

  IF v_user_role_id IS NOT NULL THEN
    RETURN v_user_role_id;
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, granted_at, granted_by, is_active)
  VALUES (p_user_id, v_role_id, v_now, auth.uid(), true)
  ON CONFLICT (user_id, role_id) DO UPDATE
    SET is_active = true,
        expires_at = NULL,
        granted_at = EXCLUDED.granted_at
  RETURNING id INTO v_user_role_id;

  RETURN v_user_role_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app.ensure_user_role_by_name(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION app.enqueue_guardian_link_request(
  p_guardian_id uuid,
  p_guardian_email text,
  p_organization_id uuid,
  p_invite_token text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing_id uuid;
  v_payload jsonb := jsonb_strip_nulls(COALESCE(p_metadata, '{}'::jsonb));
BEGIN
  IF p_guardian_id IS NULL THEN
    RAISE EXCEPTION 'Guardian id is required';
  END IF;

  UPDATE public.guardian_link_queue
  SET
    guardian_email = COALESCE(lower(p_guardian_email), guardian_link_queue.guardian_email),
    organization_id = COALESCE(p_organization_id, guardian_link_queue.organization_id),
    invite_token = COALESCE(NULLIF(p_invite_token, ''), guardian_link_queue.invite_token),
    metadata = jsonb_strip_nulls(guardian_link_queue.metadata || v_payload),
    updated_at = timezone('utc', now())
  WHERE guardian_id = p_guardian_id
    AND status = 'pending'
  RETURNING id INTO v_existing_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.guardian_link_queue (
    guardian_id,
    guardian_email,
    organization_id,
    invite_token,
    metadata,
    created_by
  )
  VALUES (
    p_guardian_id,
    lower(COALESCE(p_guardian_email, '')),
    p_organization_id,
    NULLIF(p_invite_token, ''),
    v_payload,
    auth.uid()
  )
  RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app.enqueue_guardian_link_request(uuid, text, uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION app.process_guardian_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_metadata jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_signup_role text := lower(COALESCE(v_metadata->>'signup_role', v_metadata->>'role'));
  v_guardian_flag boolean := COALESCE((v_metadata->>'guardian_signup')::boolean, false);
  v_org_hint text := NULLIF(v_metadata->>'guardian_organization_hint', '');
  v_invite_token text := NULLIF(v_metadata->>'guardian_invite_token', '');
  v_resolved_org uuid;
  v_queue_metadata jsonb;
BEGIN
  IF NOT v_guardian_flag AND v_signup_role IS DISTINCT FROM 'guardian' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_resolved_org := NULLIF(v_metadata->>'organization_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_resolved_org := NULL;
  END;

  IF v_resolved_org IS NULL AND v_org_hint IS NOT NULL THEN
    BEGIN
      v_resolved_org := v_org_hint::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      SELECT id INTO v_resolved_org
      FROM public.organizations
      WHERE lower(COALESCE(slug, '')) = lower(v_org_hint)
         OR lower(COALESCE(name, '')) = lower(v_org_hint)
      LIMIT 1;
    END;
  END IF;

  IF v_resolved_org IS NOT NULL THEN
    PERFORM 1 FROM public.organizations WHERE id = v_resolved_org;
    IF NOT FOUND THEN
      v_resolved_org := NULL;
    END IF;
  END IF;

  v_queue_metadata := jsonb_strip_nulls(jsonb_build_object(
    'guardian_organization_hint', v_org_hint,
    'guardian_invite_token', v_invite_token,
    'signup_role', v_signup_role,
    'source', 'guardian_signup'
  ));

  PERFORM app.enqueue_guardian_link_request(
    NEW.id,
    NEW.email,
    v_resolved_org,
    v_invite_token,
    v_queue_metadata
  );

  PERFORM app.ensure_user_role_by_name(NEW.id, 'client');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS process_guardian_signup_trigger ON auth.users;
CREATE TRIGGER process_guardian_signup_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION app.process_guardian_signup();

CREATE OR REPLACE FUNCTION app.guardian_link_queue_admin_view(
  p_organization_id uuid,
  p_status text DEFAULT 'pending'
)
RETURNS TABLE (
  id uuid,
  guardian_id uuid,
  guardian_email text,
  status text,
  organization_id uuid,
  invite_token text,
  metadata jsonb,
  requested_client_ids uuid[],
  approved_client_ids uuid[],
  created_at timestamptz,
  updated_at timestamptz,
  processed_at timestamptz,
  processed_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org uuid := COALESCE(p_organization_id, app.current_user_organization_id());
  v_status text := COALESCE(p_status, 'pending');
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Organization context is required to review guardian requests';
  END IF;

  IF NOT app.user_has_role_for_org(app.current_user_id(), v_org, ARRAY['org_admin']) THEN
    RAISE EXCEPTION 'Insufficient privileges to review guardian requests for this organization';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.guardian_id,
    q.guardian_email,
    q.status,
    q.organization_id,
    q.invite_token,
    q.metadata,
    q.requested_client_ids,
    q.approved_client_ids,
    q.created_at,
    q.updated_at,
    q.processed_at,
    q.processed_by
  FROM public.guardian_link_queue q
  WHERE COALESCE(q.organization_id, v_org) = v_org
    AND (v_status = 'any' OR q.status = v_status)
  ORDER BY q.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION app.guardian_link_queue_admin_view(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION app.approve_guardian_request(
  p_request_id uuid,
  p_client_ids uuid[],
  p_relationship text DEFAULT NULL,
  p_resolution_notes text DEFAULT NULL
)
RETURNS TABLE (
  guardian_id uuid,
  approved_client_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_request public.guardian_link_queue%ROWTYPE;
  v_org uuid;
  v_actor uuid := app.current_user_id();
  v_now timestamptz := timezone('utc', now());
  v_client_id uuid;
  v_linked_clients uuid[] := '{}';
  v_relationship text := NULLIF(p_relationship, '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication context required';
  END IF;

  SELECT * INTO v_request
  FROM public.guardian_link_queue
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guardian request % not found', p_request_id;
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Guardian request % is not pending', p_request_id;
  END IF;

  v_org := v_request.organization_id;

  IF (p_client_ids IS NULL OR array_length(p_client_ids, 1) = 0) AND v_org IS NULL THEN
    RAISE EXCEPTION 'Select at least one client or provide an organization before approval';
  END IF;

  IF p_client_ids IS NOT NULL AND array_length(p_client_ids, 1) > 0 THEN
    SELECT DISTINCT organization_id INTO v_org
    FROM public.clients
    WHERE id = ANY(p_client_ids)
    LIMIT 1;

    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Unable to resolve organization from selected clients';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = ANY(p_client_ids)
        AND c.organization_id <> v_org
    ) THEN
      RAISE EXCEPTION 'All selected clients must belong to the same organization';
    END IF;
  END IF;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Organization context could not be resolved for guardian approval';
  END IF;

  IF NOT app.user_has_role_for_org(v_actor, v_org, ARRAY['org_admin']) THEN
    RAISE EXCEPTION 'Insufficient privileges to approve guardian access for this organization';
  END IF;

  IF p_client_ids IS NOT NULL THEN
    FOREACH v_client_id IN ARRAY p_client_ids LOOP
      UPDATE public.client_guardians
      SET
        deleted_at = NULL,
        deleted_by = NULL,
        updated_at = v_now,
        updated_by = v_actor,
        relationship = COALESCE(v_relationship, relationship)
      WHERE guardian_id = v_request.guardian_id
        AND client_id = v_client_id
        AND organization_id = v_org;

      IF NOT FOUND THEN
        INSERT INTO public.client_guardians (
          organization_id,
          client_id,
          guardian_id,
          relationship,
          is_primary,
          metadata,
          created_by,
          updated_by
        )
        VALUES (
          v_org,
          v_client_id,
          v_request.guardian_id,
          COALESCE(v_relationship, 'guardian'),
          false,
          jsonb_strip_nulls(jsonb_build_object('source', 'guardian_queue', 'queue_id', p_request_id)),
          v_actor,
          v_actor
        );
      END IF;

      v_linked_clients := array_append(v_linked_clients, v_client_id);
    END LOOP;
  END IF;

  UPDATE public.guardian_link_queue
  SET
    status = 'approved',
    organization_id = v_org,
    approved_client_ids = COALESCE(v_linked_clients, '{}'),
    processed_at = v_now,
    processed_by = v_actor,
    resolution_notes = NULLIF(p_resolution_notes, ''),
    metadata = jsonb_strip_nulls(metadata || jsonb_build_object(
      'approved_client_ids', COALESCE(v_linked_clients, '{}'),
      'approved_relationship', v_relationship,
      'resolution_notes', NULLIF(p_resolution_notes, '')
    ))
  WHERE id = p_request_id;

  PERFORM app.ensure_user_role_by_name(v_request.guardian_id, 'client');

  RETURN QUERY SELECT v_request.guardian_id, COALESCE(v_linked_clients, '{}');
END;
$$;

GRANT EXECUTE ON FUNCTION app.approve_guardian_request(uuid, uuid[], text, text) TO authenticated;

COMMIT;
