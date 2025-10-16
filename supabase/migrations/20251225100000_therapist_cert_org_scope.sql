/*
  # Scope therapist certifications by organization

  1. Schema changes
    - Add organization_id column, default, and supporting index
  2. Data migration
    - Backfill organization_id from parent therapist metadata
  3. Security
    - Replace policies to enforce organization-aware access via app.user_has_role_for_org
*/

-- 1. Schema changes
ALTER TABLE public.therapist_certifications
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- 2. Data migration
WITH resolved_orgs AS (
  SELECT
    tc.id,
    COALESCE(
      tc.organization_id,
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    ) AS organization_id
  FROM public.therapist_certifications tc
  LEFT JOIN public.therapists t ON t.id = tc.therapist_id
  LEFT JOIN auth.users au ON au.id = tc.therapist_id
)
UPDATE public.therapist_certifications AS tc
SET organization_id = resolved_orgs.organization_id
FROM resolved_orgs
WHERE resolved_orgs.id = tc.id
  AND resolved_orgs.organization_id IS NOT NULL
  AND tc.organization_id IS DISTINCT FROM resolved_orgs.organization_id;

ALTER TABLE public.therapist_certifications
  ALTER COLUMN organization_id SET DEFAULT app.current_user_organization_id();

ALTER TABLE public.therapist_certifications
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_therapist_certifications_org_therapist
  ON public.therapist_certifications (organization_id, therapist_id);

-- Maintain organization_id based on therapist context
CREATE OR REPLACE FUNCTION app.set_therapist_certification_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid := NEW.organization_id;
BEGIN
  IF resolved_org IS NULL AND NEW.therapist_id IS NOT NULL THEN
    SELECT COALESCE(
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    )
    INTO resolved_org
    FROM public.therapists t
    LEFT JOIN auth.users au ON au.id = t.id
    WHERE t.id = NEW.therapist_id;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := app.current_user_organization_id();
  END IF;

  NEW.organization_id := resolved_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_therapist_certification_organization ON public.therapist_certifications;
CREATE TRIGGER set_therapist_certification_organization
  BEFORE INSERT OR UPDATE ON public.therapist_certifications
  FOR EACH ROW
  EXECUTE FUNCTION app.set_therapist_certification_organization();

-- 3. Security
DROP POLICY IF EXISTS "Therapist certifications are viewable by admin and assigned the" ON public.therapist_certifications;
DROP POLICY IF EXISTS "Therapist certifications can be deleted by admin and assigned t" ON public.therapist_certifications;
DROP POLICY IF EXISTS "Therapist certifications can be inserted by admin and assigned " ON public.therapist_certifications;
DROP POLICY IF EXISTS "Therapist certifications can be updated by admin and assigned t" ON public.therapist_certifications;

CREATE POLICY "Therapist certifications scoped access"
  ON public.therapist_certifications
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role_for_org('super_admin', organization_id, therapist_id) THEN true
      WHEN app.user_has_role_for_org('admin', organization_id, therapist_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, therapist_id) THEN therapist_id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('super_admin', organization_id, therapist_id) THEN true
      WHEN app.user_has_role_for_org('admin', organization_id, therapist_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, therapist_id) THEN therapist_id = auth.uid()
      ELSE false
    END
  );
