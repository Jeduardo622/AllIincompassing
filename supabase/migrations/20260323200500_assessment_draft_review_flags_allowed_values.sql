-- @migration-intent: constrain staged draft review_flags to approved vocabulary without changing column types
-- @migration-dependencies: 20260323194000_assessment_draft_evidence_and_review_flags.sql
-- @migration-rollback: drop constraints assessment_draft_programs_review_flags_allowed_chk and assessment_draft_goals_review_flags_allowed_chk

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assessment_draft_programs_review_flags_allowed_chk'
  ) then
    alter table public.assessment_draft_programs
      add constraint assessment_draft_programs_review_flags_allowed_chk
      check (
        review_flags <@ array[
          'missing_baseline',
          'weak_measurement_definition',
          'unsupported_parent_goal',
          'ambiguous_mastery_threshold',
          'evidence_gap',
          'duplicate_risk',
          'clinician_confirmation_needed'
        ]::text[]
      ) not valid;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assessment_draft_goals_review_flags_allowed_chk'
  ) then
    alter table public.assessment_draft_goals
      add constraint assessment_draft_goals_review_flags_allowed_chk
      check (
        review_flags <@ array[
          'missing_baseline',
          'weak_measurement_definition',
          'unsupported_parent_goal',
          'ambiguous_mastery_threshold',
          'evidence_gap',
          'duplicate_risk',
          'clinician_confirmation_needed'
        ]::text[]
      ) not valid;
  end if;
end
$$;

commit;
