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

-- Canonical client_documents_org_* storage policies are created in 20260313160000_authz_storage_alignment.sql;
-- asserting them here breaks full replay (policies do not exist yet).

