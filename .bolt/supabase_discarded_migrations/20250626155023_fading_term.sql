-- Create the client-documents storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'client-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on the storage.objects table (should already be enabled, but ensure it)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy for clients to upload their own documents
CREATE POLICY "Clients can upload their own documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'client-documents' 
  AND (storage.foldername(name))[1] = 'clients'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy for clients to read their own documents
CREATE POLICY "Clients can read their own documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'client-documents'
  AND (
    -- Allow clients to read their own documents
    ((storage.foldername(name))[1] = 'clients' AND (storage.foldername(name))[2] = auth.uid()::text)
    OR
    -- Allow therapists to read documents of their assigned clients
    (auth.user_has_role('therapist'::text) AND EXISTS (
      SELECT 1 FROM sessions s
      JOIN clients c ON s.client_id = c.id
      WHERE s.therapist_id = auth.uid() 
      AND (storage.foldername(name))[2] = c.id::text
    ))
    OR
    -- Allow admins to read all documents
    auth.user_has_role('admin'::text)
  )
);

-- Policy for clients to update their own documents
CREATE POLICY "Clients can update their own documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'client-documents'
  AND (
    -- Allow clients to update their own documents
    ((storage.foldername(name))[1] = 'clients' AND (storage.foldername(name))[2] = auth.uid()::text)
    OR
    -- Allow admins to update all documents
    auth.user_has_role('admin'::text)
  )
);

-- Policy for clients to delete their own documents
CREATE POLICY "Clients can delete their own documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'client-documents'
  AND (
    -- Allow clients to delete their own documents
    ((storage.foldername(name))[1] = 'clients' AND (storage.foldername(name))[2] = auth.uid()::text)
    OR
    -- Allow admins to delete all documents
    auth.user_has_role('admin'::text)
  )
);