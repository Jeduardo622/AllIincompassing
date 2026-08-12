-- @migration-intent: payroll_timesheet_snapshots
-- @migration-dependencies: 20260811214856_payroll_timekeeping_capture_read_model.sql
-- @migration-rollback: Drop timesheet snapshot tables, policies, indexes, and RPCs; then regenerate local database types after a clean local reset.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

create table if not exists public.timesheet_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  pay_period_id uuid not null,
  policy_version_id uuid not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_high_water jsonb not null default '{}'::jsonb,
  canonical_payload jsonb not null default '{}'::jsonb,
  regular_seconds integer not null default 0 check (regular_seconds >= 0),
  overtime_seconds integer not null default 0 check (overtime_seconds >= 0),
  double_time_seconds integer not null default 0 check (double_time_seconds >= 0),
  meal_premium_cents integer not null default 0 check (meal_premium_cents >= 0),
  gross_earnings_cents integer not null default 0 check (gross_earnings_cents >= 0),
  lockable boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  unique (id, organization_id, employment_profile_id),
  unique (id, organization_id, employment_profile_id, pay_period_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict,
  foreign key (policy_version_id, organization_id)
    references public.payroll_policy_versions(id, organization_id) on delete restrict
);

create table if not exists public.timesheet_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  snapshot_id uuid not null,
  employment_profile_id uuid not null,
  pay_period_id uuid not null,
  line_type text not null check (line_type in ('segment', 'exception', 'summary', 'premium')),
  line_code text not null,
  line_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (snapshot_id, organization_id, employment_profile_id, pay_period_id)
    references public.timesheet_snapshots(id, organization_id, employment_profile_id, pay_period_id) on delete restrict,
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict
);

create table if not exists public.timesheet_snapshot_current_heads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  pay_period_id uuid not null,
  snapshot_id uuid not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  prior_snapshot_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict,
  foreign key (snapshot_id, organization_id, employment_profile_id, pay_period_id)
    references public.timesheet_snapshots(id, organization_id, employment_profile_id, pay_period_id) on delete restrict,
  foreign key (prior_snapshot_id, organization_id, employment_profile_id, pay_period_id)
    references public.timesheet_snapshots(id, organization_id, employment_profile_id, pay_period_id) on delete restrict
);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'employee_time_events_id_org_employment_key'
      and constraint_row.conrelid = 'public.employee_time_events'::regclass
  ) then
    alter table public.employee_time_events
      add constraint employee_time_events_id_org_employment_key
      unique (id, organization_id, employment_profile_id);
  end if;
end
$$;

create table if not exists public.timesheet_meal_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  pay_period_id uuid not null,
  shift_start_event_id uuid not null,
  meal_ordinal integer not null check (meal_ordinal in (1, 2)),
  deadline_at timestamptz not null,
  meal_start_event_id uuid,
  meal_end_event_id uuid,
  resolution_code text not null check (resolution_code in ('waived_first_meal', 'waived_second_meal', 'premium_owed', 'premium_not_owed')),
  resolved_by uuid not null references auth.users(id) on delete restrict,
  resolution_reason text,
  resolved_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict,
  foreign key (shift_start_event_id, organization_id, employment_profile_id)
    references public.employee_time_events(id, organization_id, employment_profile_id) on delete restrict,
  foreign key (meal_start_event_id, organization_id, employment_profile_id)
    references public.employee_time_events(id, organization_id, employment_profile_id) on delete restrict,
  foreign key (meal_end_event_id, organization_id, employment_profile_id)
    references public.employee_time_events(id, organization_id, employment_profile_id) on delete restrict,
  unique (organization_id, employment_profile_id, pay_period_id, shift_start_event_id, meal_ordinal)
);

create index if not exists employee_time_events_org_employment_event_at_idx
  on public.employee_time_events (organization_id, employment_profile_id, event_at, created_at, id);

create index if not exists session_attendance_events_org_employment_event_at_idx
  on public.session_attendance_events (organization_id, employment_profile_id, event_at, created_at, id);

create index if not exists time_correction_requests_org_employment_created_at_idx
  on public.time_correction_requests (organization_id, employment_profile_id, created_at, id);

create index if not exists session_attendance_correction_requests_org_employment_created_at_idx
  on public.session_attendance_correction_requests (organization_id, employment_profile_id, created_at, id);

create index if not exists timekeeping_exceptions_org_employment_created_at_idx
  on public.timekeeping_exceptions (organization_id, employment_profile_id, created_at, id);

create index if not exists pay_group_assignments_org_employment_effective_idx
  on public.pay_group_assignments (organization_id, employment_profile_id, effective_from, effective_through);

create index if not exists employment_profiles_org_therapist_active_idx
  on public.employment_profiles (organization_id, therapist_id, active_from desc);

create index if not exists timesheet_snapshots_org_employment_period_hash_idx
  on public.timesheet_snapshots (organization_id, employment_profile_id, pay_period_id, source_hash, created_at desc);

create unique index if not exists timesheet_snapshots_org_employment_period_hash_uidx
  on public.timesheet_snapshots (organization_id, employment_profile_id, pay_period_id, source_hash);

create index if not exists timesheet_snapshot_lines_org_snapshot_idx
  on public.timesheet_snapshot_lines (organization_id, snapshot_id, created_at, id);

create unique index if not exists timesheet_snapshot_current_heads_org_employment_period_uidx
  on public.timesheet_snapshot_current_heads (organization_id, employment_profile_id, pay_period_id, created_at desc, id desc);

drop trigger if exists timesheet_snapshots_append_only on public.timesheet_snapshots;
create trigger timesheet_snapshots_append_only
  before update or delete on public.timesheet_snapshots
  for each row
  execute function app.reject_payroll_source_mutation();

drop trigger if exists timesheet_snapshot_lines_append_only on public.timesheet_snapshot_lines;
create trigger timesheet_snapshot_lines_append_only
  before update or delete on public.timesheet_snapshot_lines
  for each row
  execute function app.reject_payroll_source_mutation();

drop trigger if exists timesheet_snapshot_current_heads_append_only on public.timesheet_snapshot_current_heads;
create trigger timesheet_snapshot_current_heads_append_only
  before update or delete on public.timesheet_snapshot_current_heads
  for each row
  execute function app.reject_payroll_source_mutation();

drop trigger if exists timesheet_meal_resolutions_append_only on public.timesheet_meal_resolutions;
create trigger timesheet_meal_resolutions_append_only
  before update or delete on public.timesheet_meal_resolutions
  for each row
  execute function app.reject_payroll_source_mutation();

alter table public.timesheet_snapshots enable row level security;
alter table public.timesheet_snapshots force row level security;
alter table public.timesheet_snapshot_lines enable row level security;
alter table public.timesheet_snapshot_lines force row level security;
alter table public.timesheet_snapshot_current_heads enable row level security;
alter table public.timesheet_snapshot_current_heads force row level security;
alter table public.timesheet_meal_resolutions enable row level security;
alter table public.timesheet_meal_resolutions force row level security;

create policy timesheet_snapshots_authenticated_select
  on public.timesheet_snapshots
  for select
  to authenticated
  using (app.payroll_actor_has_capability(organization_id, 'payroll.view_compensation'));

create policy timesheet_snapshot_lines_authenticated_select
  on public.timesheet_snapshot_lines
  for select
  to authenticated
  using (app.payroll_actor_has_capability(organization_id, 'payroll.view_compensation'));

create policy timesheet_snapshot_current_heads_authenticated_select
  on public.timesheet_snapshot_current_heads
  for select
  to authenticated
  using (app.current_user_can_read_payroll_employee(organization_id, employment_profile_id));

create policy timesheet_meal_resolutions_authenticated_select
  on public.timesheet_meal_resolutions
  for select
  to authenticated
  using (app.current_user_can_read_payroll_employee(organization_id, employment_profile_id));

revoke all on public.timesheet_snapshots from public, anon, authenticated;
revoke all on public.timesheet_snapshot_lines from public, anon, authenticated;
revoke all on public.timesheet_snapshot_current_heads from public, anon, authenticated;
revoke all on public.timesheet_meal_resolutions from public, anon, authenticated;
revoke all on public.timesheet_snapshots from service_role;
revoke all on public.timesheet_snapshot_lines from service_role;
revoke all on public.timesheet_snapshot_current_heads from service_role;
revoke all on public.timesheet_meal_resolutions from service_role;
grant select on public.timesheet_snapshots to authenticated;
grant select on public.timesheet_snapshot_lines to authenticated;
grant select on public.timesheet_snapshot_current_heads to authenticated;
grant select on public.timesheet_meal_resolutions to authenticated;
revoke update, delete on public.timesheet_snapshots from authenticated, service_role;
revoke update, delete on public.timesheet_snapshot_lines from authenticated, service_role;
revoke update, delete on public.timesheet_snapshot_current_heads from authenticated, service_role;
revoke update, delete on public.timesheet_meal_resolutions from authenticated, service_role;

create or replace function app.payroll_timesheet_global_config_lock(p_exclusive boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_exclusive then
    perform pg_advisory_xact_lock(hashtextextended('payroll_timesheet_global_config', 0));
  else
    perform pg_advisory_xact_lock_shared(hashtextextended('payroll_timesheet_global_config', 0));
  end if;
end;
$$;

create or replace function app.payroll_timesheet_org_lock(target_organization_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if target_organization_id is null then
    raise exception using errcode = '22023', message = 'organization_id is required for payroll timesheet locking';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('payroll_timesheet_org:' || target_organization_id::text, 0)
  );
end;
$$;

create or replace function app.payroll_timesheet_derivation_lock(target_organization_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform app.payroll_timesheet_global_config_lock(false);
  perform app.payroll_timesheet_org_lock(target_organization_id);
end;
$$;

create or replace function app.payroll_timesheet_derivation_mutation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid := coalesce(new.organization_id, old.organization_id);
begin
  perform app.payroll_timesheet_global_config_lock(false);
  perform app.payroll_timesheet_org_lock(v_organization_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function app.payroll_timesheet_policy_mutation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid := coalesce(new.organization_id, old.organization_id);
begin
  if v_organization_id is null then
    perform app.payroll_timesheet_global_config_lock(true);
  else
    perform app.payroll_timesheet_global_config_lock(false);
    perform app.payroll_timesheet_org_lock(v_organization_id);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function app.payroll_timesheet_global_mutation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.payroll_timesheet_global_config_lock(true);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists employee_time_events_timesheet_derivation_guard on public.employee_time_events;
create trigger employee_time_events_timesheet_derivation_guard
  before insert or update or delete on public.employee_time_events
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists session_attendance_events_timesheet_derivation_guard on public.session_attendance_events;
create trigger session_attendance_events_timesheet_derivation_guard
  before insert or update or delete on public.session_attendance_events
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists time_correction_requests_timesheet_derivation_guard on public.time_correction_requests;
create trigger time_correction_requests_timesheet_derivation_guard
  before insert or update or delete on public.time_correction_requests
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists session_attendance_correction_requests_timesheet_derivation_guard on public.session_attendance_correction_requests;
create trigger session_attendance_correction_requests_timesheet_derivation_guard
  before insert or update or delete on public.session_attendance_correction_requests
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists timekeeping_exceptions_timesheet_derivation_guard on public.timekeeping_exceptions;
create trigger timekeeping_exceptions_timesheet_derivation_guard
  before insert or update or delete on public.timekeeping_exceptions
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists timesheet_meal_resolutions_timesheet_derivation_guard on public.timesheet_meal_resolutions;
create trigger timesheet_meal_resolutions_timesheet_derivation_guard
  before insert or update or delete on public.timesheet_meal_resolutions
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists employment_profiles_timesheet_derivation_guard on public.employment_profiles;
create trigger employment_profiles_timesheet_derivation_guard
  before insert or update or delete on public.employment_profiles
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists employee_rate_versions_timesheet_derivation_guard on public.employee_rate_versions;
create trigger employee_rate_versions_timesheet_derivation_guard
  before insert or update or delete on public.employee_rate_versions
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists pay_groups_timesheet_derivation_guard on public.pay_groups;
create trigger pay_groups_timesheet_derivation_guard
  before insert or update or delete on public.pay_groups
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists pay_group_assignments_timesheet_derivation_guard on public.pay_group_assignments;
create trigger pay_group_assignments_timesheet_derivation_guard
  before insert or update or delete on public.pay_group_assignments
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists pay_periods_timesheet_derivation_guard on public.pay_periods;
create trigger pay_periods_timesheet_derivation_guard
  before insert or update or delete on public.pay_periods
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists payroll_policy_versions_timesheet_derivation_guard on public.payroll_policy_versions;
create trigger payroll_policy_versions_timesheet_derivation_guard
  before insert or update or delete on public.payroll_policy_versions
  for each row
  execute function app.payroll_timesheet_policy_mutation_guard();

drop trigger if exists payroll_organization_settings_timesheet_derivation_guard on public.payroll_organization_settings;
create trigger payroll_organization_settings_timesheet_derivation_guard
  before insert or update or delete on public.payroll_organization_settings
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

drop trigger if exists feature_flags_timesheet_derivation_guard on public.feature_flags;
create trigger feature_flags_timesheet_derivation_guard
  before insert or update or delete on public.feature_flags
  for each row
  execute function app.payroll_timesheet_global_mutation_guard();

drop trigger if exists organization_feature_flags_timesheet_derivation_guard on public.organization_feature_flags;
create trigger organization_feature_flags_timesheet_derivation_guard
  before insert or update or delete on public.organization_feature_flags
  for each row
  execute function app.payroll_timesheet_derivation_mutation_guard();

revoke all on function app.payroll_timesheet_global_config_lock(boolean) from public, anon, authenticated, service_role;
revoke all on function app.payroll_timesheet_org_lock(uuid) from public, anon, authenticated, service_role;
revoke all on function app.payroll_timesheet_derivation_lock(uuid) from public, anon, authenticated, service_role;
revoke all on function app.payroll_timesheet_derivation_mutation_guard() from public, anon, authenticated, service_role;
revoke all on function app.payroll_timesheet_policy_mutation_guard() from public, anon, authenticated, service_role;
revoke all on function app.payroll_timesheet_global_mutation_guard() from public, anon, authenticated, service_role;

create or replace function public.get_payroll_timesheet_period(
  selected_local_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_employment_count bigint;
  v_employment public.employment_profiles%rowtype;
  v_settings public.payroll_organization_settings%rowtype;
  v_feature_flag_enabled boolean := false;
  v_pay_group_assignment public.pay_group_assignments%rowtype;
  v_pay_group public.pay_groups%rowtype;
  v_pay_period public.pay_periods%rowtype;
  v_policy public.payroll_policy_versions%rowtype;
  v_snapshot jsonb := null;
  v_events jsonb := '[]'::jsonb;
  v_rate_versions jsonb := '[]'::jsonb;
  v_corrections jsonb := '[]'::jsonb;
  v_attendance_corrections jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_meal_resolutions jsonb := '[]'::jsonb;
  v_selected_local_date date := selected_local_date;
  v_period_start date;
  v_period_end date;
  v_period_start_utc timestamptz;
  v_period_end_utc timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if v_selected_local_date is null then
    raise exception using errcode = '22023', message = 'selected_local_date is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if app.payroll_actor_has_capability(v_actor_org, 'time.view_self') is not true then
    raise exception using errcode = '42501', message = 'time.view_self capability is required';
  end if;

  perform app.payroll_timesheet_derivation_lock(v_actor_org);

  select count(*)
  into v_employment_count
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.user_id = v_actor
    and employment.active_from <= v_selected_local_date
    and (employment.active_through is null or employment.active_through >= v_selected_local_date);

  if v_employment_count = 0 then
    return jsonb_build_object(
      'state', 'no_employment_profile',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  if v_employment_count <> 1 then
    raise exception using errcode = '42501', message = 'ambiguous active payroll employment profile';
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.user_id = v_actor
    and employment.active_from <= v_selected_local_date
    and (employment.active_through is null or employment.active_through >= v_selected_local_date)
  order by employment.active_from desc
  limit 1;

  if v_employment.home_jurisdiction <> 'CA' then
    return jsonb_build_object(
      'state', 'unsupported_jurisdiction',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select coalesce(org_override.is_enabled, flag.default_enabled, false)
  into v_feature_flag_enabled
  from public.feature_flags flag
  left join public.organization_feature_flags org_override
    on org_override.feature_flag_id = flag.id
   and org_override.organization_id = v_actor_org
  where flag.flag_key = 'payroll_timekeeping_v1'
  limit 1;

  if coalesce(v_feature_flag_enabled, false) is not true then
    return jsonb_build_object(
      'state', 'feature_disabled',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select settings.*
  into v_settings
  from public.payroll_organization_settings settings
  where settings.organization_id = v_actor_org
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'feature_disabled',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select assignment.*
  into v_pay_group_assignment
  from public.pay_group_assignments assignment
  where assignment.organization_id = v_actor_org
    and assignment.employment_profile_id = v_employment.id
    and assignment.effective_from <= v_selected_local_date
    and (assignment.effective_through is null or assignment.effective_through >= v_selected_local_date)
  order by assignment.effective_from desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select pay_group.*
  into v_pay_group
  from public.pay_groups pay_group
  where pay_group.organization_id = v_actor_org
    and pay_group.id = v_pay_group_assignment.pay_group_id
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  if v_pay_group.cadence = 'monthly' then
    return jsonb_build_object(
      'state', 'unsupported_policy',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select pay_period.*
  into v_pay_period
  from public.pay_periods pay_period
  where pay_period.organization_id = v_actor_org
    and pay_period.pay_group_id = v_pay_group_assignment.pay_group_id
    and pay_period.starts_on <= v_selected_local_date
    and pay_period.ends_on >= v_selected_local_date
  order by pay_period.starts_on desc, pay_period.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  v_period_start := v_pay_period.starts_on;
  v_period_end := v_pay_period.ends_on;
  v_period_start_utc := (v_period_start::timestamp at time zone v_employment.timezone);
  v_period_end_utc := ((v_period_end + 1)::timestamp at time zone v_employment.timezone);

  select policy.*
  into v_policy
  from public.payroll_policy_versions policy
  where (policy.organization_id is null or policy.organization_id = v_actor_org)
    and policy.jurisdiction = v_employment.home_jurisdiction
    and policy.activation_status = 'active'
    and policy.effective_from <= v_period_end
    and (policy.effective_through is null or policy.effective_through >= v_period_start)
  order by coalesce(policy.organization_id, v_actor_org) desc, policy.effective_from desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'periodStart', v_period_start,
        'periodEnd', v_period_end,
        'payPeriodId', v_pay_period.id,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', event_row.id,
        'source', 'employee_time',
        'eventType', event_row.event_type,
        'occurredAt', event_row.event_at,
        'createdAt', event_row.created_at,
        'timezone', event_row.source_timezone,
        'workLocation', event_row.work_location,
        'workCategory', event_row.work_category,
        'details', event_row.metadata
      )
      order by event_row.event_at, event_row.created_at, event_row.id
    ),
    '[]'::jsonb
  )
  into v_events
  from public.employee_time_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id
    and event_row.event_at >= v_period_start_utc
    and event_row.event_at < v_period_end_utc;

  select v_events || coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', attendance_row.id,
        'source', 'session_attendance',
        'eventType', attendance_row.event_type,
        'occurredAt', attendance_row.event_at,
        'createdAt', attendance_row.created_at,
        'timezone', attendance_row.source_timezone,
        'workLocation', attendance_row.work_location,
        'workCategory', null,
        'sessionId', attendance_row.session_id,
        'employeeTimeEventId', attendance_row.employee_time_event_id,
        'details', attendance_row.metadata
      )
      order by attendance_row.event_at, attendance_row.created_at, attendance_row.id
    ),
    '[]'::jsonb
  )
  into v_events
  from public.session_attendance_events attendance_row
  where attendance_row.organization_id = v_actor_org
    and attendance_row.employment_profile_id = v_employment.id
    and attendance_row.event_at >= v_period_start_utc
    and attendance_row.event_at < v_period_end_utc;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', rate_row.id,
        'effectiveFrom', rate_row.effective_from,
        'effectiveThrough', rate_row.effective_through
      )
      order by rate_row.effective_from, rate_row.id
    ),
    '[]'::jsonb
  )
  into v_rate_versions
  from public.employee_rate_versions rate_row
  -- Deliberate self-pay projection: this SECURITY DEFINER read exposes only the caller's own
  -- period-scoped rate-version dates for self-review while omitting raw hourly rates.
  -- Gross and premiums still derive internally from protected rate rows. Raw rate tables remain protected directly.
  where rate_row.organization_id = v_actor_org
    and rate_row.employment_profile_id = v_employment.id
    and rate_row.effective_from < v_period_end_utc
    and (rate_row.effective_through is null or rate_row.effective_through >= v_period_start_utc);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', correction_row.id,
        'originalEventId', correction_row.original_event_id,
        'reasonCode', correction_row.reason_code,
        'replacementPayload', correction_row.replacement_payload,
        'createdAt', correction_row.created_at
      )
      order by correction_row.created_at, correction_row.id
    ),
    '[]'::jsonb
  )
  into v_corrections
  from public.time_correction_requests correction_row
  join public.employee_time_events event_row
    on event_row.organization_id = correction_row.organization_id
   and event_row.id = correction_row.original_event_id
  where correction_row.organization_id = v_actor_org
    and correction_row.employment_profile_id = v_employment.id
    and event_row.event_at >= v_period_start_utc
    and event_row.event_at < v_period_end_utc;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', correction_row.id,
        'sessionAttendanceEventId', correction_row.session_attendance_event_id,
        'reasonCode', correction_row.reason_code,
        'replacementPayload', correction_row.replacement_payload,
        'createdAt', correction_row.created_at
      )
      order by correction_row.created_at, correction_row.id
    ),
    '[]'::jsonb
  )
  into v_attendance_corrections
  from public.session_attendance_correction_requests correction_row
  join public.session_attendance_events attendance_row
    on attendance_row.organization_id = correction_row.organization_id
   and attendance_row.id = correction_row.session_attendance_event_id
  where correction_row.organization_id = v_actor_org
    and correction_row.employment_profile_id = v_employment.id
    and attendance_row.event_at >= v_period_start_utc
    and attendance_row.event_at < v_period_end_utc;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', exception_row.id,
        'exceptionCode', exception_row.exception_code,
        'details', exception_row.details,
        'createdAt', exception_row.created_at
      )
      order by exception_row.created_at, exception_row.id
    ),
    '[]'::jsonb
  )
  into v_exceptions
  from public.timekeeping_exceptions exception_row
  where exception_row.organization_id = v_actor_org
    and exception_row.employment_profile_id = v_employment.id
    and (
      exception_row.source_session_attendance_event_id in (
        select attendance_row.id
        from public.session_attendance_events attendance_row
        where attendance_row.organization_id = v_actor_org
          and attendance_row.employment_profile_id = v_employment.id
          and attendance_row.event_at >= v_period_start_utc
          and attendance_row.event_at < v_period_end_utc
      )
      or (
        exception_row.source_session_attendance_event_id is null
        and exception_row.created_at >= v_period_start_utc
        and exception_row.created_at < v_period_end_utc
      )
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', resolution_row.id,
        'shiftStartEventId', resolution_row.shift_start_event_id,
        'mealOrdinal', resolution_row.meal_ordinal,
        'deadlineAt', resolution_row.deadline_at,
        'mealStartEventId', resolution_row.meal_start_event_id,
        'mealEndEventId', resolution_row.meal_end_event_id,
        'code', resolution_row.resolution_code,
        'resolvedBy', resolution_row.resolved_by,
        'resolvedAt', resolution_row.resolved_at,
        'reason', resolution_row.resolution_reason,
        'createdAt', resolution_row.created_at
      )
      order by shift_event.event_at, resolution_row.meal_ordinal, resolution_row.created_at, resolution_row.id
    ),
    '[]'::jsonb
  )
  into v_meal_resolutions
  from public.timesheet_meal_resolutions resolution_row
  join public.employee_time_events shift_event
    on shift_event.organization_id = resolution_row.organization_id
   and shift_event.employment_profile_id = resolution_row.employment_profile_id
   and shift_event.id = resolution_row.shift_start_event_id
  where resolution_row.organization_id = v_actor_org
    and resolution_row.employment_profile_id = v_employment.id
    and resolution_row.pay_period_id = v_pay_period.id;

  select jsonb_build_object(
    'id', snapshot_row.id,
    'sourceHash', snapshot_row.source_hash,
    'lockable', snapshot_row.lockable,
    'totals', jsonb_build_object(
      'regularSeconds', snapshot_row.regular_seconds,
      'overtimeSeconds', snapshot_row.overtime_seconds,
      'doubleTimeSeconds', snapshot_row.double_time_seconds,
      'mealPremiumCents', snapshot_row.meal_premium_cents,
      'grossEarningsCents', snapshot_row.gross_earnings_cents
    ),
    'createdAt', snapshot_row.created_at
  )
  into v_snapshot
  from public.timesheet_snapshot_current_heads head_row
  join public.timesheet_snapshots snapshot_row
    on snapshot_row.id = head_row.snapshot_id
   and snapshot_row.organization_id = head_row.organization_id
  where head_row.organization_id = v_actor_org
    and head_row.employment_profile_id = v_employment.id
    and head_row.pay_period_id = coalesce(v_pay_period.id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by head_row.created_at desc, head_row.id desc
  limit 1;

  return jsonb_build_object(
    'state', 'ok',
    'snapshot', v_snapshot,
    'period', jsonb_build_object(
      'selectedLocalDate', v_selected_local_date,
      'periodStart', v_period_start,
      'periodEnd', v_period_end,
      'employmentProfileId', v_employment.id,
      'timezone', v_employment.timezone,
      'workdayStartsAt', coalesce(v_settings.workday_starts_at, time '00:00'),
      'workweekStartsOn', coalesce(v_settings.workweek_starts_on, 0),
      'policyVersionId', v_policy.id,
      'payPeriodId', v_pay_period.id,
      'events', v_events,
      'mealResolutions', v_meal_resolutions,
      'rateVersions', v_rate_versions,
      'timeCorrectionRequests', v_corrections,
      'sessionAttendanceCorrectionRequests', v_attendance_corrections,
      'exceptions', v_exceptions
    )
  );
end;
$$;

create or replace function app.record_blocked_timesheet_derivation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_payload_hash text,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_receipt_id uuid;
begin
  if coalesce(p_result ->> 'state', '') <> 'blocked' then
    raise exception using errcode = '22023', message = 'blocked derivation result required';
  end if;

  insert into public.payroll_mutation_receipts (
    organization_id,
    actor_user_id,
    operation,
    idempotency_key,
    payload_hash,
    result_payload
  ) values (
    p_organization_id,
    p_actor_user_id,
    'derive_timesheet_snapshot',
    p_idempotency_key,
    p_payload_hash,
    p_result
  )
  returning id into v_receipt_id;

  insert into public.payroll_audit_events (
    organization_id,
    actor_user_id,
    operation,
    target_table,
    target_row_id,
    payload
  ) values (
    p_organization_id,
    p_actor_user_id,
    'derive_timesheet_snapshot',
    'payroll_mutation_receipts',
    v_receipt_id,
    jsonb_build_object(
      'state', 'blocked',
      'sourceHash', p_result -> 'sourceHash',
      'exceptions', coalesce(p_result -> 'exceptions', '[]'::jsonb)
    )
  );

  return p_result;
end;
$$;

create or replace function public.derive_timesheet_snapshot(
  selected_local_date date,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_period jsonb;
  v_period_payload jsonb;
  v_snapshot jsonb;
  v_employment_id uuid;
  v_pay_period_id uuid;
  v_policy_version_id uuid;
  v_source_high_water jsonb;
  v_source_hash text;
  v_existing_snapshot_id uuid;
  v_existing_snapshot jsonb;
  v_snapshot_id uuid := gen_random_uuid();
  v_current_head_snapshot_id uuid;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_receipt_payload jsonb;
  v_payload_hash text;
  v_regular_seconds integer := 0;
  v_overtime_seconds integer := 0;
  v_double_time_seconds integer := 0;
  v_meal_premium_cents integer := 0;
  v_gross_earnings_cents integer := 0;
  v_period_start_utc timestamptz;
  v_period_end_utc timestamptz;
  v_settings_id uuid;
  v_pay_group_cadence public.pay_group_cadence;
  v_combined_source_count integer := 0;
  v_shift_balance integer := 0;
  v_meal_balance integer := 0;
  v_invalid_event_state boolean := false;
  v_unresolved_meal boolean := false;
  v_invalid_meal_resolution boolean := false;
  v_missing_meal_premium_rate boolean := false;
  v_paid_seconds integer := 0;
  v_rate_covered_seconds integer := 0;
  v_segments jsonb := '[]'::jsonb;
  v_meal_premium_lines jsonb := '[]'::jsonb;
  v_block_code text;
  v_block_message text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if selected_local_date is null then
    raise exception using errcode = '22023', message = 'selected_local_date is required';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'idempotency_key is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if app.payroll_actor_has_capability(v_actor_org, 'time.view_self') is not true then
    raise exception using errcode = '42501', message = 'time.view_self capability is required';
  end if;

  v_receipt_payload := jsonb_build_object(
    'selectedLocalDate', selected_local_date
  );
  v_payload_hash := app.payroll_hash_payload(v_receipt_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':derive_timesheet_snapshot:' || p_idempotency_key,
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'derive_timesheet_snapshot'
    and receipt.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  v_period := public.get_payroll_timesheet_period(selected_local_date);
  if coalesce(v_period ->> 'state', '') <> 'ok' then
    v_existing_snapshot := jsonb_build_object(
      'state', 'blocked',
      'snapshotId', null,
      'sourceHash', null,
      'replayed', false,
      'lockable', false,
      'period', coalesce(v_period -> 'period', '{}'::jsonb),
      'sourceHighWater', '{}'::jsonb,
      'totals', jsonb_build_object(
        'regularSeconds', 0,
        'overtimeSeconds', 0,
        'doubleTimeSeconds', 0,
        'mealPremiumCents', 0,
        'grossEarningsCents', 0
      ),
      'segments', '[]'::jsonb,
      'exceptions', jsonb_build_array(jsonb_build_object(
        'code', coalesce(v_period ->> 'state', 'missing_employment'),
        'blocking', true,
        'message', case coalesce(v_period ->> 'state', '')
          when 'feature_disabled' then 'Payroll timekeeping feature is disabled.'
          when 'unsupported_jurisdiction' then 'Unsupported payroll jurisdiction.'
          when 'unsupported_policy' then 'Monthly California nonexempt derivation is not active.'
          when 'no_employment_profile' then 'An active payroll employment profile is required.'
          else 'Timesheet period prerequisites are incomplete.'
        end
      ))
    );
    return app.record_blocked_timesheet_derivation(
      v_actor_org, v_actor, p_idempotency_key, v_payload_hash, v_existing_snapshot
    );
  end if;

  v_period_payload := coalesce(v_period -> 'period', '{}'::jsonb);
  v_employment_id := (v_period_payload ->> 'employmentProfileId')::uuid;
  if v_employment_id is null then
    select employment.id
    into v_employment_id
    from public.employment_profiles employment
    where employment.organization_id = v_actor_org
      and employment.user_id = v_actor
      and employment.active_from <= selected_local_date
      and (employment.active_through is null or employment.active_through >= selected_local_date)
    order by employment.active_from desc
    limit 1;
  end if;
  v_pay_period_id := (v_period_payload ->> 'payPeriodId')::uuid;
  v_policy_version_id := (v_period_payload ->> 'policyVersionId')::uuid;
  v_period_start_utc := ((v_period_payload ->> 'periodStart')::date::timestamp at time zone (v_period_payload ->> 'timezone'));
  v_period_end_utc := ((((v_period_payload ->> 'periodEnd')::date + 1)::timestamp) at time zone (v_period_payload ->> 'timezone'));

  select settings.id
  into v_settings_id
  from public.payroll_organization_settings settings
  where settings.organization_id = v_actor_org
  limit 1;

  select pay_group.cadence
  into v_pay_group_cadence
  from public.pay_periods pay_period
  join public.pay_groups pay_group
    on pay_group.id = pay_period.pay_group_id
   and pay_group.organization_id = pay_period.organization_id
  where pay_period.organization_id = v_actor_org
    and pay_period.id = v_pay_period_id
  limit 1;

  if v_employment_id is null
    or v_settings_id is null
    or v_pay_period_id is null
    or v_policy_version_id is null
    or v_pay_group_cadence is null
  then
    v_existing_snapshot := jsonb_build_object(
      'state', 'blocked',
      'snapshotId', null,
      'sourceHash', null,
      'replayed', false,
      'lockable', false,
      'period', v_period_payload,
      'sourceHighWater', '{}'::jsonb,
      'totals', jsonb_build_object(
        'regularSeconds', 0,
        'overtimeSeconds', 0,
        'doubleTimeSeconds', 0,
        'mealPremiumCents', 0,
        'grossEarningsCents', 0
      ),
      'segments', '[]'::jsonb,
      'exceptions', jsonb_build_array(jsonb_build_object(
        'code', 'missing_prerequisite',
        'blocking', true,
        'message', 'Payroll settings, assignment, pay period, and active policy are required.'
      ))
    );
    return app.record_blocked_timesheet_derivation(
      v_actor_org, v_actor, p_idempotency_key, v_payload_hash, v_existing_snapshot
    );
  end if;

  perform app.payroll_timesheet_derivation_lock(v_actor_org);

  select jsonb_build_object(
    'employeeTimeEvents', (
      select jsonb_build_object(
        'createdAt', max(event_row.created_at),
        'id', (array_agg(event_row.id order by event_row.created_at desc, event_row.id desc))[1],
        'rowCount', count(*)
      )
      from public.employee_time_events event_row
      where event_row.organization_id = v_actor_org
        and event_row.employment_profile_id = v_employment_id
        and event_row.event_at >= v_period_start_utc
        and event_row.event_at < v_period_end_utc
    ),
    'sessionAttendanceEvents', (
      select jsonb_build_object(
        'createdAt', max(attendance_row.created_at),
        'id', (array_agg(attendance_row.id order by attendance_row.created_at desc, attendance_row.id desc))[1],
        'rowCount', count(*)
      )
      from public.session_attendance_events attendance_row
      where attendance_row.organization_id = v_actor_org
        and attendance_row.employment_profile_id = v_employment_id
        and attendance_row.event_at >= v_period_start_utc
        and attendance_row.event_at < v_period_end_utc
    ),
    'timeCorrectionRequests', (
      select jsonb_build_object(
        'createdAt', max(correction_row.created_at),
        'id', (array_agg(correction_row.id order by correction_row.created_at desc, correction_row.id desc))[1],
        'rowCount', count(*)
      )
      from public.time_correction_requests correction_row
      join public.employee_time_events event_row
        on event_row.organization_id = correction_row.organization_id
       and event_row.id = correction_row.original_event_id
      where correction_row.organization_id = v_actor_org
        and correction_row.employment_profile_id = v_employment_id
        and event_row.event_at >= v_period_start_utc
        and event_row.event_at < v_period_end_utc
    ),
    'sessionAttendanceCorrectionRequests', (
      select jsonb_build_object(
        'createdAt', max(attendance_correction_row.created_at),
        'id', (array_agg(attendance_correction_row.id order by attendance_correction_row.created_at desc, attendance_correction_row.id desc))[1],
        'rowCount', count(*)
      )
      from public.session_attendance_correction_requests attendance_correction_row
      join public.session_attendance_events attendance_row
        on attendance_row.organization_id = attendance_correction_row.organization_id
       and attendance_row.id = attendance_correction_row.session_attendance_event_id
      where attendance_correction_row.organization_id = v_actor_org
        and attendance_correction_row.employment_profile_id = v_employment_id
        and attendance_row.event_at >= v_period_start_utc
        and attendance_row.event_at < v_period_end_utc
    ),
    'timekeepingExceptions', (
      select jsonb_build_object(
        'createdAt', max(exception_row.created_at),
        'id', (array_agg(exception_row.id order by exception_row.created_at desc, exception_row.id desc))[1],
        'rowCount', count(*)
      )
      from public.timekeeping_exceptions exception_row
      where exception_row.organization_id = v_actor_org
        and exception_row.employment_profile_id = v_employment_id
        and (
          exception_row.source_session_attendance_event_id in (
            select attendance_row.id
            from public.session_attendance_events attendance_row
            where attendance_row.organization_id = v_actor_org
              and attendance_row.employment_profile_id = v_employment_id
              and attendance_row.event_at >= v_period_start_utc
              and attendance_row.event_at < v_period_end_utc
          )
          or (
            exception_row.source_session_attendance_event_id is null
            and exception_row.created_at >= v_period_start_utc
            and exception_row.created_at < v_period_end_utc
          )
        )
    ),
    'mealResolutions', (
      select jsonb_build_object(
        'createdAt', max(resolution_row.created_at),
        'id', (array_agg(resolution_row.id order by resolution_row.created_at desc, resolution_row.id desc))[1],
        'rowCount', count(*)
      )
      from public.timesheet_meal_resolutions resolution_row
      where resolution_row.organization_id = v_actor_org
        and resolution_row.employment_profile_id = v_employment_id
        and resolution_row.pay_period_id = v_pay_period_id
    )
  )
  into v_source_high_water
  ;

  v_snapshot := jsonb_build_object(
    'employmentProfileId', v_employment_id,
    'payPeriodId', v_pay_period_id,
    'policyVersionId', v_policy_version_id,
    'period', v_period_payload,
    'sourceHighWater', coalesce(v_source_high_water, '{}'::jsonb)
  );
  v_source_hash := app.payroll_hash_payload(v_snapshot);

  v_combined_source_count :=
    coalesce((v_source_high_water #>> '{employeeTimeEvents,rowCount}')::integer, 0) +
    coalesce((v_source_high_water #>> '{sessionAttendanceEvents,rowCount}')::integer, 0) +
    coalesce((v_source_high_water #>> '{timeCorrectionRequests,rowCount}')::integer, 0) +
    coalesce((v_source_high_water #>> '{sessionAttendanceCorrectionRequests,rowCount}')::integer, 0) +
    coalesce((v_source_high_water #>> '{timekeepingExceptions,rowCount}')::integer, 0) +
    coalesce((v_source_high_water #>> '{mealResolutions,rowCount}')::integer, 0);

  with ordered_events as (
    select
      event_row.event_type,
      event_row.event_at,
      event_row.created_at,
      event_row.id,
      sum(
        case event_row.event_type
          when 'shift_started' then 1
          when 'shift_ended' then -1
          else 0
        end
      ) over (
        order by event_row.event_at, event_row.created_at, event_row.id
        rows between unbounded preceding and current row
      )::integer as shift_after,
      sum(
        case event_row.event_type
          when 'meal_started' then 1
          when 'meal_ended' then -1
          else 0
        end
      ) over (
        order by event_row.event_at, event_row.created_at, event_row.id
        rows between unbounded preceding and current row
      )::integer as meal_after
    from public.employee_time_events event_row
    where event_row.organization_id = v_actor_org
      and event_row.employment_profile_id = v_employment_id
      and event_row.event_at >= v_period_start_utc
      and event_row.event_at < v_period_end_utc
  )
  select
    coalesce((array_agg(shift_after order by event_at desc, created_at desc, id desc))[1], 0),
    coalesce((array_agg(meal_after order by event_at desc, created_at desc, id desc))[1], 0),
    coalesce(bool_or(shift_after not between 0 and 1 or meal_after not between 0 and 1 or meal_after > shift_after), false)
  into v_shift_balance, v_meal_balance, v_invalid_event_state
  from ordered_events;

  with ordered_events as (
    select
      event_row.event_type,
      event_row.event_at,
      event_row.created_at,
      event_row.id,
      lead(event_row.id) over event_order as next_event_id,
      lead(event_row.event_type) over event_order as next_event_type,
      lead(event_row.event_at) over event_order as next_event_at,
      sum(case when event_row.event_type = 'shift_started' then 1 else 0 end) over event_order as shift_number,
      sum(
        case event_row.event_type
          when 'shift_started' then 1
          when 'shift_ended' then -1
          else 0
        end
      ) over event_order as shift_after,
      sum(
        case event_row.event_type
          when 'meal_started' then 1
          when 'meal_ended' then -1
          else 0
        end
      ) over event_order as meal_after
    from public.employee_time_events event_row
    where event_row.organization_id = v_actor_org
      and event_row.employment_profile_id = v_employment_id
      and event_row.event_at >= v_period_start_utc
      and event_row.event_at < v_period_end_utc
    window event_order as (
      order by event_row.event_at, event_row.created_at, event_row.id
      rows between unbounded preceding and current row
    )
  ), shift_events as (
    select
      ordered_event.shift_number,
      (array_agg(ordered_event.id order by ordered_event.event_at, ordered_event.created_at, ordered_event.id)
        filter (where ordered_event.event_type = 'shift_started'))[1] as shift_start_event_id,
      min(ordered_event.event_at) filter (where ordered_event.event_type = 'shift_started') as shift_started_at,
      max(ordered_event.event_at) filter (where ordered_event.event_type = 'shift_ended') as shift_ended_at,
      coalesce(sum(extract(epoch from (ordered_event.next_event_at - ordered_event.event_at))) filter (
        where ordered_event.shift_after = 1 and ordered_event.meal_after = 0 and ordered_event.next_event_at is not null
      ), 0)::integer as paid_seconds
    from ordered_events ordered_event
    where ordered_event.shift_number > 0
    group by ordered_event.shift_number
  ), paid_by_shift as (
    select
      shift_number,
      shift_start_event_id,
      shift_started_at,
      shift_ended_at,
      extract(epoch from (shift_ended_at - shift_started_at))::integer as work_period_seconds,
      paid_seconds
    from shift_events
  ), meal_pairs as (
    select
      shift_number,
      id as meal_start_event_id,
      event_at as meal_started_at,
      case when next_event_type = 'meal_ended' then next_event_id end as meal_end_event_id,
      case when next_event_type = 'meal_ended' then next_event_at end as meal_ended_at,
      row_number() over (
        partition by shift_number
        order by event_at, created_at, id
      ) as meal_ordinal
    from ordered_events
    where event_type = 'meal_started'
  ), shift_facts as (
    select
      paid.shift_number,
      paid.shift_start_event_id,
      paid.shift_started_at,
      paid.shift_ended_at,
      paid.work_period_seconds,
      paid.paid_seconds,
      first_meal.meal_start_event_id as first_meal_start_event_id,
      first_meal.meal_started_at as first_meal_started_at,
      first_meal.meal_end_event_id as first_meal_end_event_id,
      first_meal.meal_ended_at as first_meal_ended_at,
      case
        when first_meal.meal_ended_at is null then 0
        else extract(epoch from (first_meal.meal_ended_at - first_meal.meal_started_at))::integer
      end as first_meal_seconds,
      second_meal.meal_start_event_id as second_meal_start_event_id,
      second_meal.meal_started_at as second_meal_started_at,
      second_meal.meal_end_event_id as second_meal_end_event_id,
      second_meal.meal_ended_at as second_meal_ended_at,
      case
        when second_meal.meal_ended_at is null then 0
        else extract(epoch from (second_meal.meal_ended_at - second_meal.meal_started_at))::integer
      end as second_meal_seconds
    from paid_by_shift paid
    left join meal_pairs first_meal
      on first_meal.shift_number = paid.shift_number
     and first_meal.meal_ordinal = 1
    left join meal_pairs second_meal
      on second_meal.shift_number = paid.shift_number
     and second_meal.meal_ordinal = 2
  ), meal_issues as (
    select
      shift_fact.shift_start_event_id,
      1 as meal_ordinal,
      shift_fact.shift_started_at + interval '5 hours' as deadline_at,
      shift_fact.first_meal_start_event_id as meal_start_event_id,
      shift_fact.first_meal_end_event_id as meal_end_event_id,
      shift_fact.work_period_seconds > 5 * 3600 as meal_required,
      shift_fact.first_meal_started_at is null as is_missing,
      shift_fact.first_meal_started_at is not null and shift_fact.first_meal_started_at > shift_fact.shift_started_at + interval '5 hours' as is_late,
      shift_fact.first_meal_started_at is not null and shift_fact.first_meal_ended_at is null as is_interrupted,
      shift_fact.first_meal_started_at is not null and shift_fact.first_meal_ended_at is not null and shift_fact.first_meal_seconds < 30 * 60 as is_short,
      shift_fact.work_period_seconds,
      shift_fact.first_meal_started_at is not null
        and shift_fact.first_meal_started_at <= shift_fact.shift_started_at + interval '5 hours'
        and shift_fact.first_meal_ended_at is not null
        and shift_fact.first_meal_seconds >= 30 * 60 as first_meal_compliant
    from shift_facts shift_fact

    union all

    select
      shift_fact.shift_start_event_id,
      2 as meal_ordinal,
      shift_fact.shift_started_at + interval '10 hours' as deadline_at,
      shift_fact.second_meal_start_event_id as meal_start_event_id,
      shift_fact.second_meal_end_event_id as meal_end_event_id,
      shift_fact.work_period_seconds > 10 * 3600 as meal_required,
      shift_fact.second_meal_started_at is null as is_missing,
      shift_fact.second_meal_started_at is not null and shift_fact.second_meal_started_at > shift_fact.shift_started_at + interval '10 hours' as is_late,
      shift_fact.second_meal_started_at is not null and shift_fact.second_meal_ended_at is null as is_interrupted,
      shift_fact.second_meal_started_at is not null and shift_fact.second_meal_ended_at is not null and shift_fact.second_meal_seconds < 30 * 60 as is_short,
      shift_fact.work_period_seconds,
      shift_fact.first_meal_started_at is not null
        and shift_fact.first_meal_started_at <= shift_fact.shift_started_at + interval '5 hours'
        and shift_fact.first_meal_ended_at is not null
        and shift_fact.first_meal_seconds >= 30 * 60 as first_meal_compliant
    from shift_facts shift_fact
  ), actual_issues as (
    select *
    from meal_issues
    where meal_required
      and (is_missing or is_late or is_short or is_interrupted)
  ), resolution_validation as (
    select
      resolution_row.id,
      issue.shift_start_event_id,
      resolution_row.meal_ordinal,
      resolution_row.resolution_code,
      issue.deadline_at,
      issue.work_period_seconds,
      issue.first_meal_compliant,
      issue.is_missing,
      issue.is_late,
      issue.is_short,
      issue.is_interrupted,
      (
        issue.shift_start_event_id is not null
        and resolution_row.deadline_at = issue.deadline_at
        and coalesce(resolution_row.meal_start_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(issue.meal_start_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(resolution_row.meal_end_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(issue.meal_end_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (
          (resolution_row.resolution_code = 'waived_first_meal'
            and resolution_row.meal_ordinal = 1
            and issue.is_missing
            and issue.work_period_seconds > 5 * 3600
            and issue.work_period_seconds <= 6 * 3600)
          or (resolution_row.resolution_code = 'waived_second_meal'
            and resolution_row.meal_ordinal = 2
            and issue.is_missing
            and issue.work_period_seconds > 10 * 3600
            and issue.work_period_seconds <= 12 * 3600
            and issue.first_meal_compliant)
          or (resolution_row.resolution_code in ('premium_owed', 'premium_not_owed'))
        )
      ) as is_valid
    from public.timesheet_meal_resolutions resolution_row
    left join actual_issues issue
      on issue.shift_start_event_id = resolution_row.shift_start_event_id
     and issue.meal_ordinal = resolution_row.meal_ordinal
    where resolution_row.organization_id = v_actor_org
      and resolution_row.employment_profile_id = v_employment_id
      and resolution_row.pay_period_id = v_pay_period_id
  )
  select
    coalesce(bool_or(resolution_row.id is null), false),
    coalesce(bool_or(not resolution_row.is_valid), false)
  into v_unresolved_meal, v_invalid_meal_resolution
  from (
    select issue.shift_start_event_id, issue.meal_ordinal, validation.id, validation.is_valid
    from actual_issues issue
    left join resolution_validation validation
      on validation.shift_start_event_id = issue.shift_start_event_id
     and validation.meal_ordinal = issue.meal_ordinal

    union all

    select validation.shift_start_event_id, validation.meal_ordinal, validation.id, validation.is_valid
    from resolution_validation validation
  ) resolution_row;

  if v_combined_source_count > 500 then
    v_block_code := 'event_limit_exceeded';
    v_block_message := 'Timesheet derivation is capped at 500 combined source rows.';
  elsif v_shift_balance <> 0 or v_meal_balance <> 0 or v_invalid_event_state then
    v_block_code := 'open_shift';
    v_block_message := 'Payroll time events do not form closed, ordered shifts and meals.';
  elsif coalesce((v_source_high_water #>> '{timeCorrectionRequests,rowCount}')::integer, 0) > 0
    or coalesce((v_source_high_water #>> '{sessionAttendanceCorrectionRequests,rowCount}')::integer, 0) > 0
  then
    v_block_code := 'correction_pending_review';
    v_block_message := 'Correction requests require review before derivation.';
  elsif coalesce((v_source_high_water #>> '{timekeepingExceptions,rowCount}')::integer, 0) > 0 then
    v_block_code := 'source_exception';
    v_block_message := 'Unresolved timekeeping exceptions require review before derivation.';
  elsif jsonb_array_length(coalesce(v_period_payload -> 'rateVersions', '[]'::jsonb)) = 0 then
    v_block_code := 'missing_rate';
    v_block_message := 'An active hourly rate must cover all paid time.';
  elsif v_invalid_meal_resolution then
    v_block_code := 'invalid_meal_resolution';
    v_block_message := 'Meal resolution rows must match an actual shift-scoped meal issue exactly.';
  elsif v_unresolved_meal then
    v_block_code := 'meal_unresolved';
    v_block_message := 'A required meal is missing, late, short, or interrupted.';
  end if;

  if v_block_code is not null then
    v_existing_snapshot := jsonb_build_object(
      'state', 'blocked',
      'snapshotId', null,
      'sourceHash', v_source_hash,
      'replayed', false,
      'lockable', false,
      'period', v_period_payload,
      'sourceHighWater', coalesce(v_source_high_water, '{}'::jsonb),
      'totals', jsonb_build_object(
        'regularSeconds', 0,
        'overtimeSeconds', 0,
        'doubleTimeSeconds', 0,
        'mealPremiumCents', 0,
        'grossEarningsCents', 0
      ),
      'segments', '[]'::jsonb,
      'exceptions', jsonb_build_array(jsonb_build_object(
        'code', v_block_code,
        'blocking', true,
        'message', v_block_message
      ))
    );
    return app.record_blocked_timesheet_derivation(
      v_actor_org, v_actor, p_idempotency_key, v_payload_hash, v_existing_snapshot
    );
  end if;

  select snapshot_row.id,
         jsonb_build_object(
           'snapshotId', snapshot_row.id,
           'sourceHash', snapshot_row.source_hash,
           'replayed', true
         )
  into v_existing_snapshot_id, v_existing_snapshot
  from public.timesheet_snapshot_current_heads head_row
  join public.timesheet_snapshots snapshot_row
    on snapshot_row.id = head_row.snapshot_id
   and snapshot_row.organization_id = head_row.organization_id
  where head_row.organization_id = v_actor_org
    and head_row.employment_profile_id = v_employment_id
    and head_row.pay_period_id = v_pay_period_id
    and head_row.source_hash = v_source_hash
  order by head_row.created_at desc, head_row.id desc
  limit 1;

  if v_existing_snapshot_id is not null then
    insert into public.payroll_mutation_receipts (
      organization_id,
      actor_user_id,
      operation,
      idempotency_key,
      payload_hash,
      result_payload
    ) values (
      v_actor_org,
      v_actor,
      'derive_timesheet_snapshot',
      p_idempotency_key,
      v_payload_hash,
      v_existing_snapshot
    );

    return v_existing_snapshot;
  end if;

  with ordered_events as (
    select
      event_row.event_at,
      event_row.created_at,
      event_row.id,
      lead(event_row.event_at) over event_order as next_event_at,
      sum(
        case event_row.event_type
          when 'shift_started' then 1
          when 'shift_ended' then -1
          else 0
        end
      ) over event_order as shift_after,
      sum(
        case event_row.event_type
          when 'meal_started' then 1
          when 'meal_ended' then -1
          else 0
        end
      ) over event_order as meal_after
    from public.employee_time_events event_row
    where event_row.organization_id = v_actor_org
      and event_row.employment_profile_id = v_employment_id
      and event_row.event_at >= v_period_start_utc
      and event_row.event_at < v_period_end_utc
    window event_order as (
      order by event_row.event_at, event_row.created_at, event_row.id
      rows between unbounded preceding and current row
    )
  ), paid_intervals as (
    select event_at as interval_start, next_event_at as interval_end
    from ordered_events
    where shift_after = 1
      and meal_after = 0
      and next_event_at > event_at
  ), workdays as (
    select
      day_key::date,
      ((day_key::date + (v_period_payload ->> 'workdayStartsAt')::time) at time zone (v_period_payload ->> 'timezone')) as day_start,
      (((day_key::date + 1) + (v_period_payload ->> 'workdayStartsAt')::time) at time zone (v_period_payload ->> 'timezone')) as day_end,
      (
        day_key::date
        - (
          (
            extract(dow from day_key::date)::integer
            - coalesce((v_period_payload ->> 'workweekStartsOn')::integer, 0)
            + 7
          ) % 7
        )
      )::date as week_key
    from generate_series(
      ((v_period_payload ->> 'periodStart')::date - 1),
      (v_period_payload ->> 'periodEnd')::date,
      interval '1 day'
    ) day_key
  ), day_slices as (
    select
      greatest(paid.interval_start, workday.day_start) as slice_start,
      least(paid.interval_end, workday.day_end) as slice_end,
      workday.day_key,
      workday.week_key
    from paid_intervals paid
    join workdays workday
      on paid.interval_start < workday.day_end
     and paid.interval_end > workday.day_start
  ), worked_days as (
    select distinct
      day_slice.week_key,
      day_slice.day_key
    from day_slices day_slice
  ), ordered_worked_days as (
    select
      worked_day.week_key,
      worked_day.day_key,
      row_number() over (
        partition by worked_day.week_key
        order by worked_day.day_key
      ) as day_rank,
      (
        worked_day.day_key
        - (
          row_number() over (
            partition by worked_day.week_key
            order by worked_day.day_key
          )
        )::integer
      ) as streak_group
    from worked_days worked_day
  ), worked_day_streaks as (
    select
      ordered_day.week_key,
      ordered_day.day_key,
      ordered_day.day_rank,
      row_number() over (
        partition by ordered_day.week_key, ordered_day.streak_group
        order by ordered_day.day_key
      )::integer as streak
    from ordered_worked_days ordered_day
  ), rate_slices as (
    select
      greatest(day_slice.slice_start, rate_row.effective_from) as slice_start,
      least(day_slice.slice_end, coalesce(rate_row.effective_through, 'infinity'::timestamptz)) as slice_end,
      day_slice.day_key,
      day_slice.week_key,
      rate_row.id as rate_version_id,
      rate_row.hourly_rate_cents,
      round(extract(epoch from (
        least(day_slice.slice_end, coalesce(rate_row.effective_through, 'infinity'::timestamptz)) -
        greatest(day_slice.slice_start, rate_row.effective_from)
      )))::integer as seconds
    from day_slices day_slice
    join public.employee_rate_versions rate_row
      on rate_row.organization_id = v_actor_org
     and rate_row.employment_profile_id = v_employment_id
     and rate_row.effective_from < day_slice.slice_end
     and coalesce(rate_row.effective_through, 'infinity'::timestamptz) > day_slice.slice_start
  ), slices_with_offsets as (
    select
      rate_slice.*,
      coalesce(sum(rate_slice.seconds) over (
        partition by rate_slice.day_key
        order by rate_slice.slice_start, rate_slice.slice_end, rate_slice.rate_version_id
        rows between unbounded preceding and 1 preceding
      ), 0)::integer as seconds_before
    from rate_slices rate_slice
    where rate_slice.seconds > 0
  ), preliminary_classified as (
    select
      slice.day_key,
      slice.week_key,
      slice.rate_version_id,
      slice.hourly_rate_cents,
      bucket.bucket,
      greatest(0, least(slice.seconds_before + slice.seconds, bucket.ceiling_seconds) - greatest(slice.seconds_before, bucket.floor_seconds))::integer as seconds,
      slice.slice_start + make_interval(secs => greatest(slice.seconds_before, bucket.floor_seconds) - slice.seconds_before) as segment_start,
      slice.slice_start + make_interval(secs => least(slice.seconds_before + slice.seconds, bucket.ceiling_seconds) - slice.seconds_before) as segment_end
    from slices_with_offsets slice
    join worked_day_streaks streak_row
      on streak_row.week_key = slice.week_key
     and streak_row.day_key = slice.day_key
    cross join lateral (
      values
        ('regular'::text, 0, 8 * 3600, streak_row.streak < 7),
        ('overtime'::text, case when streak_row.streak >= 7 then 0 else 8 * 3600 end, case when streak_row.streak >= 7 then 8 * 3600 else 12 * 3600 end, true),
        ('doubletime'::text, case when streak_row.streak >= 7 then 8 * 3600 else 12 * 3600 end, 2147483647, true)
    ) as bucket(bucket, floor_seconds, ceiling_seconds, enabled)
    where bucket.enabled
      and least(slice.seconds_before + slice.seconds, bucket.ceiling_seconds) > greatest(slice.seconds_before, bucket.floor_seconds)
  ), regular_segments_with_week_offsets as (
    select
      classified.*,
      coalesce(sum(classified.seconds) over (
        partition by classified.week_key
        order by classified.segment_start, classified.segment_end, classified.rate_version_id
        rows between unbounded preceding and 1 preceding
      ), 0)::integer as week_regular_seconds_before
    from preliminary_classified classified
    where classified.bucket = 'regular'
  ), classified as (
    select
      classified.day_key,
      classified.week_key,
      classified.rate_version_id,
      classified.hourly_rate_cents,
      classified.bucket,
      classified.seconds,
      classified.segment_start,
      classified.segment_end
    from preliminary_classified classified
    where classified.bucket <> 'regular'

    union all

    select
      regular_segment.day_key,
      regular_segment.week_key,
      regular_segment.rate_version_id,
      regular_segment.hourly_rate_cents,
      bucket.bucket,
      greatest(
        0,
        least(regular_segment.week_regular_seconds_before + regular_segment.seconds, bucket.ceiling_seconds)
        - greatest(regular_segment.week_regular_seconds_before, bucket.floor_seconds)
      )::integer as seconds,
      regular_segment.segment_start + make_interval(
        secs => greatest(regular_segment.week_regular_seconds_before, bucket.floor_seconds) - regular_segment.week_regular_seconds_before
      ) as segment_start,
      regular_segment.segment_start + make_interval(
        secs => least(regular_segment.week_regular_seconds_before + regular_segment.seconds, bucket.ceiling_seconds) - regular_segment.week_regular_seconds_before
      ) as segment_end
    from regular_segments_with_week_offsets regular_segment
    cross join lateral (
      values
        ('regular'::text, 0, 40 * 3600),
        ('overtime'::text, 40 * 3600, 2147483647)
    ) as bucket(bucket, floor_seconds, ceiling_seconds)
    where least(regular_segment.week_regular_seconds_before + regular_segment.seconds, bucket.ceiling_seconds)
      > greatest(regular_segment.week_regular_seconds_before, bucket.floor_seconds)
  ), final_segments as (
    select
      classified.*,
      case classified.bucket
        when 'regular' then round(classified.hourly_rate_cents::numeric * classified.seconds::numeric / 3600)::integer
        when 'overtime' then round(classified.hourly_rate_cents::numeric * classified.seconds::numeric * 3 / 7200)::integer
        else round(classified.hourly_rate_cents::numeric * classified.seconds::numeric * 2 / 3600)::integer
      end as gross_cents
    from classified
    where classified.seconds > 0
  ), totals as (
    select
      coalesce(sum(seconds) filter (where bucket = 'regular'), 0)::integer as regular_seconds,
      coalesce(sum(seconds) filter (where bucket = 'overtime'), 0)::integer as overtime_seconds,
      coalesce(sum(seconds) filter (where bucket = 'doubletime'), 0)::integer as double_time_seconds,
      coalesce(sum(gross_cents), 0)::integer as gross_earnings_cents,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'bucket', bucket,
          'startAt', segment_start,
          'endAt', segment_end,
          'seconds', seconds,
          'dayKey', day_key,
          'weekKey', week_key,
          'rateVersionId', rate_version_id,
          'hourlyRateCents', hourly_rate_cents,
          'grossCents', gross_cents
        ) order by segment_start, segment_end, bucket, rate_version_id
      ), '[]'::jsonb) as segments
    from final_segments
  )
  select
    totals.regular_seconds,
    totals.overtime_seconds,
    totals.double_time_seconds,
    totals.gross_earnings_cents,
    totals.segments,
    (select coalesce(sum(extract(epoch from (interval_end - interval_start))), 0)::integer from paid_intervals),
    (select coalesce(sum(seconds), 0)::integer from rate_slices)
  into
    v_regular_seconds,
    v_overtime_seconds,
    v_double_time_seconds,
    v_gross_earnings_cents,
    v_segments,
    v_paid_seconds,
    v_rate_covered_seconds
  from totals;

  with ordered_events as (
    select
      event_row.event_type,
      event_row.event_at,
      event_row.created_at,
      event_row.id,
      lead(event_row.id) over event_order as next_event_id,
      lead(event_row.event_type) over event_order as next_event_type,
      lead(event_row.event_at) over event_order as next_event_at,
      sum(case when event_row.event_type = 'shift_started' then 1 else 0 end) over event_order as shift_number,
      sum(
        case event_row.event_type
          when 'shift_started' then 1
          when 'shift_ended' then -1
          else 0
        end
      ) over event_order as shift_after,
      sum(
        case event_row.event_type
          when 'meal_started' then 1
          when 'meal_ended' then -1
          else 0
        end
      ) over event_order as meal_after
    from public.employee_time_events event_row
    where event_row.organization_id = v_actor_org
      and event_row.employment_profile_id = v_employment_id
      and event_row.event_at >= v_period_start_utc
      and event_row.event_at < v_period_end_utc
    window event_order as (
      order by event_row.event_at, event_row.created_at, event_row.id
      rows between unbounded preceding and current row
    )
  ), shift_events as (
    select
      ordered_event.shift_number,
      (array_agg(ordered_event.id order by ordered_event.event_at, ordered_event.created_at, ordered_event.id)
        filter (where ordered_event.event_type = 'shift_started'))[1] as shift_start_event_id,
      min(ordered_event.event_at) filter (where ordered_event.event_type = 'shift_started') as shift_started_at,
      max(ordered_event.event_at) filter (where ordered_event.event_type = 'shift_ended') as shift_ended_at,
      coalesce(sum(extract(epoch from (ordered_event.next_event_at - ordered_event.event_at))) filter (
        where ordered_event.shift_after = 1 and ordered_event.meal_after = 0 and ordered_event.next_event_at is not null
      ), 0)::integer as paid_seconds
    from ordered_events ordered_event
    where ordered_event.shift_number > 0
    group by ordered_event.shift_number
  ), paid_by_shift as (
    select
      shift_number,
      shift_start_event_id,
      shift_started_at,
      shift_ended_at,
      extract(epoch from (shift_ended_at - shift_started_at))::integer as work_period_seconds,
      paid_seconds
    from shift_events
  ), meal_pairs as (
    select
      shift_number,
      id as meal_start_event_id,
      event_at as meal_started_at,
      case when next_event_type = 'meal_ended' then next_event_id end as meal_end_event_id,
      case when next_event_type = 'meal_ended' then next_event_at end as meal_ended_at,
      row_number() over (
        partition by shift_number
        order by event_at, created_at, id
      ) as meal_ordinal
    from ordered_events
    where event_type = 'meal_started'
  ), shift_facts as (
    select
      shift_event.shift_start_event_id,
      shift_event.shift_started_at,
      paid_by_shift.paid_seconds,
      extract(epoch from (shift_event.shift_ended_at - shift_event.shift_started_at))::integer as work_period_seconds,
      first_meal.meal_start_event_id as first_meal_start_event_id,
      first_meal.meal_started_at as first_meal_started_at,
      first_meal.meal_end_event_id as first_meal_end_event_id,
      first_meal.meal_ended_at as first_meal_ended_at,
      case
        when first_meal.meal_ended_at is null then 0
        else extract(epoch from (first_meal.meal_ended_at - first_meal.meal_started_at))::integer
      end as first_meal_seconds,
      second_meal.meal_start_event_id as second_meal_start_event_id,
      second_meal.meal_started_at as second_meal_started_at,
      second_meal.meal_end_event_id as second_meal_end_event_id,
      second_meal.meal_ended_at as second_meal_ended_at,
      case
        when second_meal.meal_ended_at is null then 0
        else extract(epoch from (second_meal.meal_ended_at - second_meal.meal_started_at))::integer
      end as second_meal_seconds
    from shift_events shift_event
    join paid_by_shift
      on paid_by_shift.shift_start_event_id = shift_event.shift_start_event_id
    left join meal_pairs first_meal
      on first_meal.shift_number = shift_event.shift_number
     and first_meal.meal_ordinal = 1
    left join meal_pairs second_meal
      on second_meal.shift_number = shift_event.shift_number
     and second_meal.meal_ordinal = 2
  ), meal_issues as (
    select
      shift_fact.shift_start_event_id,
      1 as meal_ordinal,
      shift_fact.shift_started_at + interval '5 hours' as deadline_at,
      shift_fact.first_meal_start_event_id as meal_start_event_id,
      shift_fact.first_meal_end_event_id as meal_end_event_id,
      shift_fact.work_period_seconds > 5 * 3600 as meal_required,
      shift_fact.first_meal_started_at is null as is_missing,
      shift_fact.first_meal_started_at is not null and shift_fact.first_meal_started_at > shift_fact.shift_started_at + interval '5 hours' as is_late,
      shift_fact.first_meal_started_at is not null and shift_fact.first_meal_ended_at is null as is_interrupted,
      shift_fact.first_meal_started_at is not null and shift_fact.first_meal_ended_at is not null and shift_fact.first_meal_seconds < 30 * 60 as is_short,
      shift_fact.work_period_seconds,
      shift_fact.first_meal_started_at is not null
        and shift_fact.first_meal_started_at <= shift_fact.shift_started_at + interval '5 hours'
        and shift_fact.first_meal_ended_at is not null
        and shift_fact.first_meal_seconds >= 30 * 60 as first_meal_compliant
    from shift_facts shift_fact

    union all

    select
      shift_fact.shift_start_event_id,
      2 as meal_ordinal,
      shift_fact.shift_started_at + interval '10 hours' as deadline_at,
      shift_fact.second_meal_start_event_id as meal_start_event_id,
      shift_fact.second_meal_end_event_id as meal_end_event_id,
      shift_fact.work_period_seconds > 10 * 3600 as meal_required,
      shift_fact.second_meal_started_at is null as is_missing,
      shift_fact.second_meal_started_at is not null and shift_fact.second_meal_started_at > shift_fact.shift_started_at + interval '10 hours' as is_late,
      shift_fact.second_meal_started_at is not null and shift_fact.second_meal_ended_at is null as is_interrupted,
      shift_fact.second_meal_started_at is not null and shift_fact.second_meal_ended_at is not null and shift_fact.second_meal_seconds < 30 * 60 as is_short,
      shift_fact.work_period_seconds,
      shift_fact.first_meal_started_at is not null
        and shift_fact.first_meal_started_at <= shift_fact.shift_started_at + interval '5 hours'
        and shift_fact.first_meal_ended_at is not null
        and shift_fact.first_meal_seconds >= 30 * 60 as first_meal_compliant
    from shift_facts shift_fact
  ), actual_issues as (
    select *
    from meal_issues
    where meal_required
      and (is_missing or is_late or is_short or is_interrupted)
  ), resolution_validation as (
    select
      resolution_row.id,
      resolution_row.shift_start_event_id,
      resolution_row.meal_ordinal,
      resolution_row.deadline_at,
      resolution_row.resolution_code,
      issue.meal_start_event_id,
      issue.meal_end_event_id,
      (
        issue.shift_start_event_id is not null
        and resolution_row.deadline_at = issue.deadline_at
        and coalesce(resolution_row.meal_start_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(issue.meal_start_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(resolution_row.meal_end_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(issue.meal_end_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (
          (resolution_row.resolution_code = 'waived_first_meal'
            and resolution_row.meal_ordinal = 1
            and issue.is_missing
            and issue.work_period_seconds > 5 * 3600
            and issue.work_period_seconds <= 6 * 3600)
          or (resolution_row.resolution_code = 'waived_second_meal'
            and resolution_row.meal_ordinal = 2
            and issue.is_missing
            and issue.work_period_seconds > 10 * 3600
            and issue.work_period_seconds <= 12 * 3600
            and issue.first_meal_compliant)
          or (resolution_row.resolution_code in ('premium_owed', 'premium_not_owed'))
        )
      ) as is_valid
    from public.timesheet_meal_resolutions resolution_row
    left join actual_issues issue
      on issue.shift_start_event_id = resolution_row.shift_start_event_id
     and issue.meal_ordinal = resolution_row.meal_ordinal
    where resolution_row.organization_id = v_actor_org
      and resolution_row.employment_profile_id = v_employment_id
      and resolution_row.pay_period_id = v_pay_period_id
  ), premium_candidates as (
    select
      resolution_validation.id,
      resolution_validation.shift_start_event_id,
      resolution_validation.meal_ordinal,
      resolution_validation.deadline_at,
      rate_row.id as rate_version_id,
      rate_row.hourly_rate_cents
    from resolution_validation
    left join public.employee_rate_versions rate_row
      on rate_row.organization_id = v_actor_org
     and rate_row.employment_profile_id = v_employment_id
     and resolution_validation.deadline_at >= rate_row.effective_from
     and resolution_validation.deadline_at < coalesce(rate_row.effective_through, 'infinity'::timestamptz)
    where resolution_validation.is_valid
      and resolution_validation.resolution_code = 'premium_owed'
  ), invalid_premium_rates as (
    select premium_candidate.id
    from premium_candidates premium_candidate
    group by premium_candidate.id
    having count(premium_candidate.rate_version_id) <> 1
  ), premium_lines as (
    select
      premium_candidate.shift_start_event_id,
      premium_candidate.meal_ordinal,
      premium_candidate.deadline_at,
      (array_agg(premium_candidate.rate_version_id order by premium_candidate.rate_version_id))[1] as rate_version_id,
      max(premium_candidate.hourly_rate_cents)::integer as cents
    from premium_candidates premium_candidate
    where premium_candidate.rate_version_id is not null
    group by premium_candidate.shift_start_event_id, premium_candidate.meal_ordinal, premium_candidate.deadline_at
  )
  select
    exists(select 1 from invalid_premium_rates),
    coalesce(sum(premium_line.cents), 0)::integer,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'shiftStartEventId', premium_line.shift_start_event_id,
        'mealOrdinal', premium_line.meal_ordinal,
        'deadlineAt', premium_line.deadline_at,
        'rateVersionId', premium_line.rate_version_id,
        'cents', premium_line.cents
      )
      order by premium_line.deadline_at, premium_line.shift_start_event_id, premium_line.meal_ordinal
    ), '[]'::jsonb)
  into
    v_missing_meal_premium_rate,
    v_meal_premium_cents,
    v_meal_premium_lines
  from premium_lines premium_line;

  if v_paid_seconds <> v_rate_covered_seconds
    or v_paid_seconds <> v_regular_seconds + v_overtime_seconds + v_double_time_seconds
  then
    v_existing_snapshot := jsonb_build_object(
      'state', 'blocked',
      'snapshotId', null,
      'sourceHash', v_source_hash,
      'replayed', false,
      'lockable', false,
      'period', v_period_payload,
      'sourceHighWater', coalesce(v_source_high_water, '{}'::jsonb),
      'totals', jsonb_build_object(
        'regularSeconds', 0,
        'overtimeSeconds', 0,
        'doubleTimeSeconds', 0,
        'mealPremiumCents', 0,
        'grossEarningsCents', 0
      ),
      'segments', '[]'::jsonb,
      'exceptions', jsonb_build_array(jsonb_build_object(
        'code', 'missing_rate',
        'blocking', true,
        'message', 'Every paid second must resolve to one rate and one earnings bucket.'
      ))
    );
    return app.record_blocked_timesheet_derivation(
      v_actor_org, v_actor, p_idempotency_key, v_payload_hash, v_existing_snapshot
    );
  end if;

  if v_missing_meal_premium_rate then
    v_existing_snapshot := jsonb_build_object(
      'state', 'blocked',
      'snapshotId', null,
      'sourceHash', v_source_hash,
      'replayed', false,
      'lockable', false,
      'period', v_period_payload,
      'sourceHighWater', coalesce(v_source_high_water, '{}'::jsonb),
      'totals', jsonb_build_object(
        'regularSeconds', 0,
        'overtimeSeconds', 0,
        'doubleTimeSeconds', 0,
        'mealPremiumCents', 0,
        'grossEarningsCents', 0
      ),
      'segments', '[]'::jsonb,
      'exceptions', jsonb_build_array(jsonb_build_object(
        'code', 'missing_rate',
        'blocking', true,
        'message', 'Every meal premium deadline must resolve to exactly one base hourly rate.'
      ))
    );
    return app.record_blocked_timesheet_derivation(
      v_actor_org, v_actor, p_idempotency_key, v_payload_hash, v_existing_snapshot
    );
  end if;

  v_gross_earnings_cents := v_gross_earnings_cents + v_meal_premium_cents;

  v_snapshot := v_snapshot || jsonb_build_object(
    'segments', v_segments,
    'mealPremiums', v_meal_premium_lines,
    'totals', jsonb_build_object(
      'regularSeconds', v_regular_seconds,
      'overtimeSeconds', v_overtime_seconds,
      'doubleTimeSeconds', v_double_time_seconds,
      'mealPremiumCents', v_meal_premium_cents,
      'grossEarningsCents', v_gross_earnings_cents
    )
  );

  select head_row.snapshot_id
  into v_current_head_snapshot_id
  from public.timesheet_snapshot_current_heads head_row
  where head_row.organization_id = v_actor_org
    and head_row.employment_profile_id = v_employment_id
    and head_row.pay_period_id = v_pay_period_id
  order by head_row.created_at desc, head_row.id desc
  limit 1;

  insert into public.timesheet_snapshots (
    id,
    organization_id,
    employment_profile_id,
    pay_period_id,
    policy_version_id,
    source_hash,
    source_high_water,
    canonical_payload,
    regular_seconds,
    overtime_seconds,
    double_time_seconds,
    meal_premium_cents,
    gross_earnings_cents,
    lockable,
    created_by
  ) values (
    v_snapshot_id,
    v_actor_org,
    v_employment_id,
    v_pay_period_id,
    v_policy_version_id,
    v_source_hash,
    coalesce(v_source_high_water, '{}'::jsonb),
    v_snapshot,
    v_regular_seconds,
    v_overtime_seconds,
    v_double_time_seconds,
    v_meal_premium_cents,
    v_gross_earnings_cents,
    true,
    v_actor
  );

  insert into public.timesheet_snapshot_lines (
    organization_id,
    snapshot_id,
    employment_profile_id,
    pay_period_id,
    line_type,
    line_code,
    line_payload
  )
  select
    v_actor_org,
    v_snapshot_id,
    v_employment_id,
    v_pay_period_id,
    'segment',
    segment_row ->> 'bucket',
    segment_row
  from jsonb_array_elements(v_segments) segment_row;

  insert into public.timesheet_snapshot_lines (
    organization_id,
    snapshot_id,
    employment_profile_id,
    pay_period_id,
    line_type,
    line_code,
    line_payload
  )
  select
    v_actor_org,
    v_snapshot_id,
    v_employment_id,
    v_pay_period_id,
    'premium',
    'meal',
    premium_row
  from jsonb_array_elements(v_meal_premium_lines) premium_row;

  insert into public.timesheet_snapshot_lines (
    organization_id,
    snapshot_id,
    employment_profile_id,
    pay_period_id,
    line_type,
    line_code,
    line_payload
  ) values (
    v_actor_org,
    v_snapshot_id,
    v_employment_id,
    v_pay_period_id,
    'summary',
    'totals',
    jsonb_build_object(
      'regularSeconds', v_regular_seconds,
      'overtimeSeconds', v_overtime_seconds,
      'doubleTimeSeconds', v_double_time_seconds,
      'mealPremiumCents', v_meal_premium_cents,
      'grossEarningsCents', v_gross_earnings_cents
    )
  );

  insert into public.timesheet_snapshot_current_heads (
    organization_id,
    employment_profile_id,
    pay_period_id,
    snapshot_id,
    source_hash,
    prior_snapshot_id,
    created_by
  ) values (
    v_actor_org,
    v_employment_id,
    v_pay_period_id,
    v_snapshot_id,
    v_source_hash,
    v_current_head_snapshot_id,
    v_actor
  );

  insert into public.payroll_audit_events (
    organization_id,
    actor_user_id,
    operation,
    target_table,
    target_row_id,
    payload
  ) values (
    v_actor_org,
    v_actor,
    'derive_timesheet_snapshot',
    'timesheet_snapshots',
    v_snapshot_id,
    jsonb_build_object(
      'sourceHash', v_source_hash,
      'payPeriodId', v_pay_period_id,
      'previousSnapshotId', v_current_head_snapshot_id
    )
  );

  v_existing_snapshot := jsonb_build_object(
    'snapshotId', v_snapshot_id,
    'sourceHash', v_source_hash,
    'replayed', false
  );

  insert into public.payroll_mutation_receipts (
    organization_id,
    actor_user_id,
    operation,
    idempotency_key,
    payload_hash,
    result_payload
  ) values (
    v_actor_org,
    v_actor,
    'derive_timesheet_snapshot',
    p_idempotency_key,
    v_payload_hash,
    v_existing_snapshot
  );

  return v_existing_snapshot;
end;
$$;

revoke all on function public.get_payroll_timesheet_period(date) from public, anon;
revoke all on function public.derive_timesheet_snapshot(date, text) from public, anon;
revoke all on function app.record_blocked_timesheet_derivation(uuid, uuid, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.get_payroll_timesheet_period(date) to authenticated, service_role;
grant execute on function public.derive_timesheet_snapshot(date, text) to authenticated, service_role;

commit;
