/*
  # Guardian portal public wrapper

  Creates a security definer wrapper in the public schema around the
  existing app.get_guardian_client_portal function and grants execute
  permissions to authenticated users.
*/

CREATE OR REPLACE FUNCTION public.get_guardian_client_portal(
  p_client_id uuid DEFAULT NULL
)
RETURNS TABLE (
  client_id uuid,
  client_full_name text,
  client_date_of_birth date,
  client_email text,
  client_phone text,
  client_status text,
  guardian_relationship text,
  guardian_is_primary boolean,
  upcoming_sessions jsonb,
  guardian_notes jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT *
  FROM app.get_guardian_client_portal(p_client_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_guardian_client_portal(uuid) TO authenticated;
