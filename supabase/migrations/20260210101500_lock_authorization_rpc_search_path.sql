/*
  # Lock search_path for authorization RPCs

  Supabase advisors currently flag these two functions as mutable search_path.
  This migration hardens both RPCs by setting an explicit, immutable search_path.
*/

BEGIN;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_authorization_with_services',
        'update_authorization_with_services'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
  END LOOP;
END
$$;

COMMIT;
