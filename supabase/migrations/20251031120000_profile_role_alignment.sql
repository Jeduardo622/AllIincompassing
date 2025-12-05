/*
  # Align profile roles with auth metadata for administrators

  1. Backfill
     - Ensure `roles` contains `admin` and `super_admin` entries.
     - Attach matching `user_roles` rows for users whose auth metadata declares
       `admin`/`super_admin`.
     - Synchronise `profiles.role` with the metadata-driven role.

  2. Guardrail
     - Add a trigger on `auth.users` to keep `user_roles` (and therefore
       `profiles.role`) aligned whenever metadata changes.
*/

BEGIN;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE profiles DISABLE TRIGGER block_role_change_non_admin';
  EXCEPTION
    WHEN undefined_object THEN
      RAISE NOTICE 'Trigger block_role_change_non_admin not found on profiles';
  END;
END;
$$;

SELECT set_config('app.bypass_profile_role_guard', 'on', true);

-- Ensure role catalog contains the high-privilege roles we need to sync.
INSERT INTO roles (name, description)
VALUES
  ('admin', 'Administrator role with full access'),
  ('super_admin', 'Super administrator role across organizations')
ON CONFLICT (name) DO NOTHING;

-- Capture auth metadata roles we care about.
WITH metadata_roles AS (
  SELECT
    u.id,
    LOWER(u.raw_user_meta_data ->> 'role') AS meta_role
  FROM auth.users AS u
  WHERE LOWER(u.raw_user_meta_data ->> 'role') IN ('admin', 'super_admin')
)
-- Attach missing user_roles links for the captured metadata roles.
INSERT INTO user_roles (user_id, role_id)
SELECT mr.id, r.id
FROM metadata_roles AS mr
JOIN roles AS r ON r.name = mr.meta_role
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Update profiles.role to reflect the metadata role immediately.
UPDATE profiles AS p
SET
  role = mr.meta_role::role_type,
  updated_at = NOW()
FROM (
  SELECT
    u.id,
    LOWER(u.raw_user_meta_data ->> 'role') AS meta_role
  FROM auth.users AS u
  WHERE LOWER(u.raw_user_meta_data ->> 'role') IN ('admin', 'super_admin')
) AS mr
WHERE p.id = mr.id
  AND p.role IS DISTINCT FROM mr.meta_role::role_type;

-- Guardrail: keep high-privilege roles aligned with auth metadata.
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
BEGIN
  -- Normalise the target role to the set we manage.
  IF v_meta_role IN ('admin', 'super_admin') THEN
    v_target_role := v_meta_role;
  ELSE
    v_target_role := NULL;
  END IF;

  -- Ensure catalog entries exist for the managed roles.
  INSERT INTO roles (name, description)
  VALUES
    ('admin', 'Administrator role with full access'),
    ('super_admin', 'Super administrator role across organizations')
  ON CONFLICT (name) DO NOTHING;

  IF v_target_role IS NULL THEN
    -- Metadata no longer marks the user as admin/super_admin. Remove any stale assignments.
    DELETE FROM user_roles
    WHERE user_id = NEW.id
      AND role_id IN (
        SELECT id FROM roles WHERE name IN ('admin', 'super_admin')
      );
    RETURN NEW;
  END IF;

  SELECT id INTO v_target_role_id
  FROM roles
  WHERE name = v_target_role;

  -- Drop conflicting high-privilege roles so only the metadata-indicated role persists.
  DELETE FROM user_roles
  WHERE user_id = NEW.id
    AND role_id IN (
      SELECT id FROM roles WHERE name IN ('admin', 'super_admin')
    )
    AND role_id <> v_target_role_id;

  -- Ensure the correct role mapping exists.
  INSERT INTO user_roles (user_id, role_id)
  VALUES (NEW.id, v_target_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Recreate the trigger to ensure consistent behaviour on auth metadata changes.
DROP TRIGGER IF EXISTS trg_sync_admin_roles_from_metadata ON auth.users;
CREATE TRIGGER trg_sync_admin_roles_from_metadata
AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION sync_admin_roles_from_auth_metadata();

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE profiles ENABLE TRIGGER block_role_change_non_admin';
  EXCEPTION
    WHEN undefined_object THEN
      RAISE NOTICE 'Trigger block_role_change_non_admin not found on profiles';
  END;
END;
$$;

SELECT set_config('app.bypass_profile_role_guard', 'off', true);

COMMIT;

