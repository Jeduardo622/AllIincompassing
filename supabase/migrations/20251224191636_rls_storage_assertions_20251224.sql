/*
  Storage sanity checks (Hosted DB migration version: 20251224191636)
*/

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

-- client_documents_org_* policies are created in 20260313160000; do not assert them here on replay.

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

