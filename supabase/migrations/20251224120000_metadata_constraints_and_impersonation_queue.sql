/*
  # Metadata validation, impersonation revocation queue, and admin action retention

  1. JSONB validation helpers
    - validate_organization_metadata(jsonb): structural checks for organizations.metadata
    - validate_feature_flag_metadata(jsonb): basic object check for feature_flags.metadata

  2. Constraints (NOT VALID for backward compatibility)
    - organizations.metadata CHECK validate_organization_metadata
    - feature_flags.metadata CHECK validate_feature_flag_metadata

  3. Impersonation revocation queue
    - Table public.impersonation_revocation_queue
    - Helper function enqueue_impersonation_revocation(audit_id, token_jti)
    - RLS allowing super admins to insert, service role manage

  4. Admin action retention
    - Function prune_admin_actions(retention_days integer DEFAULT 365)
*/

set search_path = public;

-- 1) JSONB validation helpers
CREATE OR REPLACE FUNCTION public.validate_organization_metadata(obj jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  k text;
  allowed_top text[] := ARRAY['billing','seats','rollout','tags','notes'];
  tags_count int;
  licensed int;
  active int;
BEGIN
  -- null treated as valid (column has DEFAULT '{}')
  IF obj IS NULL THEN
    RETURN true;
  END IF;

  -- must be a JSON object
  IF jsonb_typeof(obj) <> 'object' THEN
    RETURN false;
  END IF;

  -- only allow known top-level keys
  FOR k IN SELECT key FROM jsonb_each(obj) LOOP
    IF NOT (k = ANY (allowed_top)) THEN
      RETURN false;
    END IF;
  END LOOP;

  -- billing may be object or null
  IF obj ? 'billing' THEN
    IF obj->'billing' IS NULL THEN
      -- ok
    ELSIF jsonb_typeof(obj->'billing') <> 'object' THEN
      RETURN false;
    END IF;
  END IF;

  -- seats may be object; if both present enforce active <= licensed
  IF obj ? 'seats' THEN
    IF obj->'seats' IS NULL THEN
      -- ok
    ELSIF jsonb_typeof(obj->'seats') <> 'object' THEN
      RETURN false;
    ELSE
      BEGIN
        licensed := NULLIF((obj->'seats'->>'licensed'), '')::int;
      EXCEPTION WHEN others THEN licensed := NULL; END;
      BEGIN
        active := NULLIF((obj->'seats'->>'active'), '')::int;
      EXCEPTION WHEN others THEN active := NULL; END;

      IF licensed IS NOT NULL AND active IS NOT NULL AND active > licensed THEN
        RETURN false;
      END IF;
    END IF;
  END IF;

  -- rollout may be object
  IF obj ? 'rollout' THEN
    IF obj->'rollout' IS NULL THEN
      -- ok
    ELSIF jsonb_typeof(obj->'rollout') <> 'object' THEN
      RETURN false;
    END IF;
  END IF;

  -- tags must be array of strings length <= 10 if present
  IF obj ? 'tags' THEN
    IF obj->'tags' IS NULL THEN
      -- ok
    ELSIF jsonb_typeof(obj->'tags') <> 'array' THEN
      RETURN false;
    ELSE
      tags_count := jsonb_array_length(obj->'tags');
      IF tags_count > 10 THEN
        RETURN false;
      END IF;
      -- ensure all elements are strings of reasonable size
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(obj->'tags') AS e(elem)
        WHERE jsonb_typeof(elem) <> 'string' OR char_length(elem::text) > 52 -- includes quotes
      ) THEN
        RETURN false;
      END IF;
    END IF;
  END IF;

  -- notes must be string length <= 1000 if present
  IF obj ? 'notes' THEN
    IF obj->'notes' IS NULL THEN
      -- ok
    ELSIF jsonb_typeof(obj->'notes') <> 'string' THEN
      RETURN false;
    ELSE
      IF char_length(obj->>'notes') > 1000 THEN
        RETURN false;
      END IF;
    END IF;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_feature_flag_metadata(obj jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  IF obj IS NULL THEN
    RETURN true;
  END IF;
  RETURN jsonb_typeof(obj) = 'object';
END;
$$;

-- 2) Constraints (NOT VALID for existing rows)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_metadata_valid'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_metadata_valid CHECK (public.validate_organization_metadata(metadata)) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feature_flags_metadata_valid'
  ) THEN
    ALTER TABLE public.feature_flags
      ADD CONSTRAINT feature_flags_metadata_valid CHECK (public.validate_feature_flag_metadata(metadata)) NOT VALID;
  END IF;
END $$;

-- 3) Impersonation revocation queue
CREATE TABLE IF NOT EXISTS public.impersonation_revocation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.impersonation_audit(id) ON DELETE CASCADE,
  token_jti uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  processed_at timestamptz,
  error text,
  UNIQUE (token_jti)
);

ALTER TABLE public.impersonation_revocation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impersonation_revocation_queue_service_role ON public.impersonation_revocation_queue;
DROP POLICY IF EXISTS impersonation_revocation_queue_super_admin_insert ON public.impersonation_revocation_queue;

-- service role manages everything
CREATE POLICY impersonation_revocation_queue_service_role
  ON public.impersonation_revocation_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- super admins can insert into queue
CREATE POLICY impersonation_revocation_queue_super_admin_insert
  ON public.impersonation_revocation_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (app.current_user_is_super_admin());

CREATE OR REPLACE FUNCTION public.enqueue_impersonation_revocation(p_audit_id uuid, p_token_jti uuid)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.impersonation_revocation_queue (audit_id, token_jti)
  VALUES (p_audit_id, p_token_jti)
  ON CONFLICT (token_jti) DO NOTHING;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_impersonation_revocation(uuid, uuid) TO authenticated;

-- 4) Admin action retention
CREATE OR REPLACE FUNCTION public.prune_admin_actions(retention_days integer DEFAULT 365)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := timezone('utc', now()) - make_interval(days => retention_days);
  v_deleted integer;
BEGIN
  DELETE FROM public.admin_actions a
  WHERE a.created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN COALESCE(v_deleted, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_admin_actions(integer) TO authenticated;



-- Admin hardening: admin_invite_tokens
DO $$ BEGIN
  IF to_regclass('public.admin_invite_tokens') IS NULL THEN
    CREATE TABLE public.admin_invite_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      organization_id uuid NOT NULL,
      role role_type NOT NULL DEFAULT 'admin',
      expires_at timestamptz NOT NULL,
      created_by uuid NOT NULL REFERENCES auth.users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS admin_invite_tokens_org_idx ON public.admin_invite_tokens(organization_id);
CREATE INDEX IF NOT EXISTS admin_invite_tokens_expires_idx ON public.admin_invite_tokens(expires_at);

ALTER TABLE public.admin_invite_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_invite_tokens' AND policyname='admin_invite_tokens_insert'
  ) THEN
    CREATE POLICY admin_invite_tokens_insert ON public.admin_invite_tokens FOR INSERT TO authenticated
      WITH CHECK (app.is_admin() AND organization_id = app.current_user_organization_id());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_invite_tokens' AND policyname='admin_invite_tokens_select'
  ) THEN
    CREATE POLICY admin_invite_tokens_select ON public.admin_invite_tokens FOR SELECT TO authenticated
      USING (app.is_admin() AND organization_id = app.current_user_organization_id());
  END IF;
END $$;

-- Admin hardening: admin_actions add organization_id and lock down to insert/select
ALTER TABLE public.admin_actions ADD COLUMN IF NOT EXISTS organization_id uuid;
CREATE INDEX IF NOT EXISTS admin_actions_org_idx ON public.admin_actions(organization_id);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_actions' AND policyname='admin_all_admin_actions'
  ) THEN
    DROP POLICY admin_all_admin_actions ON public.admin_actions;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_actions' AND policyname='admin_actions_insert_only'
  ) THEN
    CREATE POLICY admin_actions_insert_only ON public.admin_actions FOR INSERT TO authenticated
      WITH CHECK (app.is_admin() AND organization_id = app.current_user_organization_id());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_actions' AND policyname='admin_actions_select_scoped'
  ) THEN
    CREATE POLICY admin_actions_select_scoped ON public.admin_actions FOR SELECT TO authenticated
      USING (app.is_admin() AND organization_id = app.current_user_organization_id());
  END IF;
END $$;

-- Admin hardening: tighten billing_records RLS
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='billing_records' AND policyname='Billing records are viewable by authenticated users'
  ) THEN
    DROP POLICY "Billing records are viewable by authenticated users" ON public.billing_records;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='billing_records' AND policyname='billing_records_select_scoped'
  ) THEN
    CREATE POLICY billing_records_select_scoped ON public.billing_records FOR SELECT TO authenticated
      USING (
        (app.is_admin() AND organization_id = app.current_user_organization_id())
        OR app.can_access_session(session_id)
      );
  END IF;
END $$;

-- Normalize helper functions to single namespace
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, app_auth
AS $$
  SELECT app.is_admin();
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, app_auth
AS $$
  SELECT COALESCE(app.current_user_is_super_admin(), false);
$$;

-- Admin users pagination and counting
CREATE OR REPLACE FUNCTION public.count_admin_users(organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid;
  caller_org_id uuid;
  total_count integer;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;
  IF organization_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization ID is required';
  END IF;
  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org_id
  FROM auth.users AS u
  WHERE u.id = current_user_id;
  IF caller_org_id IS NULL OR caller_org_id <> organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can view admin users';
  END IF;
  SELECT COUNT(*) INTO total_count
  FROM admin_users au
  WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = organization_id;
  RETURN COALESCE(total_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_admin_users(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_users_paged(
  organization_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS SETOF admin_users
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid;
  caller_org_id uuid;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;
  IF organization_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization ID is required';
  END IF;
  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org_id
  FROM auth.users AS u
  WHERE u.id = current_user_id;
  IF caller_org_id IS NULL OR caller_org_id <> organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can view admin users';
  END IF;
  RETURN QUERY
  SELECT au.*
  FROM admin_users au
  WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = organization_id
  ORDER BY au.created_at DESC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_users_paged(uuid, integer, integer) TO authenticated;

-- Retention for expired admin invites
CREATE OR REPLACE FUNCTION public.prune_admin_invite_tokens()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.admin_invite_tokens t
  WHERE t.expires_at < timezone('utc', now());
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN COALESCE(v_deleted, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_admin_invite_tokens() TO authenticated;