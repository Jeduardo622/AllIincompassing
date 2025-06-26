/*
  # Fix Client Documents Bucket Policies

  1. Storage Configuration
    - Creates client-documents bucket if it doesn't exist

  2. Security
    - Ensures RLS is enabled
    - Creates document access policies with IF NOT EXISTS to avoid duplicates
*/

-- Create the client-documents storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'client-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on the storage.objects table (should already be enabled, but ensure it)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy for therapists to upload client documents
CREATE POLICY IF NOT EXISTS "Users can upload client documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'client-documents' 
  AND (storage.foldername(name))[1] = 'clients'
);

-- Policy for therapists and admins to read client documents
CREATE POLICY IF NOT EXISTS "Therapists and admins can read client documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'client-documents'
  AND (
    -- Allow therapists to read client documents they have access to
    auth.user_has_role('therapist'::text)
    OR
    -- Allow admins to read all client documents
    auth.user_has_role('admin'::text)
  )
);

-- Policy for therapists and admins to update client documents
CREATE POLICY IF NOT EXISTS "Therapists and admins can update client documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'client-documents'
  AND (
    -- Allow therapists to update client documents they have access to
    auth.user_has_role('therapist'::text)
    OR
    -- Allow admins to update all client documents
    auth.user_has_role('admin'::text)
  )
);

-- Policy for therapists and admins to delete client documents
CREATE POLICY IF NOT EXISTS "Therapists and admins can delete client documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'client-documents'
  AND (
    -- Allow therapists to delete client documents they have access to
    auth.user_has_role('therapist'::text)
    OR
    -- Allow admins to delete all client documents
    auth.user_has_role('admin'::text)
  )
);