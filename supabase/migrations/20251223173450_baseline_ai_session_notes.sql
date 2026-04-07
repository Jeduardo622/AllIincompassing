-- @migration-intent: Baseline public.ai_session_notes so 20251223173550_policy_consolidation_round3 and later ALTERs replay (table was never created in an earlier tracked migration).
-- @migration-dependencies: public.sessions, public.clients, public.therapists
-- @migration-rollback: DROP TABLE IF EXISTS public.ai_session_notes;

-- Shape aligns with src/lib/generated/database.types.ts (ai_session_notes Row).
CREATE TABLE IF NOT EXISTS public.ai_session_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  therapist_id uuid NOT NULL REFERENCES public.therapists (id),
  client_id uuid NOT NULL REFERENCES public.clients (id),
  session_date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  session_duration integer NOT NULL,
  ai_confidence_score double precision,
  ai_generated_summary text,
  behavioral_observations jsonb,
  california_compliant boolean,
  client_responses jsonb,
  created_at timestamptz DEFAULT timezone('utc'::text, now()),
  current_clinical_status text,
  data_collection_summary jsonb,
  goal_ids uuid[] DEFAULT '{}'::uuid[],
  insurance_ready boolean,
  interventions_used jsonb,
  location text,
  manual_edits text[],
  participants text[],
  progress_toward_goals jsonb,
  recommendations text[],
  signature text,
  signed_at timestamptz,
  targeted_goals jsonb,
  updated_at timestamptz DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.ai_session_notes IS
  'AI session documentation; baseline DDL for migration replay when historical CREATE was absent from the ledger.';
