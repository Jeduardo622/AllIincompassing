/*
  # Fix Storage Policies for Client and Therapist Documents
  
  1. Changes
     - Drops existing problematic policies
     - Creates new policies with correct syntax (removing IF NOT EXISTS)
     - Fixes typo in policy names (therapis → therapist)
     - Adds proper bucket policies for client and therapist documents
  
  2. Security
     - Maintains role-based access control
     - Ensures clients can only access their own documents
     - Ensures therapists can only access documents for their clients
     - Admins retain full access
*/

-- Drop all existing policies to avoid conflicts
DROP POLICY IF EXISTS "Allow authenticated users to upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be uploaded by admin and assigned therapis" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be updated by admin and assigned therapis" ON storage.objects;
DROP POLICY IF EXISTS "Client documents can be deleted by admin and assigned therapis" ON storage.objects;
DROP POLICY IF EXISTS "Client documents are viewable by admin and assigned therapists" ON storage.objects;
DROP POLICY IF EXISTS "Clients can upload their own documents" ON storage.objects;

-- Create policy for authenticated users to upload client documents
CREATE POLICY "Allow authenticated users to upload client documents" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'client-documents' AND 
  auth.uid() IS NOT NULL
);

-- Create policy for admin and assigned therapists to upload client documents
CREATE POLICY "Client documents can be uploaded by admin and assigned therapist" 
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

-- Create policy for admin and assigned therapists to update client documents
CREATE POLICY "Client documents can be updated by admin and assigned therapist" 
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

-- Create policy for admin and assigned therapists to delete client documents
CREATE POLICY "Client documents can be deleted by admin and assigned therapist" 
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

-- Allow clients to upload their own documents
CREATE POLICY "Clients can upload their own documents" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'client-documents' AND
  auth.user_has_role('client'::text) AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Create policies for therapist documents
-- Allow therapists to upload their own documents
CREATE POLICY "Therapists can upload their own documents" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'therapist-documents' AND
  auth.user_has_role('therapist'::text) AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow therapists to view their own documents
CREATE POLICY "Therapists can view their own documents" 
ON storage.objects 
FOR SELECT
TO authenticated 
USING (
  bucket_id = 'therapist-documents' AND
  (
    CASE
      WHEN auth.user_has_role('admin'::text) THEN true
      WHEN auth.user_has_role('therapist'::text) THEN (storage.foldername(name))[2] = auth.uid()::text
      ELSE false
    END
  )
);

-- Allow therapists to update their own documents
CREATE POLICY "Therapists can update their own documents" 
ON storage.objects 
FOR UPDATE
TO authenticated 
USING (
  bucket_id = 'therapist-documents' AND
  (
    CASE
      WHEN auth.user_has_role('admin'::text) THEN true
      WHEN auth.user_has_role('therapist'::text) THEN (storage.foldername(name))[2] = auth.uid()::text
      ELSE false
    END
  )
);

-- Allow therapists to delete their own documents
CREATE POLICY "Therapists can delete their own documents" 
ON storage.objects 
FOR DELETE
TO authenticated 
USING (
  bucket_id = 'therapist-documents' AND
  (
    CASE
      WHEN auth.user_has_role('admin'::text) THEN true
      WHEN auth.user_has_role('therapist'::text) THEN (storage.foldername(name))[2] = auth.uid()::text
      ELSE false
    END
  )
);

-- Ensure buckets exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'Client Documents', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('therapist-documents', 'Therapist Documents', false)
ON CONFLICT (id) DO NOTHING;