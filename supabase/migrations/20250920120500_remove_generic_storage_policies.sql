set search_path = public;

/*
  Remove generic storage policies and enforce client-scoped access
*/

-- Drop legacy generic policies so role-aware rules can take effect
DROP POLICY IF EXISTS "Allow authenticated users to upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to download client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete client documents" ON storage.objects;

-- Recreate the client-specific select policy with role guard
DROP POLICY IF EXISTS "Clients can view their own documents" ON storage.objects;
CREATE POLICY "Clients can view their own documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND app.user_has_role('client')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
