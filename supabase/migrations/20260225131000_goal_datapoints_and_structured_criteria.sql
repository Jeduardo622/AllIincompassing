begin;

alter table public.goals
  add column if not exists mastery_criteria text,
  add column if not exists maintenance_criteria text,
  add column if not exists generalization_criteria text,
  add column if not exists objective_data_points jsonb not null default '[]'::jsonb;

alter table public.goal_versions
  add column if not exists mastery_criteria text,
  add column if not exists maintenance_criteria text,
  add column if not exists generalization_criteria text,
  add column if not exists objective_data_points jsonb not null default '[]'::jsonb;

alter table public.assessment_draft_goals
  add column if not exists mastery_criteria text,
  add column if not exists maintenance_criteria text,
  add column if not exists generalization_criteria text,
  add column if not exists objective_data_points jsonb not null default '[]'::jsonb;

create table if not exists public.goal_data_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  assessment_document_id uuid references public.assessment_documents(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'assessment_extraction', 'session_note', 'ai_inferred')),
  metric_name text not null check (char_length(metric_name) > 0),
  metric_value numeric,
  metric_unit text,
  metric_payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default timezone('utc', now()),
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists goal_data_points_goal_observed_idx
  on public.goal_data_points (goal_id, observed_at desc);

create index if not exists goal_data_points_org_client_idx
  on public.goal_data_points (organization_id, client_id, observed_at desc);

create index if not exists goal_data_points_session_idx
  on public.goal_data_points (session_id);

alter table public.goal_data_points enable row level security;

drop policy if exists goal_data_points_service_role_all on public.goal_data_points;
create policy goal_data_points_service_role_all
  on public.goal_data_points
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists goal_data_points_org_manage on public.goal_data_points;
create policy goal_data_points_org_manage
  on public.goal_data_points
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

drop trigger if exists goal_data_points_set_updated_at on public.goal_data_points;
create trigger goal_data_points_set_updated_at
before update on public.goal_data_points
for each row
execute function public.set_updated_at();

create or replace function app.log_goal_version()
returns trigger
language plpgsql
security definer
set search_path = public
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
    mastery_criteria,
    maintenance_criteria,
    generalization_criteria,
    objective_data_points,
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
    new.mastery_criteria,
    new.maintenance_criteria,
    new.generalization_criteria,
    coalesce(new.objective_data_points, '[]'::jsonb),
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
  or old.mastery_criteria is distinct from new.mastery_criteria
  or old.maintenance_criteria is distinct from new.maintenance_criteria
  or old.generalization_criteria is distinct from new.generalization_criteria
  or old.objective_data_points is distinct from new.objective_data_points
  or old.status is distinct from new.status
)
execute function app.log_goal_version();

commit;
