/*
# Fix Ambiguous Client ID in Storage Policies

1. New Policies
  - Drop existing policies that have ambiguous references
  - Recreate policies with explicit table references and joins
  - Fix client document access control

2. Changes
  - Use storage.foldername(name) to parse path structure
  - Add explicit table aliases to avoid ambiguity
  - Add proper DROP IF EXISTS for all policies
*/

-- Drop the problematic policies first
DROP POLICY IF EXISTS "Allow authenticated users to upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be uploaded by admin and assigned therapists" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be updated by admin and assigned therapis" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be deleted by admin and assigned therapis" ON storage.objects;
DROP POLICY IF EXISTS "Client documents are viewable by admin and assigned therapists" ON storage.objects;
DROP POLICY IF EXISTS "Clients can upload their own documents" ON storage.objects;

-- Recreate the policies with explicit column qualification
CREATE POLICY "Allow authenticated users to upload client documents" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'client-documents' AND 
  auth.uid() IS NOT NULL
);

-- Create policy for client documents with explicit table references
CREATE POLICY "Client documents can be uploaded by admin and assigned therapis" 
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

-- Create similar policies for other operations
CREATE POLICY "Client documents can be updated by admin and assigned therapis" 
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

CREATE POLICY "Client documents can be deleted by admin and assigned therapis" 
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

-- Update client documents viewable policy with explicit references
CREATE POLICY "Client documents are viewable by admin and assigned therapists" 
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
CREATE POLICY "Clients can upload their own documents" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'client-documents' AND
  auth.user_has_role('client'::text) AND
  (storage.foldername(name))[2] = auth.uid()::text
);