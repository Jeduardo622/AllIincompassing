/*
  # Remove generic storage policies

  1. Cleanup
    - Drop legacy "Allow authenticated users..." policies on storage.objects

  2. Security
    - Enforce role-aware policies from 20250630220728_tender_shrine.sql
    - Allow clients to read documents stored in their own folders
*/

-- Drop legacy generic policies so role-aware rules can take effect
DROP POLICY IF EXISTS "Allow authenticated users to upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to download client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete client documents" ON storage.objects;

-- Ensure clients can read their own documents without reintroducing broad access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Clients can view their own documents'
  ) THEN
    CREATE POLICY "Clients can view their own documents"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'client-documents'
      AND auth.user_has_role('client'::text)
      AND (storage.foldername(name))[2] = auth.uid()::text
    );
  END IF;
END
$$;
