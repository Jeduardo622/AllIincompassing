-- @migration-intent: Extend agent work evidence kinds with generic staged draft program and goal sources for CalOptima draft review.
-- @migration-dependencies: 20260801090000_agent_work_ledger_core.sql
-- @migration-rollback: Enum values are additive only; rollback would require a new migration to stop using the added values.

begin;

alter type public.agent_work_evidence_source_kind
  add value if not exists 'assessment_draft_program';

alter type public.agent_work_evidence_source_kind
  add value if not exists 'assessment_draft_goal';

commit;
