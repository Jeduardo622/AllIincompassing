/*
  # Enforce organization scoping for admin management

  1. Changes
    - Require an explicit organization when assigning admin roles and persist it to auth metadata
    - Update manage_admin_users to enforce same-organization constraints and reuse the new assign helper
  2. Security
    - Prevent administrators without organization metadata from managing users in other organizations
    - Preserve service role access paths for automated maintenance routines
*/

DROP FUNCTION IF EXISTS assign_admin_role(TEXT);
DROP FUNCTION IF EXISTS public.assign_admin_role(TEXT);

CREATE OR REPLACE FUNCTION assign_admin_role(user_email TEXT, organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_request_role TEXT := current_setting('request.jwt.claim.role', true);
  v_is_service_role BOOLEAN := v_request_role = 'service_role';
  v_caller_id UUID := auth.uid();
  v_caller_org UUID;
  v_target_id UUID;
  v_target_metadata JSONB;
  v_target_org UUID;
  v_admin_role_id UUID;
BEGIN
  IF organization_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization ID is required';
  END IF;

  IF NOT v_is_service_role THEN
    IF v_caller_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_caller_id
        AND r.name = 'admin'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can assign admin role';
    END IF;

    SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
    INTO v_caller_org
    FROM auth.users u
    WHERE u.id = v_caller_id;

    IF v_caller_org IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization context is required';
    END IF;

    IF v_caller_org <> organization_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
    END IF;
  END IF;

  SELECT id, raw_user_meta_data
  INTO v_target_id, v_target_metadata
  FROM auth.users
  WHERE email = user_email;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = format('User with email %s not found', user_email);
  END IF;

  v_target_org := get_organization_id_from_metadata(v_target_metadata);

  IF v_target_org IS NOT NULL AND v_target_org <> organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Target user belongs to a different organization';
  END IF;

  v_target_metadata := COALESCE(v_target_metadata, '{}'::jsonb);
  v_target_metadata := jsonb_set(v_target_metadata, '{organization_id}', to_jsonb(organization_id::text), true);
  v_target_metadata := jsonb_set(v_target_metadata, '{organizationId}', to_jsonb(organization_id::text), true);
  v_target_metadata := jsonb_set(v_target_metadata, '{is_admin}', 'true'::jsonb, true);

  UPDATE auth.users
  SET raw_user_meta_data = v_target_metadata
  WHERE id = v_target_id;

  SELECT id INTO v_admin_role_id
  FROM roles
  WHERE name = 'admin';

  IF v_admin_role_id IS NULL THEN
    INSERT INTO roles (name, description)
    VALUES ('admin', 'Administrator role with full access')
    RETURNING id INTO v_admin_role_id;
  END IF;

  INSERT INTO user_roles (user_id, role_id)
  VALUES (v_target_id, v_admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION assign_admin_role(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION manage_admin_users(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION manage_admin_users(
  operation TEXT,
  target_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_request_role TEXT := current_setting('request.jwt.claim.role', true);
  v_is_service_role BOOLEAN := v_request_role = 'service_role';
  v_admin_role_id UUID;
  v_caller_id UUID := auth.uid();
  v_caller_org UUID;
  v_target_id UUID;
  v_target_email TEXT;
  v_target_metadata JSONB;
  v_target_org UUID;
  v_admin_count INTEGER;
  v_effective_org UUID;
BEGIN
  SELECT id INTO v_admin_role_id
  FROM roles
  WHERE name = 'admin';

  IF NOT v_is_service_role THEN
    IF v_caller_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_caller_id
        AND r.name = 'admin'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can manage admin users';
    END IF;

    SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
    INTO v_caller_org
    FROM auth.users u
    WHERE u.id = v_caller_id;

    IF v_caller_org IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization context is required';
    END IF;
  END IF;

  BEGIN
    v_target_id := target_user_id::uuid;
  EXCEPTION
    WHEN others THEN
      SELECT id
      INTO v_target_id
      FROM auth.users
      WHERE email = target_user_id;

      IF v_target_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = format('User with ID/email %s not found', target_user_id);
      END IF;
  END;

  SELECT email, raw_user_meta_data
  INTO v_target_email, v_target_metadata
  FROM auth.users
  WHERE id = v_target_id;

  IF v_target_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = format('User with ID/email %s not found', target_user_id);
  END IF;

  v_target_org := get_organization_id_from_metadata(v_target_metadata);

  IF NOT v_is_service_role THEN
    IF v_target_org IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Target user organization metadata is required';
    END IF;

    IF v_caller_org <> v_target_org THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Target user does not belong to the caller organization';
    END IF;
  END IF;

  IF v_admin_role_id IS NULL THEN
    INSERT INTO roles (name, description)
    VALUES ('admin', 'Administrator role with full access')
    RETURNING id INTO v_admin_role_id;
  END IF;

  CASE operation
    WHEN 'add' THEN
      IF COALESCE(v_target_org, v_caller_org) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context is required to add an admin';
      END IF;

      v_effective_org := COALESCE(v_target_org, v_caller_org);

      PERFORM assign_admin_role(v_target_email, v_effective_org);

      BEGIN
        INSERT INTO admin_actions (
          admin_user_id,
          target_user_id,
          organization_id,
          action_type,
          action_details
        )
        VALUES (
          v_caller_id,
          v_target_id,
          v_effective_org,
          'admin_role_added',
          jsonb_build_object(
            'operation', 'add',
            'target_email', v_target_email,
            'service_role', v_is_service_role
          )
        );
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING 'Failed to log admin add action: %', SQLERRM;
      END;

    WHEN 'remove' THEN
      IF NOT v_is_service_role THEN
        SELECT COUNT(*)
        INTO v_admin_count
        FROM user_roles ur
        JOIN auth.users au ON au.id = ur.user_id
        WHERE ur.role_id = v_admin_role_id
          AND get_organization_id_from_metadata(au.raw_user_meta_data) = v_caller_org;

        IF v_admin_count <= 1 AND v_target_id = v_caller_id THEN
          RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cannot remove the last administrator for the organization';
        END IF;
      END IF;

      DELETE FROM user_roles
      WHERE user_id = v_target_id
        AND role_id = v_admin_role_id;

      UPDATE auth.users
      SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) - 'is_admin'
      WHERE id = v_target_id;

      v_effective_org := COALESCE(v_target_org, v_caller_org);

      BEGIN
        INSERT INTO admin_actions (
          admin_user_id,
          target_user_id,
          organization_id,
          action_type,
          action_details
        )
        VALUES (
          v_caller_id,
          v_target_id,
          v_effective_org,
          'admin_role_removed',
          jsonb_build_object(
            'operation', 'remove',
            'target_email', v_target_email,
            'service_role', v_is_service_role
          )
        );
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING 'Failed to log admin remove action: %', SQLERRM;
      END;

    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('Invalid operation: %s', operation);
  END CASE;
END;
$$;
