/*
# Fix storage policies for client documents

1. Changes
  - Fix typos in policy names (therapis -> therapist)
  - Add proper existence checks before policy creation
  - Ensure all policies are dropped if they exist before recreating them
  - Maintain consistent naming convention
  
2. Security
  - Maintain same access control logic
  - Fix client document access policies
*/

-- Drop all existing policies to avoid conflicts
DROP POLICY IF EXISTS "Allow authenticated users to upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be uploaded by admin and assigned therapis" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be updated by admin and assigned therapis" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be deleted by admin and assigned therapis" ON storage.objects;
DROP POLICY IF EXISTS "Client documents are viewable by admin and assigned therapists" ON storage.objects;
DROP POLICY IF EXISTS "Clients can upload their own documents" ON storage.objects;

-- Fix: Include proper name for therapist (not therapis) and add IF NOT EXISTS
CREATE POLICY IF NOT EXISTS "Allow authenticated users to upload client documents" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'client-documents' AND 
  auth.uid() IS NOT NULL
);

-- Fix: Correct name from "therapis" to "therapist"
CREATE POLICY IF NOT EXISTS "Client documents can be uploaded by admin and assigned therapist" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'client-documents' AND 
  (
    CASE
      -- Admin can upload for any client
      WHEN auth.user_has_role('admin'::text) THEN true
      -- Therapists can upload for clients they're associated with
      WHEN auth.user_has_role('therapist'::text) THEN (
        EXISTS (
          SELECT 1 
          FROM sessions s
          JOIN clients c ON c.id = s.client_id
          WHERE s.therapist_id = auth.uid()
          AND (storage.foldername(name))[2] = c.id::text
        )
      )
      ELSE false
    END
  )
);

-- Fix: Correct name from "therapis" to "therapist"
CREATE POLICY IF NOT EXISTS "Client documents can be updated by admin and assigned therapist" 
ON storage.objects 
FOR UPDATE
TO authenticated 
USING (
  bucket_id = 'client-documents' AND 
  (
    CASE
      WHEN auth.user_has_role('admin'::text) THEN true
      WHEN auth.user_has_role('therapist'::text) THEN (
        EXISTS (
          SELECT 1 
          FROM sessions s
          JOIN clients c ON c.id = s.client_id
          WHERE s.therapist_id = auth.uid()
          AND (storage.foldername(name))[2] = c.id::text
        )
      )
      ELSE false
    END
  )
);

-- Fix: Correct name from "therapis" to "therapist"
CREATE POLICY IF NOT EXISTS "Client documents can be deleted by admin and assigned therapist" 
ON storage.objects 
FOR DELETE
TO authenticated 
USING (
  bucket_id = 'client-documents' AND 
  (
    CASE
      WHEN auth.user_has_role('admin'::text) THEN true
      WHEN auth.user_has_role('therapist'::text) THEN (
        EXISTS (
          SELECT 1 
          FROM sessions s
          JOIN clients c ON c.id = s.client_id
          WHERE s.therapist_id = auth.uid()
          AND (storage.foldername(name))[2] = c.id::text
        )
      )
      ELSE false
    END
  )
);

-- Create policy for viewing client documents
CREATE POLICY IF NOT EXISTS "Client documents are viewable by admin and assigned therapists" 
ON storage.objects 
FOR SELECT
TO authenticated 
USING (
  bucket_id = 'client-documents' AND 
  (
    CASE
      WHEN auth.user_has_role('admin'::text) THEN true
      WHEN auth.user_has_role('therapist'::text) THEN (
        EXISTS (
          SELECT 1 
          FROM sessions s
          JOIN clients c ON c.id = s.client_id
          WHERE s.therapist_id = auth.uid()
          AND (storage.foldername(name))[2] = c.id::text
        )
      )
      ELSE false
    END
  )
);

-- Allow clients to manage their own documents
CREATE POLICY IF NOT EXISTS "Clients can upload their own documents" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'client-documents' AND
  auth.user_has_role('client'::text) AND
  (storage.foldername(name))[2] = auth.uid()::text
);