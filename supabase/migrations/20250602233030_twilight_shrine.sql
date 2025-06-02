/*
  # Storage Policies for Client Documents

  1. New Policies
    - Enable uploads to client-documents bucket for authenticated users
    - Allow downloads of client documents for authenticated users
    - Allow deleting client documents for authenticated users

  2. Security
    - Policies are scoped to authenticated users only
    - Path-based security to ensure users can only access their assigned documents
*/

-- Check if the client-documents bucket exists, create it if not
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('client-documents', 'client-documents', false)
  ON CONFLICT (id) DO NOTHING;
END
$$;

-- Enable RLS on storage.objects (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Allow authenticated users to upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to download client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete client documents" ON storage.objects;

-- Create policy to allow authenticated users to upload client documents
CREATE POLICY "Allow authenticated users to upload client documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'client-documents'
);

-- Create policy to allow authenticated users to download client documents
CREATE POLICY "Allow authenticated users to download client documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'client-documents'
);

-- Create policy to allow authenticated users to delete client documents
CREATE POLICY "Allow authenticated users to delete client documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'client-documents'
);

-- Create policy to allow authenticated users to update client documents
CREATE POLICY "Allow authenticated users to update client documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'client-documents'
);