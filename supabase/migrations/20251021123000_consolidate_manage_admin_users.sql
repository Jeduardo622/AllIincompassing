/*
  # Consolidate manage_admin_users and enforce same-organization admin control

  - Drops legacy overloads
  - Creates single strict variant requiring admin and same-organization
  - Logs actions into admin_actions
  - Limits EXECUTE to app-admin executor roles (not generic authenticated)
*/

set search_path = public;

-- Drop legacy overloads if present
DROP FUNCTION IF EXISTS public.manage_admin_users(text, uuid);
DROP FUNCTION IF EXISTS public.manage_admin_users(text, text);
DROP FUNCTION IF EXISTS public.manage_admin_users(text, text, jsonb);
DROP FUNCTION IF EXISTS public.manage_admin_users(text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.manage_admin_users(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.manage_admin_users(text, uuid, uuid);

-- Create strict variant with explicit caller organization
CREATE OR REPLACE FUNCTION public.manage_admin_users(
  operation text,
  target_user_id text,
  caller_organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  admin_role_id uuid;
  current_user_id uuid;
  current_user_org uuid;
  target_id uuid;
  target_org uuid;
  admin_count int;
  target_email text;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF caller_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization context required';
  END IF;

  SELECT id INTO admin_role_id FROM public.roles WHERE name = 'admin';
  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Missing admin role';
  END IF;

  -- Must be admin
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only administrators can manage admin users';
  END IF;

  -- Resolve caller org
  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO current_user_org
  FROM auth.users u WHERE u.id = current_user_id;

  IF current_user_org IS NULL OR current_user_org <> caller_organization_id THEN
    RAISE EXCEPTION 'Caller organization mismatch';
  END IF;

  -- Resolve target id (email or uuid)
  BEGIN
    target_id := target_user_id::uuid;
    target_email := (SELECT email FROM auth.users WHERE id = target_id);
  EXCEPTION WHEN OTHERS THEN
    target_id := NULL;
    target_email := NULL;
  END;

  IF target_id IS NULL THEN
    SELECT id, email INTO target_id, target_email
    FROM auth.users WHERE email = target_user_id;
  END IF;

  IF target_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found: %', target_user_id;
  END IF;

  -- Resolve target org
  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO target_org
  FROM auth.users u WHERE u.id = target_id;

  IF target_org IS NULL OR target_org <> caller_organization_id THEN
    RAISE EXCEPTION 'Target user does not belong to the caller organization';
  END IF;

  CASE operation
    WHEN 'add' THEN
      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (target_id, admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;

      UPDATE auth.users
      SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
      WHERE id = target_id;

      BEGIN
        INSERT INTO public.admin_actions (admin_user_id, target_user_id, organization_id, action_type, action_details)
        VALUES (current_user_id, target_id, caller_organization_id, 'admin_role_added', jsonb_build_object('target_email', target_email));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to log admin add action: %', SQLERRM;
      END;

    WHEN 'remove' THEN
      -- Prevent removing last admin in org
      SELECT COUNT(*) INTO admin_count
      FROM public.user_roles ur
      JOIN auth.users au ON au.id = ur.user_id
      WHERE ur.role_id = admin_role_id
        AND get_organization_id_from_metadata(au.raw_user_meta_data) = caller_organization_id;

      IF admin_count <= 1 AND target_id = current_user_id THEN
        RAISE EXCEPTION 'Cannot remove the last administrator';
      END IF;

      DELETE FROM public.user_roles WHERE user_id = target_id AND role_id = admin_role_id;

      UPDATE auth.users
      SET raw_user_meta_data = raw_user_meta_data - 'is_admin'
      WHERE id = target_id;

      BEGIN
        INSERT INTO public.admin_actions (admin_user_id, target_user_id, organization_id, action_type, action_details)
        VALUES (current_user_id, target_id, caller_organization_id, 'admin_role_removed', jsonb_build_object('target_email', target_email));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to log admin remove action: %', SQLERRM;
      END;

    ELSE
      RAISE EXCEPTION 'Invalid operation: %', operation;
  END CASE;
END;
$$;

-- Lock down grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'manage_admin_users' AND oidvectortypes(proargtypes) = 'text, text, uuid') THEN
    REVOKE EXECUTE ON FUNCTION public.manage_admin_users(text, text, uuid) FROM public;
    REVOKE EXECUTE ON FUNCTION public.manage_admin_users(text, text, uuid) FROM authenticated;
  END IF;
END $$;

-- Ensure an executor role exists and grant
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin_executor') THEN
    CREATE ROLE app_admin_executor NOLOGIN;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.manage_admin_users(text, text, uuid) TO app_admin_executor;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.roleid
    JOIN pg_roles gr ON gr.oid = m.member
    WHERE r.rolname = 'app_admin_executor'
      AND gr.rolname = 'service_role'
  ) THEN
    GRANT app_admin_executor TO service_role;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'Grant app_admin_executor -> service_role requires admin option';
END $$;
