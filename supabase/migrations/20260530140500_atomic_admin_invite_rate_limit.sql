-- @migration-intent: Move admin invite rate-limit enforcement into one DB-side critical section.
-- @migration-dependencies: 20251224120000_metadata_constraints_and_impersonation_queue.sql
-- @migration-rollback: Drop public.create_admin_invite_token_rate_limited and restore edge-side insert path if needed.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_admin_invite_token_rate_limited(
  p_email text,
  p_token_hash text,
  p_organization_id uuid,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_role public.role_type
)
RETURNS TABLE(id uuid, expires_at timestamptz, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
DECLARE
  v_normalized_email text;
  v_now timestamptz := timezone('utc', now());
  v_window_start timestamptz := v_now - interval '1 hour';
  v_invite_limit integer := 10;
  v_existing_id uuid;
  v_existing_expires_at timestamptz;
  v_recent_invite_count integer;
  v_inserted public.admin_invite_tokens%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_created_by THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  v_normalized_email := lower(trim(COALESCE(p_email, '')));
  IF v_normalized_email = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invite email is required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization ID is required';
  END IF;

  IF p_token_hash IS NULL OR length(trim(p_token_hash)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Token hash is required';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invite expiration must be in the future';
  END IF;

  IF p_role = 'super_admin'::public.role_type AND NOT app.current_user_is_super_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only super admins can create super admin invites';
  END IF;

  IF NOT app.current_user_is_super_admin() THEN
    IF NOT app.is_admin() THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Admin role required';
    END IF;

    IF app.current_user_organization_id() IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
    END IF;
  END IF;

  -- Serialize the full check/prune/count/insert sequence per inviter so bursts cannot share a stale count.
  PERFORM pg_advisory_xact_lock(hashtextextended('admin-invite:' || p_created_by::text, 0));

  SELECT t.id, t.expires_at
  INTO v_existing_id, v_existing_expires_at
  FROM public.admin_invite_tokens t
  WHERE t.email = v_normalized_email
    AND t.organization_id = p_organization_id
  ORDER BY t.created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL AND v_existing_expires_at > v_now THEN
    RETURN QUERY SELECT v_existing_id, v_existing_expires_at, 'active_invite_exists'::text;
    RETURN;
  END IF;

  DELETE FROM public.admin_invite_tokens t
  WHERE t.email = v_normalized_email
    AND t.organization_id = p_organization_id
    AND t.expires_at <= v_now;

  SELECT COUNT(*)::integer
  INTO v_recent_invite_count
  FROM public.admin_invite_tokens t
  WHERE t.created_by = p_created_by
    AND t.created_at >= v_window_start;

  IF COALESCE(v_recent_invite_count, 0) >= v_invite_limit THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, 'rate_limited'::text;
    RETURN;
  END IF;

  INSERT INTO public.admin_invite_tokens (
    email,
    token_hash,
    organization_id,
    expires_at,
    created_by,
    role
  )
  VALUES (
    v_normalized_email,
    p_token_hash,
    p_organization_id,
    p_expires_at,
    p_created_by,
    p_role
  )
  RETURNING *
  INTO v_inserted;

  RETURN QUERY SELECT v_inserted.id, v_inserted.expires_at, 'created'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type) TO authenticated;

COMMIT;
