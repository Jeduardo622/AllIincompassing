-- @migration-intent: payroll_administration
-- @migration-dependencies: 20260812141324_payroll_review_read_models.sql
-- @migration-rollback: Drop the payroll administration RPCs, helper functions, generation-version table, and additive constraints; restore the single-row payroll organization settings uniqueness model only after a clean local reset confirms no dependent history rows remain.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

alter table public.payroll_organization_settings
  add column if not exists effective_from date not null default current_date;

alter table public.payroll_organization_settings
  add column if not exists effective_through date;

alter table public.payroll_organization_settings
  add column if not exists created_by uuid references auth.users(id) on delete restrict;

alter table public.pay_groups
  add column if not exists effective_from date not null default current_date;

alter table public.pay_groups
  add column if not exists effective_through date;

alter table public.pay_groups
  add column if not exists created_by uuid references auth.users(id) on delete restrict;

update public.payroll_organization_settings
set effective_from = (created_at at time zone 'utc')::date
where effective_from = current_date
  and (created_at at time zone 'utc')::date <> current_date;

update public.pay_groups
set effective_from = (created_at at time zone 'utc')::date
where effective_from = current_date
  and (created_at at time zone 'utc')::date <> current_date;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'payroll_organization_settings_organization_id_key'
      and constraint_row.conrelid = 'public.payroll_organization_settings'::regclass
  ) then
    alter table public.payroll_organization_settings
      drop constraint payroll_organization_settings_organization_id_key;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname like 'payroll_organization_settings_external_payroll_organization%'
      and constraint_row.conrelid = 'public.payroll_organization_settings'::regclass
  ) then
    alter table public.payroll_organization_settings
      drop constraint if exists payroll_organization_settings_external_payroll_organization_id_key;
    alter table public.payroll_organization_settings
      drop constraint if exists payroll_organization_settings_external_payroll_organization_key;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'payroll_organization_settings_effective_dates_valid'
      and constraint_row.conrelid = 'public.payroll_organization_settings'::regclass
  ) then
    alter table public.payroll_organization_settings
      add constraint payroll_organization_settings_effective_dates_valid
      check (effective_through is null or effective_through >= effective_from);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'pay_groups_effective_dates_valid'
      and constraint_row.conrelid = 'public.pay_groups'::regclass
  ) then
    alter table public.pay_groups
      add constraint pay_groups_effective_dates_valid
      check (effective_through is null or effective_through >= effective_from);
  end if;
end
$$;

alter table public.payroll_organization_settings
  add constraint payroll_organization_settings_no_overlap
  exclude using gist (
    organization_id with =,
    daterange(effective_from, coalesce(effective_through + 1, 'infinity'::date), '[)') with &&
  );

alter table public.payroll_organization_settings
  add constraint payroll_organization_settings_external_payroll_organization_id_no_overlap
  exclude using gist (
    external_payroll_organization_id with =,
    daterange(effective_from, coalesce(effective_through + 1, 'infinity'::date), '[)') with &&
  );

create table if not exists public.pay_group_generation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  pay_group_id uuid not null,
  cadence public.pay_group_cadence not null,
  starts_on date not null,
  timezone text not null,
  effective_from date not null,
  effective_through date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (pay_group_id, organization_id)
    references public.pay_groups(id, organization_id) on delete restrict,
  check (cadence in ('weekly', 'biweekly')),
  check (effective_through is null or effective_through >= effective_from)
);

alter table public.pay_group_generation_versions
  add constraint pay_group_generation_versions_no_overlap
  exclude using gist (
    organization_id with =,
    pay_group_id with =,
    daterange(effective_from, coalesce(effective_through + 1, 'infinity'::date), '[)') with &&
  );

alter table public.pay_periods
  add constraint pay_periods_no_overlap
  exclude using gist (
    organization_id with =,
    pay_group_id with =,
    daterange(starts_on, ends_on + 1, '[)') with &&
  );

create index if not exists payroll_organization_settings_active_idx
  on public.payroll_organization_settings (organization_id, effective_from desc, effective_through);

create index if not exists pay_groups_active_idx
  on public.pay_groups (organization_id, effective_from desc, effective_through);

create index if not exists pay_group_generation_versions_active_idx
  on public.pay_group_generation_versions (organization_id, pay_group_id, effective_from desc, effective_through);

create index if not exists employee_rate_versions_history_lookup_idx
  on public.employee_rate_versions (
    organization_id,
    employment_profile_id,
    effective_from desc,
    created_at desc,
    id desc
  );

create or replace function app.jsonb_contains_authority_fields(p_payload jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_child jsonb;
begin
  if p_payload is null then
    return false;
  end if;

  case jsonb_typeof(p_payload)
    when 'object' then
      for v_item in
        select entry.key, entry.value
        from jsonb_each(p_payload) entry
      loop
        if lower(v_item.key) in (
          'organization_id',
          'organizationid',
          'actor_user_id',
          'actoruserid',
          'actor_id',
          'actorid'
        ) then
          return true;
        end if;
        if app.jsonb_contains_authority_fields(v_item.value) then
          return true;
        end if;
      end loop;
      return false;
    when 'array' then
      for v_child in
        select value
        from jsonb_array_elements(p_payload)
      loop
        if app.jsonb_contains_authority_fields(v_child) then
          return true;
        end if;
      end loop;
      return false;
    else
      return false;
  end case;
end;
$$;

create or replace function app.current_user_is_payroll_admin(
  p_target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles membership
    join public.roles role_row on role_row.id = membership.role_id
    where membership.user_id = auth.uid()
      and membership.is_active is true
      and (membership.expires_at is null or membership.expires_at > pg_catalog.now())
      and role_row.name in ('admin', 'super_admin')
      and app.payroll_actor_in_organization(p_target_organization_id)
  );
$$;

create or replace function app.payroll_containing_period(
  p_anchor_starts_on date,
  p_target_date date,
  p_cadence public.pay_group_cadence
)
returns table (
  starts_on date,
  ends_on date
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_length_days integer;
  v_bucket integer;
  v_period_start date;
begin
  if p_anchor_starts_on is null or p_target_date is null or p_cadence is null then
    raise exception using errcode = '22023', message = 'anchor, target date, and cadence are required';
  end if;

  case
    when p_cadence = 'weekly' then
      v_length_days := 7;
    when p_cadence = 'biweekly' then
      v_length_days := 14;
    when p_cadence = 'monthly' then
      raise exception using errcode = '22023', message = 'monthly cadence is unsupported for payroll administration';
    else
      raise exception using errcode = '22023', message = 'unsupported payroll cadence';
  end case;

  v_bucket := floor(((p_target_date - p_anchor_starts_on)::numeric) / v_length_days::numeric);
  v_period_start := p_anchor_starts_on + (v_bucket * v_length_days);

  return query
  select v_period_start, v_period_start + (v_length_days - 1);
end;
$$;

create or replace function app.resolve_active_payroll_generation_version(
  p_target_organization_id uuid,
  p_pay_group_id uuid,
  p_selected_date date
)
returns public.pay_group_generation_versions
language sql
stable
security definer
set search_path = ''
as $$
  select version_row
  from public.pay_group_generation_versions version_row
  where version_row.organization_id = p_target_organization_id
    and version_row.pay_group_id = p_pay_group_id
    and version_row.effective_from <= p_selected_date
    and (version_row.effective_through is null or version_row.effective_through >= p_selected_date)
  order by version_row.effective_from desc, version_row.created_at desc, version_row.id desc
  limit 1;
$$;

create or replace function app.redact_payroll_administration_audit_payload(
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_action = 'add_rate_version' then
    return (coalesce(p_payload, '{}'::jsonb) - 'hourlyRateCents')
      || jsonb_build_object('compensationRedacted', true);
  end if;

  return coalesce(p_payload, '{}'::jsonb);
end;
$$;

create or replace function app.payroll_administration_lock_scope(
  p_action text,
  p_target_organization_id uuid,
  p_payload jsonb
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_employment_id uuid := nullif(btrim(coalesce(p_payload ->> 'employmentProfileId', '')), '')::uuid;
  v_assignment_id uuid := nullif(btrim(coalesce(p_payload ->> 'managerAssignmentId', p_payload ->> 'payGroupAssignmentId', '')), '')::uuid;
  v_pay_group_id uuid := nullif(btrim(coalesce(p_payload ->> 'payGroupId', '')), '')::uuid;
  v_user_id uuid := nullif(btrim(coalesce(p_payload ->> 'userId', '')), '')::uuid;
  v_capability text := nullif(btrim(coalesce(p_payload ->> 'capability', '')), '');
  v_external_payroll_organization_id text := nullif(btrim(coalesce(p_payload ->> 'externalPayrollOrganizationId', '')), '');
  v_pay_group_name text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
begin
  case p_action
    when 'create_org_settings', 'supersede_org_settings' then
      return format(
        'payroll-administration:org-settings:%s:%s',
        p_target_organization_id,
        coalesce(v_external_payroll_organization_id, 'unkeyed')
      );
    when 'create_employment', 'deactivate_employment', 'add_rate_version', 'create_manager_assignment', 'create_pay_group_assignment' then
      return format(
        'payroll-administration:employment:%s:%s',
        p_target_organization_id,
        coalesce(v_employment_id::text, 'pending')
      );
    when 'deactivate_manager_assignment', 'deactivate_pay_group_assignment' then
      return format(
        'payroll-administration:assignment:%s:%s:%s',
        p_target_organization_id,
        p_action,
        coalesce(v_assignment_id::text, 'pending')
      );
    when 'grant_capability', 'revoke_capability' then
      return format(
        'payroll-administration:capability:%s:%s:%s',
        p_target_organization_id,
        coalesce(v_user_id::text, 'pending'),
        coalesce(v_capability, 'pending')
      );
    when 'create_pay_group' then
      return format(
        'payroll-administration:pay-group-name:%s:%s',
        p_target_organization_id,
        coalesce(v_pay_group_name, 'pending')
      );
    when 'deactivate_pay_group', 'set_generation_version', 'generate_periods' then
      return format(
        'payroll-administration:pay-group:%s:%s:%s',
        p_target_organization_id,
        p_action,
        coalesce(v_pay_group_id::text, 'pending')
      );
    else
      return format('payroll-administration:%s:%s', p_target_organization_id, p_action);
  end case;
end;
$$;

create or replace function app.payroll_generation_boundary_has_facts(
  p_target_organization_id uuid,
  p_pay_group_id uuid,
  p_boundary date,
  p_timezone text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    exists (
      select 1
      from public.pay_periods pay_period
      where pay_period.organization_id = p_target_organization_id
        and pay_period.pay_group_id = p_pay_group_id
        and pay_period.ends_on >= p_boundary
    )
    or exists (
      select 1
      from public.timesheet_snapshots snapshot_row
      join public.pay_periods pay_period
        on pay_period.organization_id = snapshot_row.organization_id
       and pay_period.id = snapshot_row.pay_period_id
      where snapshot_row.organization_id = p_target_organization_id
        and pay_period.pay_group_id = p_pay_group_id
        and pay_period.ends_on >= p_boundary
    )
    or exists (
      select 1
      from public.employee_time_events event_row
      join public.pay_group_assignments assignment_row
        on assignment_row.organization_id = event_row.organization_id
       and assignment_row.employment_profile_id = event_row.employment_profile_id
       and ((event_row.event_at at time zone p_timezone)::date) >= assignment_row.effective_from
       and (
         assignment_row.effective_through is null
         or ((event_row.event_at at time zone p_timezone)::date) <= assignment_row.effective_through
       )
      where event_row.organization_id = p_target_organization_id
        and assignment_row.pay_group_id = p_pay_group_id
        and ((event_row.event_at at time zone p_timezone)::date) >= p_boundary
    )
    or exists (
      select 1
      from public.session_attendance_events event_row
      join public.pay_group_assignments assignment_row
        on assignment_row.organization_id = event_row.organization_id
       and assignment_row.employment_profile_id = event_row.employment_profile_id
       and ((event_row.event_at at time zone p_timezone)::date) >= assignment_row.effective_from
       and (
         assignment_row.effective_through is null
         or ((event_row.event_at at time zone p_timezone)::date) <= assignment_row.effective_through
       )
      where event_row.organization_id = p_target_organization_id
        and assignment_row.pay_group_id = p_pay_group_id
        and ((event_row.event_at at time zone p_timezone)::date) >= p_boundary
    )
  );
$$;

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
  v_corrections jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_selected_local_date date := coalesce(selected_local_date, current_date);
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if app.payroll_actor_has_capability(v_actor_org, 'time.view_self') is not true then
    raise exception using errcode = '42501', message = 'time.view_self capability is required';
  end if;

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
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', null,
      'employmentTimezone', null
    );
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.user_id = v_actor
    and employment.active_from <= v_selected_local_date
    and (employment.active_through is null or employment.active_through >= v_selected_local_date)
  order by employment.active_from desc, employment.created_at desc, employment.id desc
  limit 1;

  select settings.*
  into v_settings
  from public.payroll_organization_settings settings
  where settings.organization_id = v_actor_org
    and settings.effective_from <= v_selected_local_date
    and (settings.effective_through is null or settings.effective_through >= v_selected_local_date)
  order by settings.effective_from desc, settings.created_at desc, settings.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone
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
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone
    );
  end if;

  if v_employment.home_jurisdiction <> 'CA' then
    return jsonb_build_object(
      'state', 'unsupported_jurisdiction',
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone
    );
  end if;

  select assignment.*
  into v_pay_group_assignment
  from public.pay_group_assignments assignment
  where assignment.organization_id = v_actor_org
    and assignment.employment_profile_id = v_employment.id
    and assignment.effective_from <= v_selected_local_date
    and (assignment.effective_through is null or assignment.effective_through >= v_selected_local_date)
  order by assignment.effective_from desc, assignment.created_at desc, assignment.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone
    );
  end if;

  select pay_group.*
  into v_pay_group
  from public.pay_groups pay_group
  where pay_group.organization_id = v_actor_org
    and pay_group.id = v_pay_group_assignment.pay_group_id
    and pay_group.effective_from <= v_selected_local_date
    and (pay_group.effective_through is null or pay_group.effective_through >= v_selected_local_date)
  order by pay_group.effective_from desc, pay_group.created_at desc, pay_group.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone
    );
  end if;

  select pay_period.*
  into v_pay_period
  from public.pay_periods pay_period
  where pay_period.organization_id = v_actor_org
    and pay_period.pay_group_id = v_pay_group.id
    and v_selected_local_date between pay_period.starts_on and pay_period.ends_on
  order by pay_period.starts_on desc, pay_period.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone
    );
  end if;

  select policy.*
  into v_policy
  from public.payroll_policy_versions policy
  where (policy.organization_id is null or policy.organization_id = v_actor_org)
    and policy.jurisdiction = v_employment.home_jurisdiction
    and policy.activation_status = 'active'
    and policy.effective_from <= v_selected_local_date
    and (policy.effective_through is null or policy.effective_through >= v_selected_local_date)
    and (v_pay_group.cadence <> 'monthly' or policy.supports_monthly_nonexempt is true)
  order by (policy.organization_id is not null) desc, policy.effective_from desc, policy.created_at desc, policy.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'unsupported_policy',
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', event_row.id,
        'eventType', event_row.event_type,
        'occurredAt', event_row.event_at,
        'timezone', event_row.source_timezone,
        'workLocation', event_row.work_location,
        'workCategory', event_row.work_category
      )
      order by event_row.event_at, event_row.created_at, event_row.id
    ),
    '[]'::jsonb
  )
  into v_events
  from public.employee_time_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id
    and (v_pay_period.id is null or event_row.event_at at time zone v_pay_group.timezone between v_pay_period.starts_on::timestamp and (v_pay_period.ends_on + 1)::timestamp - interval '1 second');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', request_row.id,
        'createdAt', request_row.created_at,
        'reasonCode', request_row.reason_code
      )
      order by request_row.created_at, request_row.id
    ),
    '[]'::jsonb
  )
  into v_corrections
  from public.time_correction_requests request_row
  where request_row.organization_id = v_actor_org
    and request_row.employment_profile_id = v_employment.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', exception_row.id,
        'code', exception_row.exception_code,
        'createdAt', exception_row.created_at
      )
      order by exception_row.created_at, exception_row.id
    ),
    '[]'::jsonb
  )
  into v_exceptions
  from public.timekeeping_exceptions exception_row
  where exception_row.organization_id = v_actor_org
    and exception_row.employment_profile_id = v_employment.id;

  v_snapshot := jsonb_build_object(
    'period', jsonb_build_object(
      'employmentProfileId', v_employment.id,
      'payPeriodId', v_pay_period.id,
      'periodStart', v_pay_period.starts_on,
      'periodEnd', v_pay_period.ends_on,
      'payGroupId', v_pay_group.id,
      'payGroupCadence', v_pay_group.cadence,
      'payGroupTimezone', v_pay_group.timezone
    ),
    'events', v_events,
    'corrections', v_corrections,
    'exceptions', v_exceptions
  );

  return jsonb_build_object(
    'state', 'ok',
    'selectedLocalDate', v_selected_local_date,
    'employmentProfileId', v_employment.id,
    'employmentTimezone', v_employment.timezone,
    'snapshot', v_snapshot
  );
end;
$$;

create or replace function public.get_payroll_administration(
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
  v_selected_local_date date := coalesce(selected_local_date, current_date);
  v_history_limit integer := 50;
  v_policy_limit integer := 20;
  v_can_configure_employment boolean := false;
  v_can_resolve_exceptions boolean := false;
  v_can_lock_period boolean := false;
  v_can_reopen_period boolean := false;
  v_can_export_period boolean := false;
  v_can_view_compensation boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  -- Canonical payroll administration stays bound to role_row.name in ('admin', 'super_admin').
  if v_actor_org is null or not app.current_user_is_payroll_admin(v_actor_org) then
    raise exception using errcode = '42501', message = 'payroll administration access is required';
  end if;

  v_can_configure_employment := app.payroll_actor_has_capability(v_actor_org, 'payroll.configure_employment');
  v_can_resolve_exceptions := app.payroll_actor_has_capability(v_actor_org, 'payroll.resolve_exceptions');
  v_can_lock_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.lock_period');
  v_can_reopen_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.reopen_period');
  v_can_export_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.export_period');
  v_can_view_compensation := app.payroll_actor_has_capability(v_actor_org, 'payroll.view_compensation');

  if not (
    v_can_configure_employment
    or v_can_resolve_exceptions
    or v_can_lock_period
    or v_can_reopen_period
    or v_can_export_period
    or v_can_view_compensation
  ) then
    raise exception using errcode = '42501', message = 'payroll administration capability is required';
  end if;

  return jsonb_build_object(
    'state', 'ok',
    'selectedLocalDate', v_selected_local_date,
    'capabilities', jsonb_build_object(
      'canConfigureEmployment', v_can_configure_employment,
      'canResolveExceptions', v_can_resolve_exceptions,
      'canLockPeriod', v_can_lock_period,
      'canReopenPeriod', v_can_reopen_period,
      'canGeneratePeriods', v_can_export_period,
      'canViewCompensation', v_can_view_compensation,
      'canManagePolicyMutations', false
    ),
    'orgSettings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', settings.id,
          'externalPayrollOrganizationId', settings.external_payroll_organization_id,
          'timezone', settings.timezone,
          'workdayStartsAt', settings.workday_starts_at,
          'workweekStartsOn', settings.workweek_starts_on,
          'effectiveFrom', settings.effective_from,
          'effectiveThrough', settings.effective_through
        )
        order by settings.effective_from desc, settings.created_at desc, settings.id desc
      )
      from (
        select settings.*
        from public.payroll_organization_settings settings
        where settings.organization_id = v_actor_org
        order by settings.effective_from desc, settings.created_at desc, settings.id desc
        limit v_history_limit
      ) settings
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', policy.id,
          'jurisdiction', policy.jurisdiction,
          'policyName', policy.policy_name,
          'activationStatus', policy.activation_status,
          'supportsMonthlyNonexempt', policy.supports_monthly_nonexempt,
          'effectiveFrom', policy.effective_from,
          'effectiveThrough', policy.effective_through,
          'mutationsReadOnlyInV1', true
        )
        order by (policy.organization_id is not null) desc, policy.effective_from desc, policy.created_at desc, policy.id desc
      )
      from (
        select policy.*
        from public.payroll_policy_versions policy
        where (policy.organization_id is null or policy.organization_id = v_actor_org)
          and policy.effective_from <= v_selected_local_date
          and (policy.effective_through is null or policy.effective_through >= v_selected_local_date)
        order by (policy.organization_id is not null) desc, policy.effective_from desc, policy.created_at desc, policy.id desc
        limit v_policy_limit
      ) policy
    ), '[]'::jsonb),
    'employments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', employment.id,
          'userId', employment.user_id,
          'employeeNumber', employment.employee_number,
          'payrollEmployeeId', employment.payroll_employee_id,
          'classification', employment.classification,
          'homeJurisdiction', employment.home_jurisdiction,
          'timezone', employment.timezone,
          'activeFrom', employment.active_from,
          'activeThrough', employment.active_through
        ) || case
          when v_can_view_compensation then jsonb_build_object(
            'compensation', (
              case
                when rate_row.id is null then null
                else jsonb_build_object(
                  'hourlyRateCents', rate_row.hourly_rate_cents,
                  'effectiveFrom', rate_row.effective_from,
                  'effectiveThrough', rate_row.effective_through
                )
              end
            )
          ) else '{}'::jsonb end
        order by employment.active_from desc, employment.created_at desc, employment.id desc
      )
      from (
        select employment.*
        from public.employment_profiles employment
        where employment.organization_id = v_actor_org
        order by employment.active_from desc, employment.created_at desc, employment.id desc
        limit v_history_limit
      ) employment
      left join lateral (
        select rate_row.id, rate_row.hourly_rate_cents, rate_row.effective_from, rate_row.effective_through
        from public.employee_rate_versions rate_row
        where rate_row.organization_id = employment.organization_id
          and rate_row.employment_profile_id = employment.id
        order by rate_row.effective_from desc, rate_row.created_at desc, rate_row.id desc
        limit 1
      ) rate_row on true
    ), '[]'::jsonb),
    'payGroups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pay_group.id,
          'name', pay_group.name,
          'cadence', pay_group.cadence,
          'timezone', pay_group.timezone,
          'effectiveFrom', pay_group.effective_from,
          'effectiveThrough', pay_group.effective_through
        )
        order by pay_group.effective_from desc, pay_group.created_at desc, pay_group.id desc
      )
      from (
        select pay_group.*
        from public.pay_groups pay_group
        where pay_group.organization_id = v_actor_org
        order by pay_group.effective_from desc, pay_group.created_at desc, pay_group.id desc
        limit v_history_limit
      ) pay_group
    ), '[]'::jsonb),
    'generationVersions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', version_row.id,
          'payGroupId', version_row.pay_group_id,
          'cadence', version_row.cadence,
          'startsOn', version_row.starts_on,
          'timezone', version_row.timezone,
          'effectiveFrom', version_row.effective_from,
          'effectiveThrough', version_row.effective_through
        )
        order by version_row.effective_from desc, version_row.created_at desc, version_row.id desc
      )
      from (
        select version_row.*
        from public.pay_group_generation_versions version_row
        where version_row.organization_id = v_actor_org
        order by version_row.effective_from desc, version_row.created_at desc, version_row.id desc
        limit v_history_limit
      ) version_row
    ), '[]'::jsonb),
    'payPeriods', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pay_period.id,
          'payGroupId', pay_period.pay_group_id,
          'startsOn', pay_period.starts_on,
          'endsOn', pay_period.ends_on,
          'lockedAt', pay_period.locked_at,
          'exportedAt', pay_period.exported_at
        )
        order by pay_period.starts_on desc, pay_period.id desc
      )
      from (
        select pay_period.*
        from public.pay_periods pay_period
        where pay_period.organization_id = v_actor_org
        order by pay_period.starts_on desc, pay_period.id desc
        limit v_history_limit
      ) pay_period
    ), '[]'::jsonb),
    'bounds', jsonb_build_object(
      'orgSettings', v_history_limit,
      'policies', v_policy_limit,
      'employments', v_history_limit,
      'payGroups', v_history_limit,
      'generationVersions', v_history_limit,
      'payPeriods', v_history_limit
    )
  );
end;
$$;

create or replace function public.execute_payroll_administration(
  p_payload jsonb,
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
  v_action text;
  v_required_capability text;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_result jsonb;
  v_target_table text := 'payroll_administration';
  v_target_row_id uuid := gen_random_uuid();
  v_now timestamptz := timezone('utc', now());
  v_settings_effective_from date;
  v_settings_effective_through date;
  v_external_payroll_organization_id text;
  v_timezone text;
  v_workday_starts_at time;
  v_workweek_starts_on smallint;
  v_org_settings_id uuid;
  v_org_settings_row public.payroll_organization_settings%rowtype;
  v_employment_id uuid;
  v_user_id uuid;
  v_employee_number text;
  v_payroll_employee_id text;
  v_classification text;
  v_home_jurisdiction text;
  v_employment_timezone text;
  v_active_from date;
  v_active_through date;
  v_therapist_id uuid;
  v_employment_row public.employment_profiles%rowtype;
  v_hourly_rate_cents integer;
  v_effective_from_timestamptz timestamptz;
  v_effective_through_timestamptz timestamptz;
  v_rate_id uuid;
  v_manager_user_id uuid;
  v_assignment_id uuid;
  v_capability public.payroll_capability;
  v_pay_group_id uuid;
  v_pay_group_name text;
  v_pay_group_cadence public.pay_group_cadence;
  v_pay_group public.pay_groups%rowtype;
  v_generation_version_id uuid;
  v_generation_row public.pay_group_generation_versions%rowtype;
  v_generation_starts_on date;
  v_generation_cadence public.pay_group_cadence;
  v_from date;
  v_to date;
  v_cursor date;
  v_period_start date;
  v_period_end date;
  v_generated_count integer := 0;
  v_inserted_count integer := 0;
  v_temp date;
  v_lock_scope text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid payroll administration payload';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'idempotency_key is required';
  end if;

  if app.jsonb_contains_authority_fields(p_payload) then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.current_user_is_payroll_admin(v_actor_org) then
    raise exception using errcode = '42501', message = 'payroll administration access is required';
  end if;

  v_action := lower(coalesce(nullif(btrim(p_payload ->> 'action'), ''), ''));
  if v_action = '' then
    raise exception using errcode = '22023', message = 'unsupported payroll administration action';
  end if;

  v_required_capability := case v_action
    when 'create_org_settings' then 'payroll.configure_employment'
    when 'supersede_org_settings' then 'payroll.configure_employment'
    when 'create_employment' then 'payroll.configure_employment'
    when 'deactivate_employment' then 'payroll.configure_employment'
    when 'add_rate_version' then 'payroll.configure_employment'
    when 'create_manager_assignment' then 'payroll.configure_employment'
    when 'deactivate_manager_assignment' then 'payroll.configure_employment'
    when 'grant_capability' then 'payroll.configure_employment'
    when 'revoke_capability' then 'payroll.configure_employment'
    when 'create_pay_group' then 'payroll.configure_employment'
    when 'deactivate_pay_group' then 'payroll.configure_employment'
    when 'create_pay_group_assignment' then 'payroll.configure_employment'
    when 'deactivate_pay_group_assignment' then 'payroll.configure_employment'
    when 'set_generation_version' then 'payroll.configure_employment'
    when 'generate_periods' then 'payroll.export_period'
    else null
  end;

  if v_required_capability is null then
    raise exception using errcode = '22023', message = 'unsupported payroll administration action';
  end if;

  if app.payroll_actor_has_capability(v_actor_org, v_required_capability) is not true then
    raise exception using errcode = '42501', message = format('%s capability is required', v_required_capability);
  end if;

  v_payload := p_payload - 'action';
  v_payload := jsonb_build_object('action', v_action) || coalesce(v_payload, '{}'::jsonb);
  v_payload_hash := app.payroll_hash_payload(v_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':execute_payroll_administration:' || btrim(p_idempotency_key),
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'execute_payroll_administration'
    and receipt.idempotency_key = btrim(p_idempotency_key)
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  v_lock_scope := app.payroll_administration_lock_scope(v_action, v_actor_org, p_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_lock_scope, 0)
  );

  case v_action
    when 'create_org_settings', 'supersede_org_settings' then
      -- Global payroll policy mutation is read-only in v1.
      v_settings_effective_from := nullif(btrim(p_payload ->> 'effectiveFrom'), '')::date;
      v_settings_effective_through := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::date;
      v_external_payroll_organization_id := nullif(btrim(p_payload ->> 'externalPayrollOrganizationId'), '');
      v_timezone := nullif(btrim(p_payload ->> 'timezone'), '');
      v_workday_starts_at := coalesce(nullif(btrim(p_payload ->> 'workdayStartsAt'), '')::time, time '00:00');
      v_workweek_starts_on := coalesce((p_payload ->> 'workweekStartsOn')::smallint, 0);

      if v_settings_effective_from is null or v_external_payroll_organization_id is null or v_timezone is null then
        raise exception using errcode = '22023', message = 'org settings payload is incomplete';
      end if;

      if v_action = 'create_org_settings' then
        if exists (
          select 1
          from public.payroll_organization_settings settings
          where settings.organization_id = v_actor_org
            and settings.effective_from <= v_settings_effective_from
            and (settings.effective_through is null or settings.effective_through >= v_settings_effective_from)
        ) then
          raise exception using errcode = '23514', message = 'active payroll organization settings already exist';
        end if;
      else
        select settings.*
        into v_org_settings_row
        from public.payroll_organization_settings settings
        where settings.organization_id = v_actor_org
          and settings.effective_through is null
        order by settings.effective_from desc, settings.created_at desc, settings.id desc
        limit 1;

        if not found then
          raise exception using errcode = '23514', message = 'active payroll organization settings do not exist';
        end if;

        update public.payroll_organization_settings
        set effective_through = v_settings_effective_from - 1
        where id = v_org_settings_row.id
          and organization_id = v_actor_org;
      end if;

      insert into public.payroll_organization_settings (
        organization_id,
        external_payroll_organization_id,
        timezone,
        workday_starts_at,
        workweek_starts_on,
        effective_from,
        effective_through,
        created_by
      ) values (
        v_actor_org,
        v_external_payroll_organization_id,
        v_timezone,
        v_workday_starts_at,
        v_workweek_starts_on,
        v_settings_effective_from,
        v_settings_effective_through,
        v_actor
      )
      returning id into v_org_settings_id;

      v_target_table := 'payroll_organization_settings';
      v_target_row_id := v_org_settings_id;
      v_result := jsonb_build_object(
        'action', v_action,
        'organizationSettingsId', v_org_settings_id,
        'replayed', false
      );

    when 'create_employment' then
      v_user_id := nullif(btrim(p_payload ->> 'userId'), '')::uuid;
      v_employee_number := nullif(btrim(p_payload ->> 'employeeNumber'), '');
      v_payroll_employee_id := nullif(btrim(p_payload ->> 'payrollEmployeeId'), '');
      v_classification := coalesce(nullif(btrim(p_payload ->> 'classification'), ''), 'nonexempt');
      v_home_jurisdiction := coalesce(nullif(btrim(p_payload ->> 'homeJurisdiction'), ''), 'CA');
      v_employment_timezone := nullif(btrim(p_payload ->> 'timezone'), '');
      v_active_from := nullif(btrim(p_payload ->> 'activeFrom'), '')::date;
      v_active_through := nullif(btrim(p_payload ->> 'activeThrough'), '')::date;
      v_therapist_id := nullif(btrim(p_payload ->> 'therapistId'), '')::uuid;

      if v_user_id is null or v_employee_number is null or v_payroll_employee_id is null or v_employment_timezone is null or v_active_from is null then
        raise exception using errcode = '22023', message = 'employment payload is incomplete';
      end if;

      if app.resolve_user_organization_id(v_user_id) is distinct from v_actor_org then
        raise exception using errcode = '42501', message = 'employment user is out of scope';
      end if;

      if v_therapist_id is not null and not exists (
        select 1
        from public.therapists therapist
        where therapist.id = v_therapist_id
          and therapist.organization_id = v_actor_org
      ) then
        raise exception using errcode = '42501', message = 'employment therapist is out of scope';
      end if;

      insert into public.employment_profiles (
        organization_id,
        user_id,
        employee_number,
        payroll_employee_id,
        classification,
        home_jurisdiction,
        timezone,
        active_from,
        active_through,
        therapist_id
      ) values (
        v_actor_org,
        v_user_id,
        v_employee_number,
        v_payroll_employee_id,
        v_classification,
        v_home_jurisdiction,
        v_employment_timezone,
        v_active_from,
        v_active_through,
        v_therapist_id
      )
      returning id into v_employment_id;

      v_target_table := 'employment_profiles';
      v_target_row_id := v_employment_id;
      v_result := jsonb_build_object('action', v_action, 'employmentProfileId', v_employment_id, 'replayed', false);

    when 'deactivate_employment' then
      v_employment_id := nullif(btrim(p_payload ->> 'employmentProfileId'), '')::uuid;
      v_active_through := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::date;

      if v_employment_id is null or v_active_through is null then
        raise exception using errcode = '22023', message = 'employment deactivation payload is incomplete';
      end if;

      update public.employment_profiles
      set active_through = v_active_through
      where organization_id = v_actor_org
        and id = v_employment_id
        and active_through is null
      returning * into v_employment_row;

      if not found then
        raise exception using errcode = '42501', message = 'employment profile is out of scope';
      end if;

      v_target_table := 'employment_profiles';
      v_target_row_id := v_employment_id;
      v_result := jsonb_build_object('action', v_action, 'employmentProfileId', v_employment_id, 'replayed', false);

    when 'add_rate_version' then
      v_employment_id := nullif(btrim(p_payload ->> 'employmentProfileId'), '')::uuid;
      v_hourly_rate_cents := (p_payload ->> 'hourlyRateCents')::integer;
      v_effective_from_timestamptz := nullif(btrim(p_payload ->> 'effectiveFrom'), '')::timestamptz;
      v_effective_through_timestamptz := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::timestamptz;

      if v_employment_id is null or v_hourly_rate_cents is null or v_effective_from_timestamptz is null then
        raise exception using errcode = '22023', message = 'rate payload is incomplete';
      end if;

      if not exists (
        select 1
        from public.employment_profiles employment
        where employment.organization_id = v_actor_org
          and employment.id = v_employment_id
      ) then
        raise exception using errcode = '42501', message = 'employment profile is out of scope';
      end if;

      insert into public.employee_rate_versions (
        organization_id,
        employment_profile_id,
        hourly_rate_cents,
        effective_from,
        effective_through,
        created_by
      ) values (
        v_actor_org,
        v_employment_id,
        v_hourly_rate_cents,
        v_effective_from_timestamptz,
        v_effective_through_timestamptz,
        v_actor
      )
      returning id into v_rate_id;

      v_target_table := 'employee_rate_versions';
      v_target_row_id := v_rate_id;
      v_result := jsonb_build_object('action', v_action, 'rateVersionId', v_rate_id, 'replayed', false);

    when 'create_manager_assignment' then
      v_employment_id := nullif(btrim(p_payload ->> 'employmentProfileId'), '')::uuid;
      v_manager_user_id := nullif(btrim(p_payload ->> 'managerUserId'), '')::uuid;
      v_effective_from_timestamptz := nullif(btrim(p_payload ->> 'effectiveFrom'), '')::timestamptz;
      v_effective_through_timestamptz := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::timestamptz;

      if v_employment_id is null or v_manager_user_id is null or v_effective_from_timestamptz is null then
        raise exception using errcode = '22023', message = 'manager assignment payload is incomplete';
      end if;

      if not exists (
        select 1
        from public.employment_profiles employment
        where employment.organization_id = v_actor_org
          and employment.id = v_employment_id
      ) then
        raise exception using errcode = '42501', message = 'employment profile is out of scope';
      end if;

      if app.resolve_user_organization_id(v_manager_user_id) is distinct from v_actor_org then
        raise exception using errcode = '42501', message = 'manager user is out of scope';
      end if;

      insert into public.employee_manager_assignments (
        organization_id,
        employment_profile_id,
        manager_user_id,
        effective_from,
        effective_through
      ) values (
        v_actor_org,
        v_employment_id,
        v_manager_user_id,
        v_effective_from_timestamptz,
        v_effective_through_timestamptz
      )
      returning id into v_assignment_id;

      v_target_table := 'employee_manager_assignments';
      v_target_row_id := v_assignment_id;
      v_result := jsonb_build_object('action', v_action, 'managerAssignmentId', v_assignment_id, 'replayed', false);

    when 'deactivate_manager_assignment' then
      v_assignment_id := nullif(btrim(p_payload ->> 'managerAssignmentId'), '')::uuid;
      v_effective_through_timestamptz := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::timestamptz;

      if v_assignment_id is null or v_effective_through_timestamptz is null then
        raise exception using errcode = '22023', message = 'manager assignment deactivation payload is incomplete';
      end if;

      update public.employee_manager_assignments
      set effective_through = v_effective_through_timestamptz
      where organization_id = v_actor_org
        and id = v_assignment_id
        and effective_through is null
      returning id into v_target_row_id;

      if not found then
        raise exception using errcode = '42501', message = 'manager assignment is out of scope';
      end if;

      v_target_table := 'employee_manager_assignments';
      v_result := jsonb_build_object('action', v_action, 'managerAssignmentId', v_target_row_id, 'replayed', false);

    when 'grant_capability' then
      v_user_id := nullif(btrim(p_payload ->> 'userId'), '')::uuid;
      v_capability := nullif(btrim(p_payload ->> 'capability'), '')::public.payroll_capability;
      v_effective_from_timestamptz := nullif(btrim(p_payload ->> 'effectiveFrom'), '')::timestamptz;
      v_effective_through_timestamptz := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::timestamptz;

      if v_user_id is null or v_capability is null or v_effective_from_timestamptz is null then
        raise exception using errcode = '22023', message = 'capability grant payload is incomplete';
      end if;

      if app.resolve_user_organization_id(v_user_id) is distinct from v_actor_org then
        raise exception using errcode = '42501', message = 'capability target user is out of scope';
      end if;

      insert into public.payroll_capability_grants (
        organization_id,
        user_id,
        capability,
        effective_from,
        effective_through,
        granted_by
      ) values (
        v_actor_org,
        v_user_id,
        v_capability,
        v_effective_from_timestamptz,
        v_effective_through_timestamptz,
        v_actor
      )
      returning id into v_target_row_id;

      v_target_table := 'payroll_capability_grants';
      v_result := jsonb_build_object('action', v_action, 'capabilityGrantId', v_target_row_id, 'replayed', false);

    when 'revoke_capability' then
      v_user_id := nullif(btrim(p_payload ->> 'userId'), '')::uuid;
      v_capability := nullif(btrim(p_payload ->> 'capability'), '')::public.payroll_capability;
      v_effective_through_timestamptz := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::timestamptz;

      if v_user_id is null or v_capability is null or v_effective_through_timestamptz is null then
        raise exception using errcode = '22023', message = 'capability revoke payload is incomplete';
      end if;

      update public.payroll_capability_grants
      set effective_through = v_effective_through_timestamptz
      where organization_id = v_actor_org
        and user_id = v_user_id
        and capability = v_capability
        and effective_through is null
      returning id into v_target_row_id;

      if not found then
        raise exception using errcode = '42501', message = 'capability grant is out of scope';
      end if;

      v_target_table := 'payroll_capability_grants';
      v_result := jsonb_build_object('action', v_action, 'capabilityGrantId', v_target_row_id, 'replayed', false);

    when 'create_pay_group' then
      v_pay_group_name := nullif(btrim(p_payload ->> 'name'), '');
      v_pay_group_cadence := nullif(btrim(p_payload ->> 'cadence'), '')::public.pay_group_cadence;
      v_timezone := nullif(btrim(p_payload ->> 'timezone'), '');
      v_active_from := coalesce(nullif(btrim(p_payload ->> 'effectiveFrom'), '')::date, current_date);
      v_active_through := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::date;

      if v_pay_group_name is null or v_pay_group_cadence is null or v_timezone is null then
        raise exception using errcode = '22023', message = 'pay group payload is incomplete';
      end if;

      insert into public.pay_groups (
        organization_id,
        name,
        cadence,
        timezone,
        effective_from,
        effective_through,
        created_by
      ) values (
        v_actor_org,
        v_pay_group_name,
        v_pay_group_cadence,
        v_timezone,
        v_active_from,
        v_active_through,
        v_actor
      )
      returning id into v_pay_group_id;

      v_target_table := 'pay_groups';
      v_target_row_id := v_pay_group_id;
      v_result := jsonb_build_object('action', v_action, 'payGroupId', v_pay_group_id, 'replayed', false);

    when 'deactivate_pay_group' then
      v_pay_group_id := nullif(btrim(p_payload ->> 'payGroupId'), '')::uuid;
      v_active_through := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::date;

      if v_pay_group_id is null or v_active_through is null then
        raise exception using errcode = '22023', message = 'pay group deactivation payload is incomplete';
      end if;

      update public.pay_groups
      set effective_through = v_active_through
      where organization_id = v_actor_org
        and id = v_pay_group_id
        and effective_through is null
      returning id into v_target_row_id;

      if not found then
        raise exception using errcode = '42501', message = 'pay group is out of scope';
      end if;

      v_target_table := 'pay_groups';
      v_result := jsonb_build_object('action', v_action, 'payGroupId', v_target_row_id, 'replayed', false);

    when 'create_pay_group_assignment' then
      v_employment_id := nullif(btrim(p_payload ->> 'employmentProfileId'), '')::uuid;
      v_pay_group_id := nullif(btrim(p_payload ->> 'payGroupId'), '')::uuid;
      v_active_from := nullif(btrim(p_payload ->> 'effectiveFrom'), '')::date;
      v_active_through := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::date;

      if v_employment_id is null or v_pay_group_id is null or v_active_from is null then
        raise exception using errcode = '22023', message = 'pay group assignment payload is incomplete';
      end if;

      if not exists (
        select 1
        from public.employment_profiles employment
        where employment.organization_id = v_actor_org
          and employment.id = v_employment_id
      ) then
        raise exception using errcode = '42501', message = 'employment profile is out of scope';
      end if;

      if not exists (
        select 1
        from public.pay_groups pay_group
        where pay_group.organization_id = v_actor_org
          and pay_group.id = v_pay_group_id
      ) then
        raise exception using errcode = '42501', message = 'pay group is out of scope';
      end if;

      insert into public.pay_group_assignments (
        organization_id,
        employment_profile_id,
        pay_group_id,
        effective_from,
        effective_through
      ) values (
        v_actor_org,
        v_employment_id,
        v_pay_group_id,
        v_active_from,
        v_active_through
      )
      returning id into v_assignment_id;

      v_target_table := 'pay_group_assignments';
      v_target_row_id := v_assignment_id;
      v_result := jsonb_build_object('action', v_action, 'payGroupAssignmentId', v_assignment_id, 'replayed', false);

    when 'deactivate_pay_group_assignment' then
      v_assignment_id := nullif(btrim(p_payload ->> 'payGroupAssignmentId'), '')::uuid;
      v_active_through := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::date;

      if v_assignment_id is null or v_active_through is null then
        raise exception using errcode = '22023', message = 'pay group assignment deactivation payload is incomplete';
      end if;

      update public.pay_group_assignments
      set effective_through = v_active_through
      where organization_id = v_actor_org
        and id = v_assignment_id
        and effective_through is null
      returning id into v_target_row_id;

      if not found then
        raise exception using errcode = '42501', message = 'pay group assignment is out of scope';
      end if;

      v_target_table := 'pay_group_assignments';
      v_result := jsonb_build_object('action', v_action, 'payGroupAssignmentId', v_target_row_id, 'replayed', false);

    when 'set_generation_version' then
      v_pay_group_id := nullif(btrim(p_payload ->> 'payGroupId'), '')::uuid;
      v_pay_group_cadence := nullif(btrim(p_payload ->> 'cadence'), '')::public.pay_group_cadence;
      v_active_from := nullif(btrim(p_payload ->> 'effectiveFrom'), '')::date;
      v_active_through := nullif(btrim(p_payload ->> 'effectiveThrough'), '')::date;
      v_from := nullif(btrim(p_payload ->> 'startsOn'), '')::date;
      v_timezone := nullif(btrim(p_payload ->> 'timezone'), '');

      if v_pay_group_id is null or v_pay_group_cadence is null or v_active_from is null or v_from is null or v_timezone is null then
        raise exception using errcode = '22023', message = 'generation version payload is incomplete';
      end if;

      select pay_group.*
      into v_pay_group
      from public.pay_groups pay_group
      where pay_group.organization_id = v_actor_org
        and pay_group.id = v_pay_group_id
      limit 1;

      if not found then
        raise exception using errcode = '42501', message = 'pay group is out of scope';
      end if;

      if v_pay_group.cadence = 'monthly' or v_pay_group_cadence = 'monthly' then
        raise exception using errcode = '22023', message = 'monthly cadence is unsupported for payroll administration';
      end if;

      if app.payroll_generation_boundary_has_facts(
        v_actor_org,
        v_pay_group_id,
        v_active_from,
        v_timezone
      ) then
        raise exception using errcode = '23514', message = 'generation version boundary cannot change after payroll facts exist';
      end if;

      update public.pay_group_generation_versions
      set effective_through = v_active_from - 1
      where organization_id = v_actor_org
        and pay_group_id = v_pay_group_id
        and effective_from < v_active_from
        and (effective_through is null or effective_through >= v_active_from);

      insert into public.pay_group_generation_versions (
        organization_id,
        pay_group_id,
        cadence,
        starts_on,
        timezone,
        effective_from,
        effective_through,
        created_by
      ) values (
        v_actor_org,
        v_pay_group_id,
        v_pay_group_cadence,
        v_from,
        v_timezone,
        v_active_from,
        v_active_through,
        v_actor
      )
      returning id into v_generation_version_id;

      v_target_table := 'pay_group_generation_versions';
      v_target_row_id := v_generation_version_id;
      v_result := jsonb_build_object(
        'action', v_action,
        'generationVersionId', v_generation_version_id,
        'payGroupId', v_pay_group_id,
        'replayed', false
      );

    when 'generate_periods' then
      v_pay_group_id := nullif(btrim(p_payload ->> 'payGroupId'), '')::uuid;
      v_from := nullif(btrim(p_payload ->> 'from'), '')::date;
      v_to := nullif(btrim(p_payload ->> 'to'), '')::date;

      if v_pay_group_id is null or v_from is null or v_to is null then
        raise exception using errcode = '22023', message = 'period generation payload is incomplete';
      end if;

      if v_to < v_from then
        raise exception using errcode = '22023', message = 'period generation range is invalid';
      end if;

      if (v_to - v_from) > 730 then
        raise exception using errcode = '22023', message = 'period generation range exceeds two years';
      end if;

      select pay_group.*
      into v_pay_group
      from public.pay_groups pay_group
      where pay_group.organization_id = v_actor_org
        and pay_group.id = v_pay_group_id
      limit 1;

      if not found then
        raise exception using errcode = '42501', message = 'pay group is out of scope';
      end if;

      if v_pay_group.cadence = 'monthly' then
        raise exception using errcode = '22023', message = 'monthly cadence is unsupported for payroll administration';
      end if;

      v_cursor := v_from;
      while v_cursor <= v_to loop
        select version_row.starts_on, version_row.cadence
        into v_generation_starts_on, v_generation_cadence
        from public.pay_group_generation_versions version_row
        where version_row.organization_id = v_actor_org
          and version_row.pay_group_id = v_pay_group_id
          and version_row.effective_from <= v_cursor
          and (version_row.effective_through is null or version_row.effective_through >= v_cursor)
        order by version_row.effective_from desc, version_row.created_at desc, version_row.id desc
        limit 1;

        if not found then
          raise exception using errcode = '23514', message = 'generation version coverage is required for the requested range';
        end if;

        select period_row.starts_on, period_row.ends_on
        into v_period_start, v_period_end
        from app.payroll_containing_period(v_generation_starts_on, v_cursor, v_generation_cadence) period_row;

        insert into public.pay_periods (
          organization_id,
          pay_group_id,
          starts_on,
          ends_on
        ) values (
          v_actor_org,
          v_pay_group_id,
          v_period_start,
          v_period_end
        )
        on conflict (organization_id, pay_group_id, starts_on, ends_on) do nothing;

        get diagnostics v_inserted_count = row_count;
        v_generated_count := v_generated_count + v_inserted_count;
        v_cursor := v_period_end + 1;
      end loop;

      v_target_table := 'pay_periods';
      v_target_row_id := v_pay_group_id;
      v_result := jsonb_build_object(
        'action', v_action,
        'payGroupId', v_pay_group_id,
        'generatedCount', v_generated_count,
        'replayed', false
      );
  end case;

  if v_action = 'generate_periods' then
    if not exists (
      select 1
      from public.pay_periods pay_period
      where pay_period.organization_id = v_actor_org
        and pay_period.pay_group_id = v_pay_group_id
    ) then
      raise exception using errcode = '23514', message = 'period generation produced no periods';
    end if;
  end if;

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
    'execute_payroll_administration',
    v_target_table,
    v_target_row_id,
    app.redact_payroll_administration_audit_payload(v_action, v_payload)
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
    'execute_payroll_administration',
    btrim(p_idempotency_key),
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

alter table public.pay_group_generation_versions enable row level security;
alter table public.pay_group_generation_versions force row level security;

create policy pay_group_generation_versions_authenticated_select
  on public.pay_group_generation_versions
  for select
  to authenticated
  using (
    app.current_user_is_payroll_admin(organization_id)
    and (
      app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
      or app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
    )
  );

revoke all on public.pay_group_generation_versions from public, anon, authenticated;
revoke all on public.pay_group_generation_versions from service_role;
grant select on public.pay_group_generation_versions to authenticated;

revoke all on function app.jsonb_contains_authority_fields(jsonb) from public, anon, authenticated, service_role;
revoke all on function app.current_user_is_payroll_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function app.payroll_containing_period(date, date, public.pay_group_cadence) from public, anon, authenticated, service_role;
revoke all on function app.resolve_active_payroll_generation_version(uuid, uuid, date) from public, anon, authenticated, service_role;
revoke all on function app.redact_payroll_administration_audit_payload(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function app.payroll_administration_lock_scope(text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function app.payroll_generation_boundary_has_facts(uuid, uuid, date, text) from public, anon, authenticated, service_role;

revoke all on function public.execute_payroll_administration(jsonb, text) from public, anon, service_role;
revoke all on function public.execute_payroll_administration(jsonb, text) from authenticated;
grant execute on function public.execute_payroll_administration(jsonb, text) to authenticated;

revoke all on function public.get_payroll_administration(date) from public, anon, service_role;
revoke all on function public.get_payroll_administration(date) from authenticated;
grant execute on function public.get_payroll_administration(date) to authenticated;

commit;
