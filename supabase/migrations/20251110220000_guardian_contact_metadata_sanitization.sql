BEGIN;

-- Provide a guardian-scoped view into client_guardians metadata without exposing organization metadata.
CREATE OR REPLACE FUNCTION app.guardian_contact_metadata(
  p_guardian_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  client_id uuid,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_guardian uuid := COALESCE(p_guardian_id, auth.uid());
BEGIN
  IF v_guardian IS NULL THEN
    RAISE EXCEPTION 'Guardian context is required';
  END IF;

  RETURN QUERY
  SELECT
    cg.client_id,
    jsonb_strip_nulls(
      COALESCE(cg.metadata, '{}'::jsonb)
        - 'organization_metadata'
        - 'organizationMetadata'
        - 'organization'
        - 'organization_id'
        - 'organizationId'
    ) AS metadata
  FROM public.client_guardians cg
  WHERE cg.guardian_id = v_guardian
    AND cg.deleted_at IS NULL
    AND (
      v_guardian = auth.uid()
      OR app.user_has_role_for_org(app.current_user_id(), cg.organization_id, ARRAY['org_admin'])
    );
END;
$$;

GRANT EXECUTE ON FUNCTION app.guardian_contact_metadata(uuid) TO authenticated;

-- Public wrapper so PostgREST clients can call without reference to the app schema.
CREATE OR REPLACE FUNCTION public.guardian_contact_metadata(
  p_guardian_id uuid DEFAULT NULL
)
RETURNS TABLE (
  client_id uuid,
  metadata jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT * FROM app.guardian_contact_metadata(COALESCE(p_guardian_id, auth.uid()));
$$;

GRANT EXECUTE ON FUNCTION public.guardian_contact_metadata(uuid) TO authenticated;

COMMIT;

