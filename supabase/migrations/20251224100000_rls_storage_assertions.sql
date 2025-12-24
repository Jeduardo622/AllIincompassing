-- Additional sanity checks for storage and policy coverage.

-- Ensure storage.objects RLS is enabled (idempotent check).
DO $$
DECLARE
  rls_enabled boolean;
BEGIN
  SELECT c.relrowsecurity
  INTO rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects';

  IF rls_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'RLS not enabled on storage.objects';
  END IF;
END$$;

-- Assert client-documents policies exist for all verbs.
DO $$
DECLARE
  missing_policies text[];
BEGIN
  SELECT array_agg(policyname)
  INTO missing_policies
  FROM (
    VALUES
      ('client_documents_org_read'),
      ('client_documents_org_insert'),
      ('client_documents_org_update'),
      ('client_documents_org_delete')
  ) AS p(policyname)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = p.policyname
  );

  IF missing_policies IS NOT NULL THEN
    RAISE EXCEPTION 'Missing storage.objects policies: %', missing_policies;
  END IF;
END$$;

-- Ensure helper functions exist.
DO $$
BEGIN
  PERFORM 1 FROM pg_proc WHERE proname = 'current_org_id' AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Function public.current_org_id is missing';
  END IF;

  PERFORM 1 FROM pg_proc WHERE proname = 'has_care_role' AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Function public.has_care_role is missing';
  END IF;
END$$;

