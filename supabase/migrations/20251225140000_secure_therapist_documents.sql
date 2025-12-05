/*
  # Tighten therapist document storage policies

  - Replaces legacy therapist document policies with organization-aware checks
  - Restricts access to admins and super-admins within the therapist's organization
  - Preserves therapist self-access based on folder path scoping
*/

-- Drop legacy therapist document policies regardless of prior naming
DROP POLICY IF EXISTS "Therapists can read their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Therapists can view their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Therapists can upload their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Therapists can update their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Therapists can delete their own documents" ON storage.objects;

DROP POLICY IF EXISTS therapist_documents_read_access ON storage.objects;
DROP POLICY IF EXISTS therapist_documents_insert_access ON storage.objects;
DROP POLICY IF EXISTS therapist_documents_update_access ON storage.objects;
DROP POLICY IF EXISTS therapist_documents_delete_access ON storage.objects;

-- Allow reads when caller shares organization or owns the folder
CREATE POLICY therapist_documents_read_access
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'therapist-documents'
    AND cardinality(storage.foldername(name)) >= 2
    AND (storage.foldername(name))[1] = 'therapists'
    AND EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id::text = (storage.foldername(name))[2]
        AND (
          app.user_has_role_for_org('admin', t.organization_id, t.id)
          OR app.user_has_role_for_org('super_admin', t.organization_id, t.id)
          OR (t.id = auth.uid() AND app.user_has_role_for_org('therapist', t.organization_id, t.id))
        )
    )
  );

-- Allow inserts for same-organization admins/super-admins or the therapist
CREATE POLICY therapist_documents_insert_access
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'therapist-documents'
    AND cardinality(storage.foldername(name)) >= 2
    AND (storage.foldername(name))[1] = 'therapists'
    AND EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id::text = (storage.foldername(name))[2]
        AND (
          app.user_has_role_for_org('admin', t.organization_id, t.id)
          OR app.user_has_role_for_org('super_admin', t.organization_id, t.id)
          OR (t.id = auth.uid() AND app.user_has_role_for_org('therapist', t.organization_id, t.id))
        )
    )
  );

-- Allow updates for same-organization admins/super-admins or the therapist
CREATE POLICY therapist_documents_update_access
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'therapist-documents'
    AND cardinality(storage.foldername(name)) >= 2
    AND (storage.foldername(name))[1] = 'therapists'
    AND EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id::text = (storage.foldername(name))[2]
        AND (
          app.user_has_role_for_org('admin', t.organization_id, t.id)
          OR app.user_has_role_for_org('super_admin', t.organization_id, t.id)
          OR (t.id = auth.uid() AND app.user_has_role_for_org('therapist', t.organization_id, t.id))
        )
    )
  )
  WITH CHECK (
    bucket_id = 'therapist-documents'
    AND cardinality(storage.foldername(name)) >= 2
    AND (storage.foldername(name))[1] = 'therapists'
    AND EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id::text = (storage.foldername(name))[2]
        AND (
          app.user_has_role_for_org('admin', t.organization_id, t.id)
          OR app.user_has_role_for_org('super_admin', t.organization_id, t.id)
          OR (t.id = auth.uid() AND app.user_has_role_for_org('therapist', t.organization_id, t.id))
        )
    )
  );

-- Allow deletes for same-organization admins/super-admins or the therapist
CREATE POLICY therapist_documents_delete_access
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'therapist-documents'
    AND cardinality(storage.foldername(name)) >= 2
    AND (storage.foldername(name))[1] = 'therapists'
    AND EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id::text = (storage.foldername(name))[2]
        AND (
          app.user_has_role_for_org('admin', t.organization_id, t.id)
          OR app.user_has_role_for_org('super_admin', t.organization_id, t.id)
          OR (t.id = auth.uid() AND app.user_has_role_for_org('therapist', t.organization_id, t.id))
        )
    )
  );
