-- @migration-intent: Add org-scoped goal domains and preserve structured clinical draft fields through FBA promotion.
-- @migration-dependencies: 20260703173000_goal_targets_trial_events.sql
-- @migration-rollback: alter table public.goals drop constraint if exists goals_domain_id_fkey; alter table public.assessment_draft_goals drop column if exists domain_id, drop column if exists clinical_goal_type, drop column if exists teaching_strategies, drop column if exists operational_definition, drop column if exists baseline; drop table if exists public.goal_domains;

begin;

create table if not exists public.goal_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists goal_domains_org_name_uidx
  on public.goal_domains (organization_id, lower(btrim(name)))
  where status = 'active';

alter table public.goal_domains
  drop constraint if exists goal_domains_id_organization_id_key,
  add constraint goal_domains_id_organization_id_key unique (id, organization_id);

create index if not exists goal_domains_org_status_idx
  on public.goal_domains (organization_id, status, name);

drop trigger if exists goal_domains_set_updated_at on public.goal_domains;
create trigger goal_domains_set_updated_at
before update on public.goal_domains
for each row
execute function public.set_updated_at();

alter table public.assessment_draft_goals
  add column if not exists domain_id uuid references public.goal_domains(id),
  add column if not exists clinical_goal_type text,
  add column if not exists teaching_strategies text,
  add column if not exists operational_definition text,
  add column if not exists baseline text;

update public.assessment_draft_goals
set baseline = baseline_data
where baseline is null
  and baseline_data is not null;

create temporary table legacy_goal_domain_backfill on commit drop as
select
  legacy_domains.organization_id,
  legacy_domains.domain_id as legacy_domain_id,
  case
    when row_number() over (partition by legacy_domains.domain_id order by legacy_domains.organization_id) = 1
      then legacy_domains.domain_id
    else gen_random_uuid()
  end as backfilled_domain_id
from (
  select distinct goals.organization_id, goals.domain_id
  from public.goals
  where goals.domain_id is not null
    and goals.organization_id is not null
) legacy_domains;

insert into public.goal_domains (id, organization_id, name, description)
select
  backfilled_domain_id,
  organization_id,
  'Legacy domain ' || legacy_domain_id::text,
  case
    when backfilled_domain_id = legacy_domain_id
      then 'Backfilled from goals.domain_id before goal domain catalog enforcement.'
    else 'Backfilled from a duplicate legacy goals.domain_id before goal domain catalog enforcement.'
  end
from legacy_goal_domain_backfill
on conflict (id) do nothing;

update public.goals
set domain_id = legacy_goal_domain_backfill.backfilled_domain_id
from legacy_goal_domain_backfill
where goals.organization_id = legacy_goal_domain_backfill.organization_id
  and goals.domain_id = legacy_goal_domain_backfill.legacy_domain_id
  and goals.domain_id is distinct from legacy_goal_domain_backfill.backfilled_domain_id;

alter table public.assessment_draft_goals
  drop constraint if exists assessment_draft_goals_clinical_goal_type_chk,
  add constraint assessment_draft_goals_clinical_goal_type_chk
  check (clinical_goal_type is null or clinical_goal_type in ('behavior', 'skill'));

alter table public.goals
  drop constraint if exists goals_domain_id_fkey,
  add constraint goals_domain_id_fkey
  foreign key (domain_id, organization_id) references public.goal_domains(id, organization_id);

alter table public.assessment_draft_goals
  drop constraint if exists assessment_draft_goals_domain_id_fkey,
  add constraint assessment_draft_goals_domain_id_fkey
  foreign key (domain_id, organization_id) references public.goal_domains(id, organization_id);

alter table public.goal_domains enable row level security;

revoke all on table public.goal_domains from anon;
grant select, insert, update on table public.goal_domains to authenticated;
grant select, insert, update, delete on table public.goal_domains to service_role;

drop policy if exists goal_domains_service_role_all on public.goal_domains;
create policy goal_domains_service_role_all
  on public.goal_domains
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists goal_domains_org_read on public.goal_domains;
create policy goal_domains_org_read
  on public.goal_domains
  for select
  to authenticated
  using (organization_id = app.current_user_organization_id());

drop policy if exists goal_domains_org_insert on public.goal_domains;
create policy goal_domains_org_insert
  on public.goal_domains
  for insert
  to authenticated
  with check (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_manage_programs_goals(organization_id)
  );

drop policy if exists goal_domains_org_update on public.goal_domains;
create policy goal_domains_org_update
  on public.goal_domains
  for update
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_manage_programs_goals(organization_id)
  )
  with check (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_manage_programs_goals(organization_id)
  );

commit;
