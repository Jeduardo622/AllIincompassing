-- @migration-intent: Canonicalize public signup metadata so BT self-signup resolves to the bt role while guardian signup remains client-only and privileged or unknown metadata remains untrusted.
-- @migration-dependencies: 20251116093000_signup_role_alignment.sql, 20251116094500_signup_role_trigger_fix.sql, 20260701150000_employee_role_capability_matrix.sql
-- @migration-rollback: Forward recovery only. Apply a later migration restoring the prior app.resolve_signup_role(jsonb) mapping if signup-role semantics must be changed again.

BEGIN;

CREATE OR REPLACE FUNCTION app.resolve_signup_role(p_metadata jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_role text := lower(btrim(COALESCE(v_metadata->>'role', v_metadata->>'signup_role', '')));
  v_guardian_raw text := lower(btrim(COALESCE(v_metadata->>'guardian_signup', '')));
  v_guardian boolean := v_guardian_raw IN ('true', 't', '1', 'yes', 'on');
BEGIN
  IF v_guardian OR v_role = 'guardian' THEN
    RETURN 'client';
  END IF;

  IF v_role = '' THEN
    RETURN NULL;
  END IF;

  IF v_role = 'client' THEN
    RETURN 'client';
  END IF;

  IF v_role IN ('bt', 'therapist') THEN
    RETURN 'bt';
  END IF;

  RETURN NULL;
END;
$$;

COMMIT;
