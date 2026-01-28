set search_path = public;

/*
  Create service contracts + rates with org-scoped RLS.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  insurance_provider_id uuid REFERENCES public.insurance_providers(id) ON DELETE SET NULL,
  payer_name text NOT NULL,
  effective_date date NOT NULL,
  termination_date date,
  reimbursement_method text NOT NULL DEFAULT 'ACH',
  file_url text,
  confidence_score numeric(4, 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT service_contracts_reimbursement_method_check
    CHECK (reimbursement_method IN ('ACH', 'Check')),
  CONSTRAINT service_contracts_confidence_score_check
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'service_contracts_id_org_unique'
      AND conrelid = 'public.service_contracts'::regclass
  ) THEN
    ALTER TABLE public.service_contracts
      ADD CONSTRAINT service_contracts_id_org_unique UNIQUE (id, organization_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS service_contracts_org_idx
  ON public.service_contracts (organization_id);
CREATE INDEX IF NOT EXISTS service_contracts_client_idx
  ON public.service_contracts (client_id);
CREATE INDEX IF NOT EXISTS service_contracts_provider_idx
  ON public.service_contracts (insurance_provider_id);
CREATE INDEX IF NOT EXISTS service_contracts_effective_date_idx
  ON public.service_contracts (effective_date DESC);

DROP TRIGGER IF EXISTS service_contracts_set_updated_at ON public.service_contracts;
CREATE TRIGGER service_contracts_set_updated_at
  BEFORE UPDATE ON public.service_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.service_contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  file_url text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'service_contract_versions_contract_fk'
      AND conrelid = 'public.service_contract_versions'::regclass
  ) THEN
    ALTER TABLE public.service_contract_versions
      ADD CONSTRAINT service_contract_versions_contract_fk
      FOREIGN KEY (contract_id, organization_id)
      REFERENCES public.service_contracts(id, organization_id)
      ON DELETE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS service_contract_versions_contract_idx
  ON public.service_contract_versions (contract_id);
CREATE INDEX IF NOT EXISTS service_contract_versions_org_idx
  ON public.service_contract_versions (organization_id);

CREATE TABLE IF NOT EXISTS public.service_contract_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cpt_code_id uuid NOT NULL REFERENCES public.cpt_codes(id) ON DELETE RESTRICT,
  rate numeric(10, 2) NOT NULL CHECK (rate >= 0),
  modifiers text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_contract_rates_unique UNIQUE (contract_id, cpt_code_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'service_contract_rates_contract_fk'
      AND conrelid = 'public.service_contract_rates'::regclass
  ) THEN
    ALTER TABLE public.service_contract_rates
      ADD CONSTRAINT service_contract_rates_contract_fk
      FOREIGN KEY (contract_id, organization_id)
      REFERENCES public.service_contracts(id, organization_id)
      ON DELETE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS service_contract_rates_contract_idx
  ON public.service_contract_rates (contract_id);
CREATE INDEX IF NOT EXISTS service_contract_rates_org_idx
  ON public.service_contract_rates (organization_id);
CREATE INDEX IF NOT EXISTS service_contract_rates_cpt_idx
  ON public.service_contract_rates (cpt_code_id);

DROP TRIGGER IF EXISTS service_contract_rates_set_updated_at ON public.service_contract_rates;
CREATE TRIGGER service_contract_rates_set_updated_at
  BEFORE UPDATE ON public.service_contract_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.service_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_contract_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_contracts_service_role_manage ON public.service_contracts;
DROP POLICY IF EXISTS service_contracts_admin_manage ON public.service_contracts;
DROP POLICY IF EXISTS service_contracts_therapist_read ON public.service_contracts;

CREATE POLICY service_contracts_service_role_manage
  ON public.service_contracts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY service_contracts_admin_manage
  ON public.service_contracts
  FOR ALL
  TO authenticated
  USING (
    app.user_has_role_for_org('admin', organization_id)
    OR app.user_has_role_for_org('super_admin', organization_id)
  )
  WITH CHECK (
    app.user_has_role_for_org('admin', organization_id)
    OR app.user_has_role_for_org('super_admin', organization_id)
  );

CREATE POLICY service_contracts_therapist_read
  ON public.service_contracts
  FOR SELECT
  TO authenticated
  USING (
    app.user_has_role_for_org('therapist', organization_id)
  );

DROP POLICY IF EXISTS service_contract_versions_service_role_manage ON public.service_contract_versions;
DROP POLICY IF EXISTS service_contract_versions_admin_manage ON public.service_contract_versions;
DROP POLICY IF EXISTS service_contract_versions_therapist_read ON public.service_contract_versions;

CREATE POLICY service_contract_versions_service_role_manage
  ON public.service_contract_versions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY service_contract_versions_admin_manage
  ON public.service_contract_versions
  FOR ALL
  TO authenticated
  USING (
    app.user_has_role_for_org('admin', organization_id)
    OR app.user_has_role_for_org('super_admin', organization_id)
  )
  WITH CHECK (
    app.user_has_role_for_org('admin', organization_id)
    OR app.user_has_role_for_org('super_admin', organization_id)
  );

CREATE POLICY service_contract_versions_therapist_read
  ON public.service_contract_versions
  FOR SELECT
  TO authenticated
  USING (
    app.user_has_role_for_org('therapist', organization_id)
  );

DROP POLICY IF EXISTS service_contract_rates_service_role_manage ON public.service_contract_rates;
DROP POLICY IF EXISTS service_contract_rates_admin_manage ON public.service_contract_rates;
DROP POLICY IF EXISTS service_contract_rates_therapist_read ON public.service_contract_rates;

CREATE POLICY service_contract_rates_service_role_manage
  ON public.service_contract_rates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY service_contract_rates_admin_manage
  ON public.service_contract_rates
  FOR ALL
  TO authenticated
  USING (
    app.user_has_role_for_org('admin', organization_id)
    OR app.user_has_role_for_org('super_admin', organization_id)
  )
  WITH CHECK (
    app.user_has_role_for_org('admin', organization_id)
    OR app.user_has_role_for_org('super_admin', organization_id)
  );

CREATE POLICY service_contract_rates_therapist_read
  ON public.service_contract_rates
  FOR SELECT
  TO authenticated
  USING (
    app.user_has_role_for_org('therapist', organization_id)
  );

COMMIT;
