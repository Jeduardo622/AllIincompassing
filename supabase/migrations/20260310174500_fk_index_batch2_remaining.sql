-- @migration-intent: Add remaining covering indexes for public-schema foreign keys flagged by advisors.
-- @migration-dependencies: 20260310170000_assessment_fk_index_batch1.sql
-- @migration-rollback: Drop idx_fk_batch2_* indexes if rollback is required after query-plan verification.

begin;

set search_path = public;

create index if not exists idx_fk_batch2_assessment_review_events_doc_id
  on public.assessment_review_events (assessment_document_id);

create index if not exists idx_fk_batch2_assessment_review_events_client_id
  on public.assessment_review_events (client_id);

create index if not exists idx_fk_batch2_assessment_review_events_org_id
  on public.assessment_review_events (organization_id);

create index if not exists idx_fk_batch2_client_therapist_links_created_by
  on public.client_therapist_links (created_by);

create index if not exists idx_fk_batch2_goal_versions_client_id
  on public.goal_versions (client_id);

create index if not exists idx_fk_batch2_goal_versions_org_id
  on public.goal_versions (organization_id);

create index if not exists idx_fk_batch2_goals_client_id
  on public.goals (client_id);

create index if not exists idx_fk_batch2_program_notes_org_id
  on public.program_notes (organization_id);

create index if not exists idx_fk_batch2_programs_client_id
  on public.programs (client_id);

create index if not exists idx_fk_batch2_service_contract_rates_contract_org
  on public.service_contract_rates (contract_id, organization_id);

create index if not exists idx_fk_batch2_service_contract_versions_contract_org
  on public.service_contract_versions (contract_id, organization_id);

create index if not exists idx_fk_batch2_service_contract_versions_uploaded_by
  on public.service_contract_versions (uploaded_by);

create index if not exists idx_fk_batch2_service_contracts_created_by
  on public.service_contracts (created_by);

create index if not exists idx_fk_batch2_service_contracts_updated_by
  on public.service_contracts (updated_by);

create index if not exists idx_fk_batch2_session_goals_client_id
  on public.session_goals (client_id);

create index if not exists idx_fk_batch2_session_goals_org_id
  on public.session_goals (organization_id);

create index if not exists idx_fk_batch2_sessions_goal_id
  on public.sessions (goal_id);

create index if not exists idx_fk_batch2_sessions_program_id
  on public.sessions (program_id);

commit;
