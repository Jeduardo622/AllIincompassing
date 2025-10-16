/*
  # Scope therapist availability by organization

  1. Schema changes
    - Add organization_id to therapist_availability for tenant-aware filtering.
    - Create composite index to accelerate org-bound lookups by therapist and day.
  2. Data backfill
    - Populate organization_id from the parent therapist records.
  3. Automation & security
    - Ensure writes inherit organization_id automatically.
    - Align RLS policies with app.user_has_role_for_org helpers.
*/

-- 1. Schema changes
ALTER TABLE public.therapist_availability
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- 2. Data backfill
UPDATE public.therapist_availability ta
SET organization_id = t.organization_id
FROM public.therapists t
WHERE t.id = ta.therapist_id
  AND t.organization_id IS NOT NULL
  AND ta.organization_id IS DISTINCT FROM t.organization_id;

-- 3. Indexing for organization-aware queries
CREATE INDEX IF NOT EXISTS therapist_availability_org_therapist_day_idx
  ON public.therapist_availability (organization_id, therapist_id, day_of_week);

-- 4. Maintain organization_id on write operations
CREATE OR REPLACE FUNCTION app.set_therapist_availability_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.therapist_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.organization_id IS NULL THEN
    SELECT t.organization_id
    INTO NEW.organization_id
    FROM public.therapists t
    WHERE t.id = NEW.therapist_id;
  END IF;

  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := app.current_user_organization_id();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_therapist_availability_organization ON public.therapist_availability;
CREATE TRIGGER set_therapist_availability_organization
  BEFORE INSERT OR UPDATE ON public.therapist_availability
  FOR EACH ROW
  EXECUTE FUNCTION app.set_therapist_availability_organization();

-- 5. RLS alignment
DROP POLICY IF EXISTS "Therapists can view availability" ON public.therapist_availability;
DROP POLICY IF EXISTS "Therapists can manage their own availability" ON public.therapist_availability;

CREATE POLICY "Therapist availability scoped access"
  ON public.therapist_availability
  FOR SELECT
  TO authenticated
  USING (
    therapist_id = auth.uid()
    OR app.user_has_role_for_org('admin', organization_id, therapist_id)
    OR app.user_has_role_for_org('super_admin', organization_id, therapist_id)
  );

CREATE POLICY "Therapist availability managed in organization"
  ON public.therapist_availability
  FOR ALL
  TO authenticated
  USING (
    therapist_id = auth.uid()
    OR app.user_has_role_for_org('admin', organization_id, therapist_id)
    OR app.user_has_role_for_org('super_admin', organization_id, therapist_id)
  )
  WITH CHECK (
    therapist_id = auth.uid()
    OR app.user_has_role_for_org('admin', organization_id, therapist_id)
    OR app.user_has_role_for_org('super_admin', organization_id, therapist_id)
  );
