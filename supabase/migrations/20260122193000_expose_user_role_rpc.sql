BEGIN;

CREATE OR REPLACE FUNCTION public.user_has_role_for_org(
  role_name text,
  target_organization_id uuid DEFAULT NULL,
  target_therapist_id uuid DEFAULT NULL,
  target_client_id uuid DEFAULT NULL,
  target_session_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.user_has_role_for_org(
    role_name,
    target_organization_id,
    target_therapist_id,
    target_client_id,
    target_session_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_role_for_org(text, uuid, uuid, uuid, uuid) TO authenticated;

COMMIT;
