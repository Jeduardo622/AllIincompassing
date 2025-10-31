/*
  # Strengthen profile role alignment with auth metadata

  - Re-run the backfill to ensure existing admin/super_admin users have
    matching `profiles.role` values.
  - Demote profiles that still claim admin privileges when their auth metadata
    no longer does.
  - Extend the `sync_admin_roles_from_auth_metadata` trigger to keep
    `profiles.role` in sync on future metadata changes.
*/

BEGIN;

-- Normalise all admin/super_admin profiles to match the auth metadata role.
WITH metadata_roles AS (
  SELECT
    u.id,
    LOWER(u.raw_user_meta_data ->> 'role') AS meta_role
  FROM auth.users AS u
  WHERE LOWER(u.raw_user_meta_data ->> 'role') IN ('admin', 'super_admin')
)
UPDATE profiles AS p
SET
  role = mr.meta_role::role_type,
  updated_at = NOW()
FROM metadata_roles AS mr
WHERE p.id = mr.id
  AND p.role IS DISTINCT FROM mr.meta_role::role_type;

-- Demote any profiles that still claim admin privileges without metadata support.
WITH metadata_admins AS (
  SELECT
    u.id
  FROM auth.users AS u
  WHERE LOWER(u.raw_user_meta_data ->> 'role') IN ('admin', 'super_admin')
)
UPDATE profiles AS p
SET
  role = 'client'::role_type,
  updated_at = NOW()
WHERE p.role IN ('admin', 'super_admin')
  AND NOT EXISTS (
    SELECT 1 FROM metadata_admins AS ma WHERE ma.id = p.id
  );

-- Guardrail: keep `profiles.role` aligned with auth metadata going forward.
CREATE OR REPLACE FUNCTION sync_admin_roles_from_auth_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_meta_role TEXT := LOWER(COALESCE(NEW.raw_user_meta_data ->> 'role', ''));
  v_target_role TEXT;
  v_target_role_id UUID;
  v_default_role CONSTANT role_type := 'client';
BEGIN
  IF v_meta_role IN ('admin', 'super_admin') THEN
    v_target_role := v_meta_role;
  ELSE
    v_target_role := NULL;
  END IF;

  INSERT INTO roles (name, description)
  VALUES
    ('admin', 'Administrator role with full access'),
    ('super_admin', 'Super administrator role across organizations')
  ON CONFLICT (name) DO NOTHING;

  IF v_target_role IS NULL THEN
    DELETE FROM user_roles
    WHERE user_id = NEW.id
      AND role_id IN (
        SELECT id FROM roles WHERE name IN ('admin', 'super_admin')
      );

    UPDATE profiles
    SET
      role = v_default_role,
      updated_at = NOW()
    WHERE id = NEW.id
      AND role IS DISTINCT FROM v_default_role;

    RETURN NEW;
  END IF;

  SELECT id INTO v_target_role_id
  FROM roles
  WHERE name = v_target_role;

  DELETE FROM user_roles
  WHERE user_id = NEW.id
    AND role_id IN (
      SELECT id FROM roles WHERE name IN ('admin', 'super_admin')
    )
    AND role_id <> v_target_role_id;

  INSERT INTO user_roles (user_id, role_id)
  VALUES (NEW.id, v_target_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  UPDATE profiles
  SET
    role = v_target_role::role_type,
    updated_at = NOW()
  WHERE id = NEW.id
    AND role IS DISTINCT FROM v_target_role::role_type;

  RETURN NEW;
END;
$$;

COMMIT;


