/*
  # Fix mutable search_path and unindexed foreign keys

  This migration addresses Supabase advisor warnings by:
  1. Setting immutable search_path on flagged public functions
  2. Adding covering indexes for reported unindexed foreign keys
*/

BEGIN;

-- Fix mutable search_path warnings (explicit function signatures).
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

-- Add missing foreign key indexes reported by advisors.
CREATE INDEX IF NOT EXISTS idx_authorization_services_created_by
  ON public.authorization_services (created_by);
CREATE INDEX IF NOT EXISTS idx_authorizations_created_by
  ON public.authorizations (created_by);

COMMIT;
