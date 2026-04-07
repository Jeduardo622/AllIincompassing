-- @migration-intent: Baseline public.client_guardians before 20251223173550_policy_consolidation_round3 (canonical CREATE is dated 20251226090000 and runs later on replay).
-- @migration-dependencies: public.organizations, public.clients, public.roles
-- @migration-rollback: DROP TABLE IF EXISTS public.client_guardians;

-- Mirrors the table DDL in 20251226090000_client_guardians.sql (triggers/functions remain in that migration).
INSERT INTO public.roles (name, description)
VALUES ('client', 'Client or guardian with access to linked dependents')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.client_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  relationship text,
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_by uuid REFERENCES auth.users (id),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users (id)
);

COMMENT ON TABLE public.client_guardians IS
  'Links guardians to clients; baseline DDL for migration replay ordering before policy consolidation.';
