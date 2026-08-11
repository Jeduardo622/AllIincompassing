-- @migration-intent: payroll_timekeeping_foundation
-- @migration-dependencies: 20260810222545_bt_closeout_legacy_therapist_compat.sql
-- @migration-rollback: Drop the payroll foundation tables, triggers, policies, and RPCs, then remove the payroll_timekeeping_v1 feature flag seed and inactive baseline policy row.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

create extension if not exists btree_gist with schema extensions;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'therapists_id_organization_id_key'
      and conrelid = 'public.therapists'::regclass
  ) then
    alter table public.therapists
      add constraint therapists_id_organization_id_key unique (id, organization_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_id_organization_id_key'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_id_organization_id_key unique (id, organization_id);
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_capability') then
    create type public.payroll_capability as enum (
      'time.clock_self',
      'time.view_self',
      'time.request_correction_self',
      'time.review_assigned',
      'time.approve_assigned',
      'session_attendance.record_assigned',
      'payroll.configure_employment',
      'payroll.resolve_exceptions',
      'payroll.lock_period',
      'payroll.reopen_period',
      'payroll.export_period',
      'payroll.view_compensation'
    );
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_event_type') then
    create type public.payroll_event_type as enum (
      'shift_started',
      'shift_ended',
      'meal_started',
      'meal_ended',
      'work_category_changed'
    );
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'session_attendance_event_type') then
    create type public.session_attendance_event_type as enum (
      'session_started',
      'session_ended'
    );
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'work_category') then
    create type public.work_category as enum (
      'direct_service',
      'administration',
      'travel',
      'training'
    );
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'work_location') then
    create type public.work_location as enum (
      'client_site',
      'office',
      'home',
      'community',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_policy_activation_status') then
    create type public.payroll_policy_activation_status as enum (
      'inactive',
      'active'
    );
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'pay_group_cadence') then
    create type public.pay_group_cadence as enum (
      'weekly',
      'biweekly',
      'monthly'
    );
  end if;
end;
$$;

create table if not exists public.employment_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  employee_number text not null,
  payroll_employee_id text not null,
  classification text not null check (classification in ('nonexempt')),
  home_jurisdiction text not null check (home_jurisdiction in ('CA', 'TX', 'AZ')),
  timezone text not null,
  active_from date not null,
  active_through date,
  therapist_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, employee_number),
  unique (organization_id, payroll_employee_id),
  unique (organization_id, user_id, active_from),
  unique (id, organization_id),
  foreign key (therapist_id, organization_id)
    references public.therapists(id, organization_id) on delete restrict,
  check (active_through is null or active_through >= active_from)
);

alter table public.employment_profiles
  add constraint employment_profiles_single_active_org_per_user
  exclude using gist (
    user_id with =,
    daterange(active_from, coalesce(active_through + 1, 'infinity'::date), '[)') with &&
  );

create table if not exists public.payroll_organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  external_payroll_organization_id text not null,
  timezone text not null,
  workday_starts_at time not null default time '00:00',
  workweek_starts_on smallint not null default 0 check (workweek_starts_on between 0 and 6),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id),
  unique (external_payroll_organization_id),
  unique (id, organization_id)
);

create table if not exists public.employee_rate_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  hourly_rate_cents integer not null check (hourly_rate_cents > 0),
  effective_from timestamptz not null,
  effective_through timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  check (effective_through is null or effective_through > effective_from)
);

alter table public.employee_rate_versions
  add constraint employee_rate_versions_no_overlap
  exclude using gist (
    employment_profile_id with =,
    tstzrange(effective_from, coalesce(effective_through, 'infinity'::timestamptz), '[)') with &&
  );

create table if not exists public.pay_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  cadence public.pay_group_cadence not null,
  timezone text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table if not exists public.pay_group_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  pay_group_id uuid not null,
  effective_from date not null,
  effective_through date,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (pay_group_id, organization_id)
    references public.pay_groups(id, organization_id) on delete restrict,
  check (effective_through is null or effective_through >= effective_from)
);

alter table public.pay_group_assignments
  add constraint pay_group_assignments_no_overlap
  exclude using gist (
    employment_profile_id with =,
    daterange(effective_from, coalesce(effective_through + 1, 'infinity'::date), '[)') with &&
  );

create table if not exists public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  pay_group_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  locked_at timestamptz,
  exported_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  unique (organization_id, pay_group_id, starts_on, ends_on),
  foreign key (pay_group_id, organization_id)
    references public.pay_groups(id, organization_id) on delete restrict,
  check (ends_on >= starts_on)
);

create table if not exists public.payroll_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  jurisdiction text not null check (jurisdiction in ('CA', 'TX', 'AZ')),
  policy_name text not null,
  activation_status public.payroll_policy_activation_status not null default 'inactive',
  supports_monthly_nonexempt boolean not null default false,
  effective_from date not null default current_date,
  effective_through date,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  check (effective_through is null or effective_through >= effective_from)
);

create table if not exists public.payroll_capability_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  capability public.payroll_capability not null,
  effective_from timestamptz not null default timezone('utc', now()),
  effective_through timestamptz,
  granted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  check (effective_through is null or effective_through > effective_from)
);

create unique index if not exists payroll_capability_grants_active_uidx
  on public.payroll_capability_grants (organization_id, user_id, capability, effective_from);

create table if not exists public.employee_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  manager_user_id uuid not null references auth.users(id) on delete restrict,
  effective_from timestamptz not null,
  effective_through timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  check (effective_through is null or effective_through > effective_from)
);

alter table public.employee_manager_assignments
  add constraint employee_manager_assignments_no_overlap
  exclude using gist (
    employment_profile_id with =,
    tstzrange(effective_from, coalesce(effective_through, 'infinity'::timestamptz), '[)') with &&
  );

create table if not exists public.payroll_mutation_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation text not null,
  idempotency_key text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result_payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, actor_user_id, operation, idempotency_key),
  unique (id, organization_id)
);

create table if not exists public.payroll_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation text not null,
  target_table text not null,
  target_row_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id)
);

create table if not exists public.employee_time_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  event_type public.payroll_event_type not null,
  event_at timestamptz not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  source_timezone text not null,
  work_location public.work_location not null,
  work_category public.work_category,
  source_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  replacement_for_event_id uuid,
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (replacement_for_event_id, organization_id)
    references public.employee_time_events(id, organization_id) on delete restrict
);

create table if not exists public.session_attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  session_id uuid not null,
  employee_time_event_id uuid,
  event_type public.session_attendance_event_type not null,
  event_at timestamptz not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  source_timezone text not null,
  work_location public.work_location not null,
  source_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  replacement_for_event_id uuid,
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (session_id, organization_id)
    references public.sessions(id, organization_id) on delete restrict,
  foreign key (employee_time_event_id, organization_id)
    references public.employee_time_events(id, organization_id) on delete restrict,
  foreign key (replacement_for_event_id, organization_id)
    references public.session_attendance_events(id, organization_id) on delete restrict
);

create table if not exists public.time_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  original_event_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  reason_code text not null,
  replacement_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (original_event_id, organization_id)
    references public.employee_time_events(id, organization_id) on delete restrict
);

create table if not exists public.session_attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  session_attendance_event_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  reason_code text not null,
  replacement_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (session_attendance_event_id, organization_id)
    references public.session_attendance_events(id, organization_id) on delete restrict
);

create table if not exists public.timekeeping_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  exception_code text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict
);

create table if not exists public.payroll_retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  retention_years integer not null check (retention_years >= 4),
  effective_from date not null default current_date,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id),
  unique (id, organization_id)
);

create table if not exists public.payroll_legal_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid,
  pay_period_id uuid,
  record_category text,
  active boolean not null default true,
  hold_reason_code text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete restrict,
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict
);

create or replace function app.payroll_feature_enabled(
  p_target_organization_id uuid,
  p_target_jurisdiction text default 'CA',
  p_target_cadence text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := false;
begin
  if p_target_organization_id is null or p_target_jurisdiction is null then
    return false;
  end if;

  select coalesce(org_override.is_enabled, flag.default_enabled, false)
  into v_enabled
  from public.feature_flags flag
  left join public.organization_feature_flags org_override
    on org_override.feature_flag_id = flag.id
   and org_override.organization_id = p_target_organization_id
  where flag.flag_key = 'payroll_timekeeping_v1'
  limit 1;

  if coalesce(v_enabled, false) is not true then
    return false;
  end if;

  if p_target_jurisdiction <> 'CA' then
    return false;
  end if;

  return exists (
    select 1
    from public.payroll_policy_versions policy
    where (policy.organization_id is null or policy.organization_id = p_target_organization_id)
      and policy.jurisdiction = p_target_jurisdiction
      and policy.activation_status = 'active'
      and policy.effective_from <= current_date
      and (policy.effective_through is null or policy.effective_through >= current_date)
      and (
        p_target_cadence is null
        or p_target_cadence <> 'monthly'
        or coalesce(policy.supports_monthly_nonexempt, false)
      )
  );
end;
$$;

create or replace function app.payroll_actor_in_organization(
  p_target_organization_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_resolved_org uuid;
begin
  if v_actor is null or p_target_organization_id is null then
    return false;
  end if;

  v_resolved_org := app.resolve_user_organization_id(v_actor);

  if v_resolved_org is null or v_resolved_org <> p_target_organization_id then
    return false;
  end if;

  return exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor
      and profile.is_active is true
      and profile.organization_id = v_resolved_org
      and profile.organization_id = p_target_organization_id
  )
  and exists (
    select 1
    from public.user_roles membership
    join public.roles role_row
      on role_row.id = membership.role_id
    where membership.user_id = v_actor
      and membership.is_active is true
      and (membership.expires_at is null or membership.expires_at > pg_catalog.now())
  );
end;
$$;

create or replace function app.payroll_actor_has_capability(
  p_target_organization_id uuid,
  p_required_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not app.payroll_actor_in_organization(p_target_organization_id)
    or p_required_capability is null
    or p_required_capability not in (
      'time.clock_self', 'time.view_self', 'time.request_correction_self',
      'time.review_assigned', 'time.approve_assigned', 'session_attendance.record_assigned',
      'payroll.configure_employment', 'payroll.resolve_exceptions',
      'payroll.lock_period', 'payroll.reopen_period',
      'payroll.export_period', 'payroll.view_compensation'
    )
  then
    return false;
  end if;

  if p_required_capability in (
    'time.clock_self', 'time.view_self', 'time.request_correction_self'
  ) then
    return exists (
      select 1
      from public.employment_profiles employment
      where employment.organization_id = p_target_organization_id
        and employment.user_id = v_actor
    );
  end if;

  if p_required_capability in ('time.review_assigned', 'time.approve_assigned') then
    return exists (
      select 1
      from public.employee_manager_assignments assignment_row
      join public.employment_profiles employment
        on employment.id = assignment_row.employment_profile_id
       and employment.organization_id = assignment_row.organization_id
      where assignment_row.organization_id = p_target_organization_id
        and assignment_row.manager_user_id = v_actor
        and assignment_row.effective_from <= pg_catalog.now()
        and (assignment_row.effective_through is null or assignment_row.effective_through > pg_catalog.now())
    );
  end if;

  if p_required_capability = 'session_attendance.record_assigned' then
    return exists (
      select 1
      from public.user_roles membership
      join public.roles role_row on role_row.id = membership.role_id
      where membership.user_id = v_actor
        and membership.is_active is true
        and (membership.expires_at is null or membership.expires_at > pg_catalog.now())
        and role_row.name in ('admin', 'super_admin', 'admin_schedule')
    );
  end if;

  if not exists (
    select 1
    from public.user_roles membership
    join public.roles role_row on role_row.id = membership.role_id
    where membership.user_id = v_actor
      and membership.is_active is true
      and (membership.expires_at is null or membership.expires_at > pg_catalog.now())
      and role_row.name in ('admin', 'super_admin')
  ) then
    return false;
  end if;

  return exists (
    select 1
    from public.payroll_capability_grants grant_row
    where grant_row.organization_id = p_target_organization_id
      and grant_row.user_id = v_actor
      and grant_row.capability::text = p_required_capability
      and grant_row.effective_from <= pg_catalog.now()
      and (grant_row.effective_through is null or grant_row.effective_through > pg_catalog.now())
  );
end;
$$;

create or replace function app.payroll_event_is_locked(
  p_target_organization_id uuid,
  p_employment_profile_id uuid,
  p_event_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pay_group_assignments assignment_row
    join public.pay_groups group_row
      on group_row.id = assignment_row.pay_group_id
     and group_row.organization_id = assignment_row.organization_id
    join public.pay_periods period_row
      on period_row.organization_id = assignment_row.organization_id
     and period_row.pay_group_id = assignment_row.pay_group_id
    where assignment_row.organization_id = p_target_organization_id
      and assignment_row.employment_profile_id = p_employment_profile_id
      and (
        (p_event_at at time zone group_row.timezone)::date >= assignment_row.effective_from
      )
      and (
        assignment_row.effective_through is null
        or (p_event_at at time zone group_row.timezone)::date <= assignment_row.effective_through
      )
      and (p_event_at at time zone group_row.timezone)::date between period_row.starts_on and period_row.ends_on
      and (period_row.locked_at is not null or period_row.exported_at is not null)
  );
$$;

create or replace function app.payroll_hash_payload(
  p_payload jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function app.reject_payroll_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Payroll source rows are append-only';
end;
$$;

create or replace function app.enforce_pay_group_assignment_monthly_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cadence public.pay_group_cadence;
  v_jurisdiction text;
  v_classification text;
  v_assignment_org uuid;
begin
  select group_row.cadence
  into v_cadence
  from public.pay_groups group_row
  where group_row.id = new.pay_group_id
    and group_row.organization_id = new.organization_id;

  select profile.organization_id, profile.home_jurisdiction, profile.classification
  into v_assignment_org, v_jurisdiction, v_classification
  from public.employment_profiles profile
  where profile.id = new.employment_profile_id
    and profile.organization_id = new.organization_id;

  if v_cadence = 'monthly'
    and v_classification = 'nonexempt'
    and v_jurisdiction in ('CA', 'TX', 'AZ')
    and not exists (
      select 1
      from public.payroll_policy_versions policy
      where (policy.organization_id is null or policy.organization_id = v_assignment_org)
        and policy.jurisdiction = v_jurisdiction
        and policy.activation_status = 'active'
        and coalesce(policy.supports_monthly_nonexempt, false)
        and policy.effective_from <= new.effective_from
        and (policy.effective_through is null or policy.effective_through >= new.effective_from)
    )
  then
    raise exception using errcode = '23514', message = 'Monthly pay groups are inactive for payroll v1 nonexempt employees';
  end if;

  return new;
end;
$$;

create or replace function app.current_user_can_read_payroll_employee(
  p_target_organization_id uuid,
  p_employment_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.payroll_actor_in_organization(p_target_organization_id)
    and exists (
      select 1
      from public.employment_profiles profile
      where profile.id = p_employment_profile_id
        and profile.organization_id = p_target_organization_id
        and (
          (
            profile.user_id = auth.uid()
            and app.payroll_actor_has_capability(p_target_organization_id, 'time.view_self')
          )
          or (
            app.payroll_actor_has_capability(p_target_organization_id, 'time.review_assigned')
            and exists (
              select 1
              from public.employee_manager_assignments assignment_row
              where assignment_row.organization_id = p_target_organization_id
                and assignment_row.employment_profile_id = profile.id
                and assignment_row.manager_user_id = auth.uid()
                and assignment_row.effective_from <= pg_catalog.now()
                and (
                  assignment_row.effective_through is null
                  or assignment_row.effective_through > pg_catalog.now()
                )
            )
          )
          or app.payroll_actor_has_capability(p_target_organization_id, 'payroll.configure_employment')
          or app.payroll_actor_has_capability(p_target_organization_id, 'payroll.resolve_exceptions')
          or app.payroll_actor_has_capability(p_target_organization_id, 'payroll.export_period')
          or app.payroll_actor_has_capability(p_target_organization_id, 'payroll.view_compensation')
        )
    );
$$;

create or replace function app.current_user_can_manage_payroll_employee(
  p_target_organization_id uuid,
  p_employment_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.payroll_actor_in_organization(p_target_organization_id)
    and exists (
      select 1
      from public.employment_profiles profile
      where profile.id = p_employment_profile_id
        and profile.organization_id = p_target_organization_id
        and (
          (
            profile.user_id = auth.uid()
            and app.payroll_actor_has_capability(
              p_target_organization_id,
              'time.request_correction_self'
            )
          )
          or (
            app.payroll_actor_has_capability(p_target_organization_id, 'time.approve_assigned')
            and exists (
              select 1
              from public.employee_manager_assignments assignment_row
              where assignment_row.organization_id = p_target_organization_id
                and assignment_row.employment_profile_id = profile.id
                and assignment_row.manager_user_id = auth.uid()
                and assignment_row.effective_from <= pg_catalog.now()
                and (
                  assignment_row.effective_through is null
                  or assignment_row.effective_through > pg_catalog.now()
                )
            )
          )
          or app.payroll_actor_has_capability(p_target_organization_id, 'payroll.configure_employment')
          or app.payroll_actor_has_capability(p_target_organization_id, 'payroll.resolve_exceptions')
        )
    );
$$;

create or replace function public.record_employee_time_event(
  event_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_event_data jsonb;
  v_employment public.employment_profiles%rowtype;
  v_event_type public.payroll_event_type;
  v_event_at timestamptz;
  v_source_timezone text;
  v_work_location public.work_location;
  v_work_category public.work_category;
  v_source_note text;
  v_metadata jsonb := '{}'::jsonb;
  v_idempotency_key text;
  v_payload_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_event public.employee_time_events%rowtype;
  v_latest_event_at timestamptz;
  v_shift_open boolean := false;
  v_meal_open boolean := false;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if idempotency_key is null
    or btrim(idempotency_key) = ''
    or event_payload is null
    or jsonb_typeof(event_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid payroll time event payload';
  end if;

  v_idempotency_key := btrim(idempotency_key);

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if event_payload ? 'organization_id'
    or event_payload ? 'organizationId'
    or event_payload ? 'actor_user_id'
    or event_payload ? 'actorUserId'
    or event_payload ? 'actor_id'
    or event_payload ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_event_data := coalesce(event_payload -> 'data', '{}'::jsonb);
  if jsonb_typeof(v_event_data) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid payroll time event payload';
  end if;

  if v_event_data ? 'organization_id'
    or v_event_data ? 'organizationId'
    or v_event_data ? 'actor_user_id'
    or v_event_data ? 'actorUserId'
    or v_event_data ? 'actor_id'
    or v_event_data ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_payload_idempotency_key := nullif(btrim(v_event_data ->> 'idempotencyKey'), '');
  if v_payload_idempotency_key is not null
    and v_payload_idempotency_key <> v_idempotency_key
  then
    raise exception using errcode = '22023', message = 'event payload idempotency key mismatch';
  end if;

  v_event_type := nullif(btrim(v_event_data ->> 'eventType'), '')::public.payroll_event_type;
  v_event_at := nullif(btrim(event_payload ->> 'occurredAt'), '')::timestamptz;
  v_source_timezone := nullif(btrim(event_payload ->> 'timezone'), '');
  v_work_location := nullif(btrim(event_payload ->> 'workLocation'), '')::public.work_location;
  v_source_note := nullif(btrim(v_event_data ->> 'sourceNote'), '');
  if v_event_data ? 'metadata' and jsonb_typeof(v_event_data -> 'metadata') = 'object' then
    v_metadata := v_event_data -> 'metadata';
  end if;
  if v_event_data ? 'workCategory' and jsonb_typeof(v_event_data -> 'workCategory') <> 'null' then
    v_work_category := nullif(btrim(v_event_data ->> 'workCategory'), '')::public.work_category;
  end if;

  if v_event_type is null
    or v_event_at is null
    or v_source_timezone is null
    or v_work_location is null
  then
    raise exception using errcode = '22023', message = 'invalid payroll time event payload';
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.user_id = v_actor
    and employment.active_from <= ((v_event_at at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((v_event_at at time zone employment.timezone)::date)
    )
  order by employment.active_from desc
  limit 1;

  if not found then
    raise exception using errcode = '42501', message = 'no active payroll employment profile';
  end if;

  if not app.payroll_actor_has_capability(v_actor_org, 'time.clock_self') then
    raise exception using errcode = '42501', message = 'employee is out of scope';
  end if;

  if not app.payroll_feature_enabled(v_actor_org, v_employment.home_jurisdiction, null) then
    raise exception using errcode = '42501', message = 'payroll timekeeping feature is disabled';
  end if;

  if app.payroll_event_is_locked(v_actor_org, v_employment.id, v_event_at) then
    raise exception using errcode = '23514', message = 'pay period is locked or exported';
  end if;

  v_payload := jsonb_build_object(
    'organization_id', v_actor_org,
    'employment_profile_id', v_employment.id,
    'occurred_at', v_event_at,
    'timezone', v_source_timezone,
    'work_location', v_work_location,
    'idempotency_key', v_idempotency_key,
    'data', jsonb_build_object(
      'eventType', v_event_type,
      'workCategory', to_jsonb(v_work_category),
      'sourceNote', to_jsonb(v_source_note),
      'metadata', v_metadata
    )
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':record_employee_time_event:' || v_idempotency_key,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'payroll-employee-state:' || v_actor_org::text || ':' || v_employment.id::text,
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'record_employee_time_event'
    and receipt.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload;
  end if;

  select max(event_row.event_at)
  into v_latest_event_at
  from public.employee_time_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id;

  if v_latest_event_at is not null and v_event_at <= v_latest_event_at then
    raise exception using
      errcode = '23514',
      message = 'event occurredAt must be strictly later than the latest confirmed employee time event';
  end if;

  select
    coalesce(
      sum(
        case event_row.event_type
          when 'shift_started' then 1
          when 'shift_ended' then -1
          else 0
        end
      ),
      0
    ) > 0,
    coalesce(
      sum(
        case event_row.event_type
          when 'meal_started' then 1
          when 'meal_ended' then -1
          else 0
        end
      ),
      0
    ) > 0
  into v_shift_open, v_meal_open
  from public.employee_time_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id;

  if v_event_type = 'shift_started' and v_shift_open then
    raise exception using errcode = '23514', message = 'duplicate shift start';
  end if;
  if v_event_type = 'shift_ended' and not v_shift_open then
    raise exception using errcode = '23514', message = 'shift end requires an open shift';
  end if;
  if v_event_type = 'meal_started' and not v_shift_open then
    raise exception using errcode = '23514', message = 'meal start requires an open shift';
  end if;
  if v_event_type = 'meal_started' and v_meal_open then
    raise exception using errcode = '23514', message = 'meal start overlaps an active meal';
  end if;
  if v_event_type = 'meal_ended' and not v_meal_open then
    raise exception using errcode = '23514', message = 'meal end requires an active meal';
  end if;
  if v_event_type = 'work_category_changed' and not v_shift_open then
    raise exception using errcode = '23514', message = 'work category change requires an open shift';
  end if;
  if v_event_type = 'work_category_changed' and v_work_category is null then
    raise exception using errcode = '22023', message = 'work category change requires a work category';
  end if;
  if v_event_type <> 'work_category_changed' and v_work_category is not null then
    raise exception using errcode = '22023', message = 'work category is only valid for work category changes';
  end if;

  insert into public.employee_time_events (
    organization_id,
    employment_profile_id,
    event_type,
    event_at,
    actor_user_id,
    source_timezone,
    work_location,
    work_category,
    source_note,
    metadata
  ) values (
    v_actor_org,
    v_employment.id,
    v_event_type,
    v_event_at,
    v_actor,
    v_source_timezone,
    v_work_location,
    v_work_category,
    v_source_note,
    v_metadata
  )
  returning * into v_event;

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
    'record_employee_time_event',
    'employee_time_events',
    v_event.id,
    v_payload
  );

  v_result := jsonb_build_object(
    'event_id', v_event.id,
    'operation', 'record_employee_time_event',
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
    'record_employee_time_event',
    v_idempotency_key,
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.record_session_attendance_event(
  event_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_event_data jsonb;
  v_employment public.employment_profiles%rowtype;
  v_event_type public.session_attendance_event_type;
  v_event_at timestamptz;
  v_source_timezone text;
  v_work_location public.work_location;
  v_session_id uuid;
  v_employee_time_event_id uuid;
  v_idempotency_key text;
  v_payload_idempotency_key text;
  v_metadata jsonb := '{}'::jsonb;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_event public.session_attendance_events%rowtype;
  v_assignment_count bigint;
  v_latest_event_at timestamptz;
  v_session_open boolean := false;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if idempotency_key is null
    or btrim(idempotency_key) = ''
    or event_payload is null
    or jsonb_typeof(event_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
  end if;

  v_idempotency_key := btrim(idempotency_key);

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if event_payload ? 'organization_id'
    or event_payload ? 'organizationId'
    or event_payload ? 'actor_user_id'
    or event_payload ? 'actorUserId'
    or event_payload ? 'actor_id'
    or event_payload ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_event_data := coalesce(event_payload -> 'data', '{}'::jsonb);
  if jsonb_typeof(v_event_data) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
  end if;

  if v_event_data ? 'organization_id'
    or v_event_data ? 'organizationId'
    or v_event_data ? 'actor_user_id'
    or v_event_data ? 'actorUserId'
    or v_event_data ? 'actor_id'
    or v_event_data ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_payload_idempotency_key := nullif(btrim(v_event_data ->> 'idempotencyKey'), '');
  if v_payload_idempotency_key is not null
    and v_payload_idempotency_key <> v_idempotency_key
  then
    raise exception using errcode = '22023', message = 'event payload idempotency key mismatch';
  end if;

  v_event_type := nullif(btrim(v_event_data ->> 'eventType'), '')::public.session_attendance_event_type;
  v_event_at := nullif(btrim(event_payload ->> 'occurredAt'), '')::timestamptz;
  v_source_timezone := nullif(btrim(event_payload ->> 'timezone'), '');
  v_work_location := nullif(btrim(event_payload ->> 'workLocation'), '')::public.work_location;
  v_session_id := nullif(btrim(v_event_data ->> 'sessionId'), '')::uuid;
  if v_event_data ? 'employeeTimeEventId'
    and jsonb_typeof(v_event_data -> 'employeeTimeEventId') <> 'null'
  then
    v_employee_time_event_id := nullif(
      btrim(v_event_data ->> 'employeeTimeEventId'),
      ''
    )::uuid;
  end if;

  if v_event_data ? 'metadata' then
    if jsonb_typeof(v_event_data -> 'metadata') <> 'object' then
      raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
    end if;
    v_metadata := v_event_data -> 'metadata';
  end if;

  if v_event_type is null
    or v_event_at is null
    or v_source_timezone is null
    or v_work_location is null
    or v_session_id is null
  then
    raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
  end if;

  select count(*)
  into v_assignment_count
  from public.sessions session_row
  join public.employment_profiles employment
    on session_row.therapist_id = employment.therapist_id
   and employment.organization_id = session_row.organization_id
  where session_row.id = v_session_id
    and session_row.organization_id = v_actor_org
    and session_row.therapist_id is not null
    and employment.active_from <= ((v_event_at at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((v_event_at at time zone employment.timezone)::date)
    );

  if v_assignment_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'session assignment must resolve to exactly one active payroll employment profile';
  end if;

  select employment.*
  into v_employment
  from public.sessions session_row
  join public.employment_profiles employment
    on session_row.therapist_id = employment.therapist_id
   and employment.organization_id = session_row.organization_id
  where session_row.id = v_session_id
    and session_row.organization_id = v_actor_org
    and session_row.therapist_id is not null
    and employment.active_from <= ((v_event_at at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((v_event_at at time zone employment.timezone)::date)
    )
  order by employment.active_from desc
  limit 1;

  if v_employment.user_id = v_actor then
    if not app.payroll_actor_has_capability(v_actor_org, 'time.clock_self') then
      raise exception using errcode = '42501', message = 'employee is out of scope';
    end if;
  elsif not app.payroll_actor_has_capability(v_actor_org, 'session_attendance.record_assigned') then
    raise exception using errcode = '42501', message = 'employee is out of scope';
  end if;

  if not app.payroll_feature_enabled(v_actor_org, v_employment.home_jurisdiction, null) then
    raise exception using errcode = '42501', message = 'payroll timekeeping feature is disabled';
  end if;

  if app.payroll_event_is_locked(v_actor_org, v_employment.id, v_event_at) then
    raise exception using errcode = '23514', message = 'pay period is locked or exported';
  end if;

  if v_employee_time_event_id is not null and not exists (
    select 1
    from public.employee_time_events event_row
    where event_row.id = v_employee_time_event_id
      and event_row.organization_id = v_actor_org
      and event_row.employment_profile_id = v_employment.id
  ) then
    raise exception using errcode = '42501', message = 'employee time event is out of scope';
  end if;

  v_payload := jsonb_build_object(
    'organization_id', v_actor_org,
    'employment_profile_id', v_employment.id,
    'occurred_at', v_event_at,
    'timezone', v_source_timezone,
    'work_location', v_work_location,
    'idempotency_key', v_idempotency_key,
    'data', jsonb_build_object(
      'sessionId', v_session_id,
      'eventType', v_event_type,
      'employeeTimeEventId', to_jsonb(v_employee_time_event_id),
      'metadata', v_metadata
    )
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':record_session_attendance_event:' || v_idempotency_key,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'session-attendance-state:' || v_actor_org::text || ':' || v_employment.id::text || ':' || v_session_id::text,
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'record_session_attendance_event'
    and receipt.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload;
  end if;

  select max(event_row.event_at)
  into v_latest_event_at
  from public.session_attendance_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id
    and event_row.session_id = v_session_id;

  if v_latest_event_at is not null and v_event_at <= v_latest_event_at then
    raise exception using
      errcode = '23514',
      message = 'event occurredAt must be strictly later than the latest confirmed session attendance event';
  end if;

  select coalesce(
    sum(
      case event_row.event_type
        when 'session_started' then 1
        when 'session_ended' then -1
        else 0
      end
    ),
    0
  ) > 0
  into v_session_open
  from public.session_attendance_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id
    and event_row.session_id = v_session_id;

  if v_event_type = 'session_started' and v_session_open then
    raise exception using errcode = '23514', message = 'duplicate session start';
  end if;

  if v_event_type = 'session_ended' and not v_session_open then
    raise exception using errcode = '23514', message = 'session end requires a started session';
  end if;

  insert into public.session_attendance_events (
    organization_id,
    employment_profile_id,
    session_id,
    employee_time_event_id,
    event_type,
    event_at,
    actor_user_id,
    source_timezone,
    work_location,
    source_note,
    metadata
  ) values (
    v_actor_org,
    v_employment.id,
    v_session_id,
    v_employee_time_event_id,
    v_event_type,
    v_event_at,
    v_actor,
    v_source_timezone,
    v_work_location,
    null,
    v_metadata
  )
  returning * into v_event;

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
    'record_session_attendance_event',
    'session_attendance_events',
    v_event.id,
    v_payload
  );

  v_result := jsonb_build_object(
    'event_id', v_event.id,
    'operation', 'record_session_attendance_event',
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
    'record_session_attendance_event',
    v_idempotency_key,
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.request_time_correction(
  correction_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_correction_data jsonb;
  v_employment public.employment_profiles%rowtype;
  v_original_event_id uuid;
  v_reason_code text;
  v_replacement_payload jsonb := '{}'::jsonb;
  v_idempotency_key text;
  v_payload_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_original public.employee_time_events%rowtype;
  v_request public.time_correction_requests%rowtype;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if idempotency_key is null
    or btrim(idempotency_key) = ''
    or correction_payload is null
    or jsonb_typeof(correction_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid time correction payload';
  end if;

  v_idempotency_key := btrim(idempotency_key);

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if correction_payload ? 'organization_id'
    or correction_payload ? 'organizationId'
    or correction_payload ? 'actor_user_id'
    or correction_payload ? 'actorUserId'
    or correction_payload ? 'actor_id'
    or correction_payload ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_correction_data := coalesce(correction_payload -> 'data', '{}'::jsonb);
  if jsonb_typeof(v_correction_data) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid time correction payload';
  end if;

  if v_correction_data ? 'organization_id'
    or v_correction_data ? 'organizationId'
    or v_correction_data ? 'actor_user_id'
    or v_correction_data ? 'actorUserId'
    or v_correction_data ? 'actor_id'
    or v_correction_data ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_payload_idempotency_key := nullif(btrim(v_correction_data ->> 'idempotencyKey'), '');
  if v_payload_idempotency_key is not null
    and v_payload_idempotency_key <> v_idempotency_key
  then
    raise exception using errcode = '22023', message = 'correction payload idempotency key mismatch';
  end if;

  v_original_event_id := nullif(btrim(v_correction_data ->> 'originalEventId'), '')::uuid;
  v_reason_code := nullif(btrim(v_correction_data ->> 'reasonCode'), '');
  if v_correction_data ? 'replacementPayload' then
    if jsonb_typeof(v_correction_data -> 'replacementPayload') <> 'object' then
      raise exception using errcode = '22023', message = 'invalid time correction payload';
    end if;
    v_replacement_payload := v_correction_data -> 'replacementPayload';
  end if;

  if v_original_event_id is null or v_reason_code is null then
    raise exception using errcode = '22023', message = 'invalid time correction payload';
  end if;

  if not app.payroll_actor_has_capability(v_actor_org, 'time.request_correction_self') then
    raise exception using errcode = '42501', message = 'employee is out of scope';
  end if;

  select event_row.*
  into v_original
  from public.employee_time_events event_row
  where event_row.id = v_original_event_id
    and event_row.organization_id = v_actor_org;

  if not found then
    raise exception using errcode = '42501', message = 'original payroll event is out of scope';
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.id = v_original.employment_profile_id
    and employment.organization_id = v_actor_org
    and employment.user_id = v_actor;

  if not found then
    raise exception using errcode = '42501', message = 'original payroll event is out of scope';
  end if;

  if not app.payroll_feature_enabled(v_actor_org, v_employment.home_jurisdiction, null) then
    raise exception using errcode = '42501', message = 'payroll timekeeping feature is disabled';
  end if;

  v_payload := jsonb_build_object(
    'organization_id', v_actor_org,
    'employment_profile_id', v_employment.id,
    'idempotency_key', v_idempotency_key,
    'data', jsonb_build_object(
      'originalEventId', v_original_event_id,
      'reasonCode', v_reason_code,
      'replacementPayload', v_replacement_payload
    )
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':request_time_correction:' || v_idempotency_key,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'time-correction-request:' || v_actor_org::text || ':' || v_employment.id::text || ':' || v_original_event_id::text,
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'request_time_correction'
    and receipt.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload;
  end if;

  insert into public.time_correction_requests (
    organization_id,
    employment_profile_id,
    original_event_id,
    requested_by,
    reason_code,
    replacement_payload
  ) values (
    v_actor_org,
    v_original.employment_profile_id,
    v_original_event_id,
    v_actor,
    v_reason_code,
    v_replacement_payload
  )
  returning * into v_request;

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
    'request_time_correction',
    'time_correction_requests',
    v_request.id,
    v_payload
  );

  v_result := jsonb_build_object(
    'request_id', v_request.id,
    'operation', 'request_time_correction',
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
    'request_time_correction',
    v_idempotency_key,
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.request_session_attendance_correction(
  correction_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_correction_data jsonb;
  v_employment public.employment_profiles%rowtype;
  v_session_attendance_event_id uuid;
  v_reason_code text;
  v_replacement_payload jsonb := '{}'::jsonb;
  v_idempotency_key text;
  v_payload_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_original public.session_attendance_events%rowtype;
  v_request public.session_attendance_correction_requests%rowtype;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if idempotency_key is null
    or btrim(idempotency_key) = ''
    or correction_payload is null
    or jsonb_typeof(correction_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid attendance correction payload';
  end if;

  v_idempotency_key := btrim(idempotency_key);

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if correction_payload ? 'organization_id'
    or correction_payload ? 'organizationId'
    or correction_payload ? 'actor_user_id'
    or correction_payload ? 'actorUserId'
    or correction_payload ? 'actor_id'
    or correction_payload ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_correction_data := coalesce(correction_payload -> 'data', '{}'::jsonb);
  if jsonb_typeof(v_correction_data) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid attendance correction payload';
  end if;

  if v_correction_data ? 'organization_id'
    or v_correction_data ? 'organizationId'
    or v_correction_data ? 'actor_user_id'
    or v_correction_data ? 'actorUserId'
    or v_correction_data ? 'actor_id'
    or v_correction_data ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_payload_idempotency_key := nullif(btrim(v_correction_data ->> 'idempotencyKey'), '');
  if v_payload_idempotency_key is not null
    and v_payload_idempotency_key <> v_idempotency_key
  then
    raise exception using errcode = '22023', message = 'correction payload idempotency key mismatch';
  end if;

  v_session_attendance_event_id := nullif(
    btrim(v_correction_data ->> 'sessionAttendanceEventId'),
    ''
  )::uuid;
  v_reason_code := nullif(btrim(v_correction_data ->> 'reasonCode'), '');
  if v_correction_data ? 'replacementPayload' then
    if jsonb_typeof(v_correction_data -> 'replacementPayload') <> 'object' then
      raise exception using errcode = '22023', message = 'invalid attendance correction payload';
    end if;
    v_replacement_payload := v_correction_data -> 'replacementPayload';
  end if;

  if v_session_attendance_event_id is null or v_reason_code is null then
    raise exception using errcode = '22023', message = 'invalid attendance correction payload';
  end if;

  if not app.payroll_actor_has_capability(v_actor_org, 'time.request_correction_self') then
    raise exception using errcode = '42501', message = 'employee is out of scope';
  end if;

  select event_row.*
  into v_original
  from public.session_attendance_events event_row
  where event_row.id = v_session_attendance_event_id
    and event_row.organization_id = v_actor_org;

  if not found then
    raise exception using errcode = '42501', message = 'original attendance event is out of scope';
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.id = v_original.employment_profile_id
    and employment.organization_id = v_actor_org
    and employment.user_id = v_actor;

  if not found then
    raise exception using errcode = '42501', message = 'original attendance event is out of scope';
  end if;

  if not app.payroll_feature_enabled(v_actor_org, v_employment.home_jurisdiction, null) then
    raise exception using errcode = '42501', message = 'payroll timekeeping feature is disabled';
  end if;

  v_payload := jsonb_build_object(
    'organization_id', v_actor_org,
    'employment_profile_id', v_employment.id,
    'idempotency_key', v_idempotency_key,
    'data', jsonb_build_object(
      'sessionAttendanceEventId', v_session_attendance_event_id,
      'reasonCode', v_reason_code,
      'replacementPayload', v_replacement_payload
    )
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':request_session_attendance_correction:' || v_idempotency_key,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'attendance-correction-request:' || v_actor_org::text || ':' || v_employment.id::text || ':' || v_session_attendance_event_id::text,
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'request_session_attendance_correction'
    and receipt.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload;
  end if;

  insert into public.session_attendance_correction_requests (
    organization_id,
    employment_profile_id,
    session_attendance_event_id,
    requested_by,
    reason_code,
    replacement_payload
  ) values (
    v_actor_org,
    v_original.employment_profile_id,
    v_session_attendance_event_id,
    v_actor,
    v_reason_code,
    v_replacement_payload
  )
  returning * into v_request;

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
    'request_session_attendance_correction',
    'session_attendance_correction_requests',
    v_request.id,
    v_payload
  );

  v_result := jsonb_build_object(
    'request_id', v_request.id,
    'operation', 'request_session_attendance_correction',
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
    'request_session_attendance_correction',
    v_idempotency_key,
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

insert into public.feature_flags (flag_key, description, default_enabled)
values (
  'payroll_timekeeping_v1',
  'Protected payroll-grade timekeeping foundation',
  false
)
on conflict (flag_key) do update
set description = excluded.description,
    default_enabled = excluded.default_enabled;

insert into public.payroll_policy_versions (
  organization_id,
  jurisdiction,
  policy_name,
  activation_status,
  supports_monthly_nonexempt,
  effective_from
)
values (
  null,
  'CA',
  'California ordinary nonexempt baseline',
  'inactive',
  false,
  current_date
);

insert into public.payroll_retention_policies (
  organization_id,
  retention_years,
  effective_from
)
select organization_row.id, 4, current_date
from public.organizations organization_row
where not exists (
  select 1
  from public.payroll_retention_policies retention_row
  where retention_row.organization_id = organization_row.id
);

drop trigger if exists pay_group_assignments_monthly_guard on public.pay_group_assignments;
create trigger pay_group_assignments_monthly_guard
  before insert or update on public.pay_group_assignments
  for each row
  execute function app.enforce_pay_group_assignment_monthly_guard();

drop trigger if exists employee_time_events_append_only on public.employee_time_events;
create trigger employee_time_events_append_only
  before update or delete on public.employee_time_events
  for each row
  execute function app.reject_payroll_source_mutation();

drop trigger if exists session_attendance_events_append_only on public.session_attendance_events;
create trigger session_attendance_events_append_only
  before update or delete on public.session_attendance_events
  for each row
  execute function app.reject_payroll_source_mutation();

drop trigger if exists time_correction_requests_append_only on public.time_correction_requests;
create trigger time_correction_requests_append_only
  before update or delete on public.time_correction_requests
  for each row
  execute function app.reject_payroll_source_mutation();

drop trigger if exists session_attendance_correction_requests_append_only on public.session_attendance_correction_requests;
create trigger session_attendance_correction_requests_append_only
  before update or delete on public.session_attendance_correction_requests
  for each row
  execute function app.reject_payroll_source_mutation();

drop trigger if exists payroll_audit_events_append_only on public.payroll_audit_events;
create trigger payroll_audit_events_append_only
  before update or delete on public.payroll_audit_events
  for each row
  execute function app.reject_payroll_source_mutation();

alter table public.employment_profiles enable row level security;
alter table public.employment_profiles force row level security;
alter table public.payroll_organization_settings enable row level security;
alter table public.payroll_organization_settings force row level security;
alter table public.employee_rate_versions enable row level security;
alter table public.employee_rate_versions force row level security;
alter table public.pay_groups enable row level security;
alter table public.pay_groups force row level security;
alter table public.pay_group_assignments enable row level security;
alter table public.pay_group_assignments force row level security;
alter table public.pay_periods enable row level security;
alter table public.pay_periods force row level security;
alter table public.payroll_policy_versions enable row level security;
alter table public.payroll_policy_versions force row level security;
alter table public.payroll_capability_grants enable row level security;
alter table public.payroll_capability_grants force row level security;
alter table public.employee_manager_assignments enable row level security;
alter table public.employee_manager_assignments force row level security;
alter table public.payroll_mutation_receipts enable row level security;
alter table public.payroll_mutation_receipts force row level security;
alter table public.payroll_audit_events enable row level security;
alter table public.payroll_audit_events force row level security;
alter table public.employee_time_events enable row level security;
alter table public.employee_time_events force row level security;
alter table public.session_attendance_events enable row level security;
alter table public.session_attendance_events force row level security;
alter table public.time_correction_requests enable row level security;
alter table public.time_correction_requests force row level security;
alter table public.session_attendance_correction_requests enable row level security;
alter table public.session_attendance_correction_requests force row level security;
alter table public.timekeeping_exceptions enable row level security;
alter table public.timekeeping_exceptions force row level security;
alter table public.payroll_retention_policies enable row level security;
alter table public.payroll_retention_policies force row level security;
alter table public.payroll_legal_holds enable row level security;
alter table public.payroll_legal_holds force row level security;

create policy employment_profiles_authenticated_select
  on public.employment_profiles
  for select
  to authenticated
  using (
    app.current_user_can_read_payroll_employee(organization_id, id)
  );

create policy employee_rate_versions_authenticated_select
  on public.employee_rate_versions
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.view_compensation')
  );

create policy pay_group_assignments_authenticated_select
  on public.pay_group_assignments
  for select
  to authenticated
  using (
    app.current_user_can_read_payroll_employee(organization_id, employment_profile_id)
  );

create policy payroll_organization_settings_authenticated_select
  on public.payroll_organization_settings
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
    or app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
  );

create policy pay_groups_authenticated_select
  on public.pay_groups
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
    or app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
  );

create policy pay_periods_authenticated_select
  on public.pay_periods
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.lock_period')
    or app.payroll_actor_has_capability(organization_id, 'payroll.reopen_period')
    or app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
  );

create policy payroll_policy_versions_authenticated_select
  on public.payroll_policy_versions
  for select
  to authenticated
  using (
    (
      organization_id is not null
      and (
        app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
        or app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
      )
    )
    or (
      organization_id is null
      and app.payroll_actor_in_organization(app.resolve_user_organization_id(auth.uid()))
      and (
        app.payroll_actor_has_capability(
          app.resolve_user_organization_id(auth.uid()),
          'payroll.configure_employment'
        )
        or app.payroll_actor_has_capability(
          app.resolve_user_organization_id(auth.uid()),
          'payroll.export_period'
        )
      )
    )
  );

create policy payroll_capability_grants_authenticated_select
  on public.payroll_capability_grants
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
  );

create policy employee_manager_assignments_authenticated_select
  on public.employee_manager_assignments
  for select
  to authenticated
  using (
    (
      app.payroll_actor_in_organization(organization_id)
      and manager_user_id = auth.uid()
      and (
        app.payroll_actor_has_capability(organization_id, 'time.review_assigned')
        or app.payroll_actor_has_capability(organization_id, 'time.approve_assigned')
      )
    )
    or app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
  );

create policy payroll_mutation_receipts_authenticated_select
  on public.payroll_mutation_receipts
  for select
  to authenticated
  using (
    (
      app.payroll_actor_in_organization(organization_id)
      and actor_user_id = auth.uid()
    )
    or app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions')
  );

create policy payroll_audit_events_authenticated_select
  on public.payroll_audit_events
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions')
    or app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
  );

create policy employee_time_events_authenticated_select
  on public.employee_time_events
  for select
  to authenticated
  using (app.current_user_can_read_payroll_employee(organization_id, employment_profile_id));

create policy session_attendance_events_authenticated_select
  on public.session_attendance_events
  for select
  to authenticated
  using (app.current_user_can_read_payroll_employee(organization_id, employment_profile_id));

create policy time_correction_requests_authenticated_select
  on public.time_correction_requests
  for select
  to authenticated
  using (app.current_user_can_manage_payroll_employee(organization_id, employment_profile_id));

create policy session_attendance_correction_requests_authenticated_select
  on public.session_attendance_correction_requests
  for select
  to authenticated
  using (app.current_user_can_manage_payroll_employee(organization_id, employment_profile_id));

create policy timekeeping_exceptions_authenticated_select
  on public.timekeeping_exceptions
  for select
  to authenticated
  using (app.current_user_can_manage_payroll_employee(organization_id, employment_profile_id));

create policy payroll_retention_policies_authenticated_select
  on public.payroll_retention_policies
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
    or app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
  );

create policy payroll_legal_holds_authenticated_select
  on public.payroll_legal_holds
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
    or app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
  );

revoke all on public.employment_profiles from public, anon, authenticated;
revoke all on public.payroll_organization_settings from public, anon, authenticated;
revoke all on public.employee_rate_versions from public, anon, authenticated;
revoke all on public.pay_groups from public, anon, authenticated;
revoke all on public.pay_group_assignments from public, anon, authenticated;
revoke all on public.pay_periods from public, anon, authenticated;
revoke all on public.payroll_policy_versions from public, anon, authenticated;
revoke all on public.payroll_capability_grants from public, anon, authenticated;
revoke all on public.employee_manager_assignments from public, anon, authenticated;
revoke all on public.payroll_mutation_receipts from public, anon, authenticated;
revoke all on public.payroll_audit_events from public, anon, authenticated;
revoke all on public.employee_time_events from public, anon, authenticated;
revoke all on public.session_attendance_events from public, anon, authenticated;
revoke all on public.time_correction_requests from public, anon, authenticated;
revoke all on public.session_attendance_correction_requests from public, anon, authenticated;
revoke all on public.timekeeping_exceptions from public, anon, authenticated;
revoke all on public.payroll_retention_policies from public, anon, authenticated;
revoke all on public.payroll_legal_holds from public, anon, authenticated;
revoke insert, update, delete on public.employee_time_events from authenticated;
revoke insert, update, delete on public.session_attendance_events from authenticated;
revoke insert, update, delete on public.time_correction_requests from authenticated;
revoke insert, update, delete on public.session_attendance_correction_requests from authenticated;
revoke insert, update, delete on public.payroll_audit_events from authenticated;

revoke all on public.employment_profiles from service_role;
revoke all on public.payroll_organization_settings from service_role;
revoke all on public.employee_rate_versions from service_role;
revoke all on public.pay_groups from service_role;
revoke all on public.pay_group_assignments from service_role;
revoke all on public.pay_periods from service_role;
revoke all on public.payroll_policy_versions from service_role;
revoke all on public.payroll_capability_grants from service_role;
revoke all on public.employee_manager_assignments from service_role;
revoke all on public.payroll_mutation_receipts from service_role;
revoke all on public.payroll_audit_events from service_role;
revoke all on public.employee_time_events from service_role;
revoke all on public.session_attendance_events from service_role;
revoke all on public.time_correction_requests from service_role;
revoke all on public.session_attendance_correction_requests from service_role;
revoke all on public.timekeeping_exceptions from service_role;
revoke all on public.payroll_retention_policies from service_role;
revoke all on public.payroll_legal_holds from service_role;

grant select on public.employment_profiles to authenticated;
grant select on public.payroll_organization_settings to authenticated;
grant select on public.employee_rate_versions to authenticated;
grant select on public.pay_groups to authenticated;
grant select on public.pay_group_assignments to authenticated;
grant select on public.pay_periods to authenticated;
grant select on public.payroll_policy_versions to authenticated;
grant select on public.payroll_capability_grants to authenticated;
grant select on public.employee_manager_assignments to authenticated;
grant select on public.payroll_mutation_receipts to authenticated;
grant select on public.payroll_audit_events to authenticated;
grant select on public.employee_time_events to authenticated;
grant select on public.session_attendance_events to authenticated;
grant select on public.time_correction_requests to authenticated;
grant select on public.session_attendance_correction_requests to authenticated;
grant select on public.timekeeping_exceptions to authenticated;
grant select on public.payroll_retention_policies to authenticated;
grant select on public.payroll_legal_holds to authenticated;

revoke all on function app.payroll_feature_enabled(uuid, text, text) from public, anon, authenticated;
revoke all on function app.payroll_actor_in_organization(uuid) from public, anon, authenticated;
revoke all on function app.payroll_actor_has_capability(uuid, text) from public, anon, authenticated;
revoke all on function app.payroll_event_is_locked(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.payroll_hash_payload(jsonb) from public, anon, authenticated;
revoke all on function app.reject_payroll_source_mutation() from public, anon, authenticated;
revoke all on function app.enforce_pay_group_assignment_monthly_guard() from public, anon, authenticated;
revoke all on function app.current_user_can_read_payroll_employee(uuid, uuid) from public, anon, authenticated;
revoke all on function app.current_user_can_manage_payroll_employee(uuid, uuid) from public, anon, authenticated;

grant execute on function app.payroll_feature_enabled(uuid, text, text) to authenticated, service_role;
grant execute on function app.payroll_actor_in_organization(uuid) to authenticated, service_role;
grant execute on function app.payroll_actor_has_capability(uuid, text) to authenticated, service_role;
grant execute on function app.payroll_event_is_locked(uuid, uuid, timestamptz) to authenticated, service_role;
grant execute on function app.current_user_can_read_payroll_employee(uuid, uuid) to authenticated, service_role;
grant execute on function app.current_user_can_manage_payroll_employee(uuid, uuid) to authenticated, service_role;

revoke all on function public.record_employee_time_event(jsonb, text) from public, anon;
revoke all on function public.record_session_attendance_event(jsonb, text) from public, anon;
revoke all on function public.request_time_correction(jsonb, text) from public, anon;
revoke all on function public.request_session_attendance_correction(jsonb, text) from public, anon;

grant execute on function public.record_employee_time_event(jsonb, text) to authenticated, service_role;
grant execute on function public.record_session_attendance_event(jsonb, text) to authenticated, service_role;
grant execute on function public.request_time_correction(jsonb, text) to authenticated, service_role;
grant execute on function public.request_session_attendance_correction(jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
