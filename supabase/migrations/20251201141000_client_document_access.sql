/*
  # Reinstate document access helper

  1. Changes
    - Recreate can_access_client_documents helper with explicit search_path and broader role support.
    - Re-grant execute to authenticated users.

  2. Security
    - Function remains SECURITY DEFINER but restricts access based on auth roles and relationships.
*/

CREATE OR REPLACE FUNCTION public.can_access_client_documents(p_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requestor uuid := auth.uid();
BEGIN
  IF v_requestor IS NULL THEN
    RETURN false;
  END IF;

  RETURN
    -- Super admins/admins may access all client documents
    auth.user_has_role('super_admin')
    OR auth.user_has_role('admin')
    OR (
      -- Therapists can access clients tied to their sessions
      auth.user_has_role('therapist')
      AND EXISTS (
        SELECT 1
        FROM sessions s
        WHERE s.client_id = p_client_id
          AND s.therapist_id = v_requestor
      )
    )
    OR (
      -- Guardians linked to the client may access
      EXISTS (
        SELECT 1
        FROM client_guardians cg
        WHERE cg.client_id = p_client_id
          AND cg.guardian_id = v_requestor
          AND cg.deleted_at IS NULL
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_client_documents(uuid) TO authenticated;

