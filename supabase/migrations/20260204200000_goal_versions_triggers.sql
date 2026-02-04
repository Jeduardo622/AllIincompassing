begin;

create or replace function app.log_goal_version()
returns trigger
language plpgsql
security definer
set search_path = public, app, auth
as $$
begin
  insert into public.goal_versions (
    goal_id,
    organization_id,
    client_id,
    program_id,
    original_text,
    title,
    description,
    clinical_context,
    target_behavior,
    measurement_type,
    baseline_data,
    target_criteria,
    status,
    changed_by,
    changed_at,
    change_reason
  )
  values (
    new.id,
    new.organization_id,
    new.client_id,
    new.program_id,
    new.original_text,
    new.title,
    new.description,
    new.clinical_context,
    new.target_behavior,
    new.measurement_type,
    new.baseline_data,
    new.target_criteria,
    new.status,
    app.current_user_id(),
    timezone('utc', now()),
    null
  );
  return new;
end;
$$;

drop trigger if exists goals_versioned on public.goals;
create trigger goals_versioned
after update on public.goals
for each row
when (
  old.original_text is distinct from new.original_text
  or old.title is distinct from new.title
  or old.description is distinct from new.description
  or old.clinical_context is distinct from new.clinical_context
  or old.target_behavior is distinct from new.target_behavior
  or old.measurement_type is distinct from new.measurement_type
  or old.baseline_data is distinct from new.baseline_data
  or old.target_criteria is distinct from new.target_criteria
  or old.status is distinct from new.status
)
execute function app.log_goal_version();

drop trigger if exists programs_set_updated_at on public.programs;
create trigger programs_set_updated_at
before update on public.programs
for each row
execute function public.set_updated_at();

drop trigger if exists goals_set_updated_at on public.goals;
create trigger goals_set_updated_at
before update on public.goals
for each row
execute function public.set_updated_at();

drop trigger if exists program_notes_set_updated_at on public.program_notes;
create trigger program_notes_set_updated_at
before update on public.program_notes
for each row
execute function public.set_updated_at();

commit;
