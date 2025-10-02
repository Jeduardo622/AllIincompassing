BEGIN;

-- Ensure session lookups by organization/therapist/time leverage composite indexes
CREATE INDEX IF NOT EXISTS sessions_org_therapist_start_time_idx
  ON public.sessions (organization_id, therapist_id, start_time);

-- Optimize client listings by organization and active status while respecting soft deletes
CREATE INDEX IF NOT EXISTS clients_org_status_active_idx
  ON public.clients (organization_id, status, full_name)
  WHERE deleted_at IS NULL;

-- Improve billing record retrieval for organization dashboards
CREATE INDEX IF NOT EXISTS billing_records_org_status_created_idx
  ON public.billing_records (organization_id, status, created_at DESC);

-- Accelerate CPT entry hydration scoped by organization and session ordering
CREATE INDEX IF NOT EXISTS session_cpt_entries_org_session_line_idx
  ON public.session_cpt_entries (organization_id, session_id, line_number);

COMMIT;
