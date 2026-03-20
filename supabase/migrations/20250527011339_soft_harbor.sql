/*
  # Add Client Documents Storage

  1. Changes
    - Create storage bucket for client documents
    - Add RLS policies for document access
    - Add functions for document management
    
  2. Security
    - Ensure proper access controls
    - Restrict access to authorized users only
*/

-- Create function to check if user can access client documents
CREATE OR REPLACE FUNCTION can_access_client_documents(client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    -- Admin can access all client documents
    public.user_has_role('admin') OR
    
    -- Therapist can access documents for clients they have sessions with
    (
      public.user_has_role('therapist') AND
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.client_id = client_id
        AND s.therapist_id = auth.uid()
      )
    )
  );
END;
$$;

-- Create storage bucket RLS policies
BEGIN;
  -- Enable RLS on the storage bucket
  CREATE POLICY "Client documents are viewable by admin and assigned therapists"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'client-documents' AND
    (
      -- Extract client_id from path (format: clients/{client_id}/...)
      can_access_client_documents(
        (storage.foldername(name))[2]::uuid
      )
    )
  );

  -- Allow uploads for admin and assigned therapists
  CREATE POLICY "Client documents can be uploaded by admin and assigned therapists"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents' AND
    (
      -- Extract client_id from path (format: clients/{client_id}/...)
      can_access_client_documents(
        (storage.foldername(name))[2]::uuid
      )
    )
  );

  -- Allow updates for admin and assigned therapists
  CREATE POLICY "Client documents can be updated by admin and assigned therapists"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'client-documents' AND
    (
      -- Extract client_id from path (format: clients/{client_id}/...)
      can_access_client_documents(
        (storage.foldername(name))[2]::uuid
      )
    )
  )
  WITH CHECK (
    bucket_id = 'client-documents' AND
    (
      -- Extract client_id from path (format: clients/{client_id}/...)
      can_access_client_documents(
        (storage.foldername(name))[2]::uuid
      )
    )
  );

  -- Allow deletion for admin and assigned therapists
  CREATE POLICY "Client documents can be deleted by admin and assigned therapists"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'client-documents' AND
    (
      -- Extract client_id from path (format: clients/{client_id}/...)
      can_access_client_documents(
        (storage.foldername(name))[2]::uuid
      )
    )
  );
COMMIT;

-- Create function to update client documents metadata
CREATE OR REPLACE FUNCTION update_client_documents(
  p_client_id uuid,
  p_documents jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if user can access client documents
  IF NOT can_access_client_documents(p_client_id) THEN
    RAISE EXCEPTION 'You do not have permission to update documents for this client';
  END IF;

  -- Update client documents
  UPDATE clients
  SET documents = p_documents
  WHERE id = p_client_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION can_access_client_documents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION update_client_documents(uuid, jsonb) TO authenticated;