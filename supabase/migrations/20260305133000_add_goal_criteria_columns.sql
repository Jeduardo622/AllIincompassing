alter table if exists public.assessment_draft_goals
  add column if not exists mastery_criteria text,
  add column if not exists maintenance_criteria text,
  add column if not exists generalization_criteria text,
  add column if not exists objective_data_points jsonb not null default '[]'::jsonb;

alter table if exists public.goals
  add column if not exists mastery_criteria text,
  add column if not exists maintenance_criteria text,
  add column if not exists generalization_criteria text,
  add column if not exists objective_data_points jsonb not null default '[]'::jsonb;
