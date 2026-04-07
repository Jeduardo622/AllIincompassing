-- Security & performance hardening (phase 1)
-- - Fix mutable function search_path
-- - Move btree_gist extension out of public
-- - Add PK to public.session_cpt_modifiers
-- - Add covering indexes for common foreign keys

set search_path = public;

-- Ensure a dedicated schema for extensions
CREATE SCHEMA IF NOT EXISTS extensions;

-- Move extension from public → extensions per security guidance
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER EXTENSION btree_gist SET SCHEMA extensions';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privileges to alter extension schema';
  END;
END $$;

-- Harden function search_path to avoid role-dependent resolution (functions may be absent on replay)
DO $$ BEGIN
  IF to_regprocedure('public.block_role_change_non_admin()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.block_role_change_non_admin() SET search_path = pg_catalog, public';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regprocedure('public.is_admin()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.is_admin() SET search_path = pg_catalog, public';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regprocedure('public.enqueue_impersonation_revocation(uuid, text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.enqueue_impersonation_revocation(uuid, text) SET search_path = pg_catalog, public';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regprocedure('public.enqueue_impersonation_revocation(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.enqueue_impersonation_revocation(uuid, uuid) SET search_path = pg_catalog, public';
  END IF;
END $$;

-- Add surrogate primary key to table lacking a PK
ALTER TABLE public.session_cpt_modifiers
  ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.session_cpt_modifiers'::regclass
      AND contype = 'p'
  ) THEN
    EXECUTE 'ALTER TABLE public.session_cpt_modifiers ADD CONSTRAINT session_cpt_modifiers_pkey PRIMARY KEY (id)';
  END IF;
END $$;

-- Covering indexes for foreign keys flagged by advisors (tables may not exist yet on replay)
DO $$
BEGIN
  IF to_regclass('public.admin_invite_tokens') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_admin_invite_tokens_created_by ON public.admin_invite_tokens (created_by)';
  END IF;
  IF to_regclass('public.client_guardians') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_client_guardians_created_by ON public.client_guardians (created_by)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_client_guardians_updated_by ON public.client_guardians (updated_by)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_client_guardians_deleted_by ON public.client_guardians (deleted_by)';
  END IF;
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clients_created_by ON public.clients (created_by)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clients_updated_by ON public.clients (updated_by)';
    -- deleted_by is added in a later migration (soft delete); skip if not replayed yet
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'deleted_by'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clients_deleted_by ON public.clients (deleted_by)';
    END IF;
  END IF;
  IF to_regclass('public.impersonation_revocation_queue') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_impersonation_revocation_queue_audit_id ON public.impersonation_revocation_queue (audit_id)';
  END IF;
  IF to_regclass('public.organization_feature_flags') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_organization_feature_flags_created_by ON public.organization_feature_flags (created_by)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_organization_feature_flags_updated_by ON public.organization_feature_flags (updated_by)';
  END IF;
  IF to_regclass('public.organizations') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_organizations_created_by ON public.organizations (created_by)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_organizations_updated_by ON public.organizations (updated_by)';
  END IF;
  IF to_regclass('public.session_cpt_entries') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_session_cpt_entries_cpt_code_id ON public.session_cpt_entries (cpt_code_id)';
  END IF;
  IF to_regclass('public.session_holds') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_session_holds_session_id ON public.session_holds (session_id)';
  END IF;
  IF to_regclass('public.therapists') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'therapists' AND column_name = 'deleted_by'
    ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_therapists_deleted_by ON public.therapists (deleted_by)';
  END IF;
END $$;

-- NOTE:
-- RLS policy optimizations (wrapping auth.* calls with SELECT to avoid initplan per-row
-- re-evaluation) will be handled in a follow-up targeted migration to preserve semantics.


