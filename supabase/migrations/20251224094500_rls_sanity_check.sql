-- Safety assertions: ensure critical tables and storage bucket are RLS-enabled.

DO $$
DECLARE
  missing_tables text[];
BEGIN
  SELECT array_agg(tablename)
  INTO missing_tables
  FROM (
    VALUES
      ('clients'),
      ('authorizations'),
      ('authorization_services'),
      ('client_session_notes'),
      ('client_notes'),
      ('client_issues')
  ) AS t(tablename)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_tables pt
    WHERE pt.schemaname = 'public'
      AND pt.tablename = t.tablename
      AND EXISTS (
        SELECT 1
        FROM pg_class c
        WHERE c.oid = format('public.%I', t.tablename)::regclass
          AND c.relrowsecurity = true
      )
  );

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled on: %', missing_tables;
  END IF;
END$$;

-- Assert client-documents bucket policies exist (read policy name check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'client_documents_org_read'
  ) THEN
    RAISE EXCEPTION 'client_documents_org_read policy missing on storage.objects';
  END IF;
END$$;

