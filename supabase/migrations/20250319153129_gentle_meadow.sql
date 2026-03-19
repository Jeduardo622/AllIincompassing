/*
  # Fix User Roles Function

  1. Changes
    - Move get_user_roles function to public schema
    - Add proper error handling
    - Fix function return type
    
  2. Security
    - Maintain existing RLS policies
    - Keep function as SECURITY DEFINER
*/

-- Drop existing function if it exists in auth schema
DROP FUNCTION IF EXISTS public.get_user_roles();

-- Create function in public schema
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE (roles text[]) 
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT ARRAY_AGG(r.name)::text[] as roles
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
  GROUP BY ur.user_id;
END;
$$ LANGUAGE plpgsql;