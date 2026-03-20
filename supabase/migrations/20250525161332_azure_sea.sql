/*
  # Add INSERT Policy for Authorizations Table

  1. Changes
    - Add INSERT policy for authorizations table
    - Allow admins and assigned therapists to create authorizations
    
  2. Security
    - Maintain existing RLS policies
    - Ensure proper role-based access control
*/

-- Drop existing INSERT policy if it exists
DROP POLICY IF EXISTS "Allow inserts for admins and assigned therapists" ON authorizations;

-- Create INSERT policy for authorizations
CREATE POLICY "Allow inserts for admins and assigned therapists" 
ON authorizations 
FOR INSERT 
TO authenticated 
WITH CHECK (
  public.user_has_role('admin') OR 
  (public.user_has_role('therapist') AND provider_id = auth.uid())
);

-- Create UPDATE policy for authorizations
DROP POLICY IF EXISTS "Allow updates for admins and assigned therapists" ON authorizations;
CREATE POLICY "Allow updates for admins and assigned therapists" 
ON authorizations 
FOR UPDATE 
TO authenticated 
USING (
  public.user_has_role('admin') OR 
  (public.user_has_role('therapist') AND provider_id = auth.uid())
)
WITH CHECK (
  public.user_has_role('admin') OR 
  (public.user_has_role('therapist') AND provider_id = auth.uid())
);

-- Create DELETE policy for authorizations
DROP POLICY IF EXISTS "Allow deletes for admins and assigned therapists" ON authorizations;
CREATE POLICY "Allow deletes for admins and assigned therapists" 
ON authorizations 
FOR DELETE 
TO authenticated 
USING (
  public.user_has_role('admin') OR 
  (public.user_has_role('therapist') AND provider_id = auth.uid())
);

-- Create INSERT policy for authorization_services
DROP POLICY IF EXISTS "Allow inserts for authorization services" ON authorization_services;
CREATE POLICY "Allow inserts for authorization services" 
ON authorization_services 
FOR INSERT 
TO authenticated 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM authorizations a
    WHERE a.id = authorization_id
    AND (
      public.user_has_role('admin') OR 
      (public.user_has_role('therapist') AND a.provider_id = auth.uid())
    )
  )
);

-- Create UPDATE policy for authorization_services
DROP POLICY IF EXISTS "Allow updates for authorization services" ON authorization_services;
CREATE POLICY "Allow updates for authorization services" 
ON authorization_services 
FOR UPDATE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM authorizations a
    WHERE a.id = authorization_id
    AND (
      public.user_has_role('admin') OR 
      (public.user_has_role('therapist') AND a.provider_id = auth.uid())
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM authorizations a
    WHERE a.id = authorization_id
    AND (
      public.user_has_role('admin') OR 
      (public.user_has_role('therapist') AND a.provider_id = auth.uid())
    )
  )
);

-- Create DELETE policy for authorization_services
DROP POLICY IF EXISTS "Allow deletes for authorization services" ON authorization_services;
CREATE POLICY "Allow deletes for authorization services" 
ON authorization_services 
FOR DELETE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM authorizations a
    WHERE a.id = authorization_id
    AND (
      public.user_has_role('admin') OR 
      (public.user_has_role('therapist') AND a.provider_id = auth.uid())
    )
  )
);