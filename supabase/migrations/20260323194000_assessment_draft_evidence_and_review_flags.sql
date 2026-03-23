-- @migration-intent: Persist evidence references and review flags on staged draft programs/goals for structured AI draft review.
-- @migration-dependencies: 20260310170000_assessment_fk_index_batch1.sql
-- @migration-rollback: Drop added draft evidence/review columns if staged metadata must be reverted.

begin;

alter table if exists public.assessment_draft_programs
  add column if not exists summary_rationale text,
  add column if not exists confidence text,
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb,
  add column if not exists review_flags text[] not null default '{}'::text[];

alter table if exists public.assessment_draft_goals
  add column if not exists program_name text,
  add column if not exists rationale text,
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb,
  add column if not exists review_flags text[] not null default '{}'::text[];

commit;
