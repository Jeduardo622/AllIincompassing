/*
  # Performance index cleanup and FK coverage

  - Drop duplicate indexes flagged by Supabase advisors
  - Add covering indexes for high-frequency foreign keys
*/

-- Drop duplicate indexes (retain canonical names)
DROP INDEX IF EXISTS public.admin_actions_org_idx;
DROP INDEX IF EXISTS public.idx_session_cpt_entries_cpt_code_id;
DROP INDEX IF EXISTS public.session_cpt_modifiers_modifier_idx;
DROP INDEX IF EXISTS public.session_cpt_modifiers_entry_idx;

-- Cover missing foreign-key indexes
CREATE INDEX IF NOT EXISTS authorizations_insurance_provider_id_idx
  ON public.authorizations (insurance_provider_id);

CREATE INDEX IF NOT EXISTS billing_records_session_id_idx
  ON public.billing_records (session_id);

CREATE INDEX IF NOT EXISTS client_session_notes_session_id_idx
  ON public.client_session_notes (session_id);

CREATE INDEX IF NOT EXISTS client_session_notes_created_by_idx
  ON public.client_session_notes (created_by);

CREATE INDEX IF NOT EXISTS guardian_link_queue_created_by_idx
  ON public.guardian_link_queue (created_by);

CREATE INDEX IF NOT EXISTS guardian_link_queue_processed_by_idx
  ON public.guardian_link_queue (processed_by);

CREATE INDEX IF NOT EXISTS session_audit_logs_therapist_id_idx
  ON public.session_audit_logs (therapist_id);

