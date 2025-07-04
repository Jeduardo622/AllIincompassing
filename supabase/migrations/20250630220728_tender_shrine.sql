/*
  # Fix storage policies

  1. Storage Policy Fixes
    - Drops conflicting policies
    - Creates properly named storage policies for client documents
    - Creates properly named storage policies for therapist documents
    - Ensures required storage buckets exist

  2. Security
    - Maintains proper access controls for all document types
    - Adds appropriate RLS policies for both client and therapist documents
*/

-- Use a DO block to check for existing policies and only create the ones that don't exist
DO $$
DECLARE
  policy_exists BOOLEAN;
BEGIN
  -- Drop policies with typos in their names
  DROP POLICY IF EXISTS "Client documents can be uploaded by admin and assigned therapis" ON storage.objects;
  DROP POLICY IF EXISTS "Client documents can be updated by admin and assigned therapis" ON storage.objects;
  DROP POLICY IF EXISTS "Client documents can be deleted by admin and assigned therapis" ON storage.objects;

  -- Check if client document update policy exists
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Client documents can be updated by admin and assigned therapist'
  ) INTO policy_exists;

  -- Skip creating policies that already exist
  IF NOT policy_exists THEN
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
              FROM public.sessions s
              JOIN public.clients c ON c.id = s.client_id
              WHERE s.therapist_id = auth.uid()
              AND (storage.foldername(name))[2] = c.id::text
            )
          )
          ELSE false
        END
      )
    );
  END IF;

  -- Check and create other policies only if they don't exist
  -- Allow authenticated users to upload client documents
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Allow authenticated users to upload client documents'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
    CREATE POLICY "Allow authenticated users to upload client documents" 
    ON storage.objects 
    FOR INSERT 
    TO authenticated 
    WITH CHECK (
      bucket_id = 'client-documents' AND 
      auth.uid() IS NOT NULL
    );
  END IF;

  -- Check for client documents upload policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Client documents can be uploaded by admin and assigned therapist'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
    CREATE POLICY "Client documents can be uploaded by admin and assigned therapist" 
    ON storage.objects 
    FOR INSERT 
    TO authenticated 
    WITH CHECK (
      bucket_id = 'client-documents' AND 
      (
        CASE
          WHEN auth.user_has_role('admin'::text) THEN true
          WHEN auth.user_has_role('therapist'::text) THEN (
            EXISTS (
              SELECT 1 
              FROM public.sessions s
              JOIN public.clients c ON c.id = s.client_id
              WHERE s.therapist_id = auth.uid()
              AND (storage.foldername(name))[2] = c.id::text
            )
          )
          ELSE false
        END
      )
    );
  END IF;

  -- Check for client documents delete policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Client documents can be deleted by admin and assigned therapist'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
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
              FROM public.sessions s
              JOIN public.clients c ON c.id = s.client_id
              WHERE s.therapist_id = auth.uid()
              AND (storage.foldername(name))[2] = c.id::text
            )
          )
          ELSE false
        END
      )
    );
  END IF;

  -- Check for client documents view policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Client documents are viewable by admin and assigned therapists'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
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
              FROM public.sessions s
              JOIN public.clients c ON c.id = s.client_id
              WHERE s.therapist_id = auth.uid()
              AND (storage.foldername(name))[2] = c.id::text
            )
          )
          ELSE false
        END
      )
    );
  END IF;

  -- Check for clients upload own documents policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Clients can upload their own documents'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
    CREATE POLICY "Clients can upload their own documents" 
    ON storage.objects 
    FOR INSERT 
    TO authenticated 
    WITH CHECK (
      bucket_id = 'client-documents' AND
      auth.user_has_role('client'::text) AND
      (storage.foldername(name))[2] = auth.uid()::text
    );
  END IF;

  -- Check for therapist upload own documents policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Therapists can upload their own documents'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
    CREATE POLICY "Therapists can upload their own documents" 
    ON storage.objects 
    FOR INSERT 
    TO authenticated 
    WITH CHECK (
      bucket_id = 'therapist-documents' AND
      auth.user_has_role('therapist'::text) AND
      (storage.foldername(name))[2] = auth.uid()::text
    );
  END IF;

  -- Check for therapist view own documents policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Therapists can view their own documents'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
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
  END IF;

  -- Check for therapist update own documents policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Therapists can update their own documents'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
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
  END IF;

  -- Check for therapist delete own documents policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Therapists can delete their own documents'
  ) INTO policy_exists;
  
  IF NOT policy_exists THEN
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
  END IF;
END $$;

-- Ensure buckets exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'Client Documents', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('therapist-documents', 'Therapist Documents', false)
ON CONFLICT (id) DO NOTHING;