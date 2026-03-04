begin;

set local search_path = public;

alter table if exists public.assessment_draft_goals
  add column if not exists goal_type text not null default 'child';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assessment_draft_goals_goal_type_check'
  ) then
    alter table public.assessment_draft_goals
      add constraint assessment_draft_goals_goal_type_check
      check (goal_type in ('child', 'parent'));
  end if;
end $$;

create index if not exists assessment_draft_goals_goal_type_idx
  on public.assessment_draft_goals (assessment_document_id, goal_type, accept_state);

alter table if exists public.goals
  add column if not exists goal_type text not null default 'child';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'goals_goal_type_check'
  ) then
    alter table public.goals
      add constraint goals_goal_type_check
      check (goal_type in ('child', 'parent'));
  end if;
end $$;

create index if not exists goals_program_goal_type_idx
  on public.goals (program_id, goal_type, status);

commit;
