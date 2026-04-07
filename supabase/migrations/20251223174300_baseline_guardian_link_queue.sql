-- @migration-intent: Baseline public.guardian_link_queue before 20251223174548_rls_initplan_tuning (policies ALTER the table; canonical DDL + indexes in 20260201090000_guardian_signup_queue.sql runs later on replay).
-- @migration-dependencies: public.organizations
-- @migration-rollback: DROP TABLE IF EXISTS public.guardian_link_queue;

CREATE TABLE IF NOT EXISTS public.guardian_link_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  guardian_email text NOT NULL,
  organization_id uuid REFERENCES public.organizations (id) ON DELETE CASCADE,
  invite_token text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_client_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  approved_client_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_by uuid REFERENCES auth.users (id),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  processed_at timestamptz,
  processed_by uuid REFERENCES auth.users (id),
  resolution_notes text
);

COMMENT ON TABLE public.guardian_link_queue IS
  'Guardian signup queue; baseline DDL for replay ordering before initplan RLS and before 20260201090000.';
