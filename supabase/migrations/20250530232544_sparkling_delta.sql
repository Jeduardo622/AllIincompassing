-- Create a function to get user roles
CREATE OR REPLACE FUNCTION get_user_roles()
RETURNS TABLE (
  user_id uuid,
  roles text[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    auth.uid()::uuid,
    ARRAY_AGG(r.name)::text[] as roles
  FROM 
    user_roles ur
    JOIN roles r ON ur.role_id = r.id
  WHERE 
    ur.user_id = auth.uid()::uuid
  GROUP BY 
    auth.uid();
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_roles() TO authenticated;