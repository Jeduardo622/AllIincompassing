/*
  # Fix Therapist Documents Bucket Policies

  1. Storage Configuration
    - Creates therapist-documents bucket if it doesn't exist

  2. Security
    - Ensures RLS is enabled
    - Creates document access policies with IF NOT EXISTS to avoid duplicates
*/

-- Create the therapist-documents storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('therapist-documents', 'therapist-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on the storage.objects table (should already be enabled, but ensure it)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy for therapists to upload their own documents
CREATE POLICY IF NOT EXISTS "Therapists can upload their own documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'therapist-documents' 
  AND (storage.foldername(name))[1] = 'therapists'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy for therapists to read their own documents
CREATE POLICY IF NOT EXISTS "Therapists can read their own documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'therapist-documents'
  AND (
    -- Allow therapists to read their own documents
    (auth.user_has_role('therapist'::text) AND (storage.foldername(name))[2] = auth.uid()::text)
    OR
    -- Allow admins to read all documents
    auth.user_has_role('admin'::text)
  )
);

-- Policy for therapists to update their own documents
CREATE POLICY IF NOT EXISTS "Therapists can update their own documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'therapist-documents'
  AND (
    -- Allow therapists to update their own documents
    (auth.user_has_role('therapist'::text) AND (storage.foldername(name))[2] = auth.uid()::text)
    OR
    -- Allow admins to update all documents
    auth.user_has_role('admin'::text)
  )
);

-- Policy for therapists to delete their own documents
CREATE POLICY IF NOT EXISTS "Therapists can delete their own documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'therapist-documents'
  AND (
    -- Allow therapists to delete their own documents
    (auth.user_has_role('therapist'::text) AND (storage.foldername(name))[2] = auth.uid()::text)
    OR
    -- Allow admins to delete all documents
    auth.user_has_role('admin'::text)
  )
);