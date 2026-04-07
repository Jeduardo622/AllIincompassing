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

-- guardian_link_queue FK indexes: table is created in 20260201090000_guardian_signup_queue.sql
-- (after this migration on full replay); indexes are added alongside that table.

CREATE INDEX IF NOT EXISTS session_audit_logs_therapist_id_idx
  ON public.session_audit_logs (therapist_id);

