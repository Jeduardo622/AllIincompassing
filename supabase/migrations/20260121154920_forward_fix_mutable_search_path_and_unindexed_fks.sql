/*
  @migration-intent: Re-version corrective mutable search_path and FK index hardening to resolve local duplicate timestamp collisions.
  @migration-dependencies: 20260202120000_scheduling_orchestration_runs.sql
  @migration-rollback: Drop idx_authorization_services_created_by and idx_authorizations_created_by if rollback is required.
*/

BEGIN;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER FUNCTION public.update_authorization_documents(uuid, jsonb) SET search_path = public';
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER FUNCTION public.current_org_id() SET search_path = public';
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER FUNCTION public.create_authorization_with_services(uuid, uuid, text, text, text, date, date, text, uuid, text, text, jsonb) SET search_path = public';
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER FUNCTION public.has_care_role() SET search_path = public';
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER FUNCTION public.update_authorization_with_services(uuid, text, uuid, uuid, text, text, date, date, text, uuid, text, text, jsonb) SET search_path = public';
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;
END
$$;

CREATE INDEX IF NOT EXISTS idx_authorization_services_created_by
  ON public.authorization_services (created_by);
CREATE INDEX IF NOT EXISTS idx_authorizations_created_by
  ON public.authorizations (created_by);

COMMIT;
