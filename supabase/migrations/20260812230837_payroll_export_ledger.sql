-- @migration-intent: payroll_export_ledger
-- @migration-dependencies: 20260812153628_payroll_administration.sql
-- @migration-rollback: Drop the payroll export ledger tables, helper functions, triggers, policies, and RPCs; restore the pre-export compatibility-only `pay_periods.exported_at` behavior after a clean local reset confirms no dependent export rows remain.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.payroll_export_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  pay_period_id uuid not null,
  pay_group_id uuid not null,
  adjusts_export_run_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  adapter_version text not null default 'provider-neutral-v1',
  canonical_hash text not null check (canonical_hash ~ '^[0-9a-f]{64}$'),
  csv_sha256 text not null check (csv_sha256 ~ '^[0-9a-f]{64}$'),
  csv_bytes bytea not null,
  source_snapshot_count integer not null check (source_snapshot_count >= 0),
  source_row_count integer not null check (source_row_count >= 0),
  row_count integer not null check (row_count >= 0),
  total_regular_seconds integer not null default 0,
  total_overtime_seconds integer not null default 0,
  total_double_time_seconds integer not null default 0,
  total_meal_premium_cents integer not null default 0,
  total_gross_cents integer not null default 0,
  exported_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  unique (organization_id, pay_period_id, canonical_hash),
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict,
  foreign key (pay_group_id, organization_id)
    references public.pay_groups(id, organization_id) on delete restrict,
  foreign key (adjusts_export_run_id, organization_id)
    references public.payroll_export_runs(id, organization_id) on delete restrict
);

create table if not exists public.payroll_export_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  export_run_id uuid not null,
  adjusts_export_run_id uuid,
  pay_period_id uuid not null,
  pay_group_id uuid not null,
  employment_profile_id uuid not null,
  snapshot_id uuid not null,
  export_position integer not null check (export_position > 0),
  schema_version text not null default 'provider-neutral-v1',
  organization_payroll_id text not null,
  employee_payroll_id text not null,
  period_start date not null,
  period_end date not null,
  work_date date not null,
  earning_code text not null check (earning_code in ('REG', 'OT', 'DT', 'MEAL_PREMIUM')),
  seconds integer not null,
  base_rate_cents integer not null check (base_rate_cents >= 0),
  applied_rate_numerator integer not null check (applied_rate_numerator in (1, 2, 3)),
  applied_rate_denominator integer not null check (applied_rate_denominator in (1, 2)),
  gross_cents integer not null,
  correction_indicator text not null default 'N',
  snapshot_version integer not null check (snapshot_version > 0),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  unique (export_run_id, export_position),
  foreign key (export_run_id, organization_id)
    references public.payroll_export_runs(id, organization_id) on delete restrict,
  foreign key (adjusts_export_run_id, organization_id)
    references public.payroll_export_runs(id, organization_id) on delete restrict,
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict,
  foreign key (pay_group_id, organization_id)
    references public.pay_groups(id, organization_id) on delete restrict,
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (snapshot_id, organization_id, employment_profile_id, pay_period_id)
    references public.timesheet_snapshots(id, organization_id, employment_profile_id, pay_period_id) on delete restrict
);

create index if not exists payroll_export_runs_period_exported_idx
  on public.payroll_export_runs (organization_id, pay_period_id, exported_at desc, id desc);

create index if not exists payroll_export_rows_run_position_idx
  on public.payroll_export_rows (organization_id, export_run_id, export_position);

create index if not exists payroll_export_rows_rebuild_idx
  on public.payroll_export_rows (
    organization_id,
    pay_period_id,
    employee_payroll_id,
    work_date,
    earning_code,
    export_run_id,
    export_position
  );

create or replace function app.reject_payroll_export_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Payroll export ledger rows are append-only';
end;
$$;

create or replace function app.is_safe_payroll_export_identifier(
  p_value text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_value is not null
    and char_length(btrim(p_value)) between 1 and 128
    and btrim(p_value) !~ '^[=+\-@]'
    and btrim(p_value) !~ '[\r\n\t]';
$$;

create or replace function app.payroll_export_hours_text(
  p_seconds integer
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select to_char((coalesce(p_seconds, 0)::numeric / 3600::numeric), 'FM999999990.000000');
$$;

create or replace function app.payroll_export_money_text(
  p_cents integer
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select to_char((coalesce(p_cents, 0)::numeric / 100::numeric), 'FM999999990.00');
$$;

create or replace function app.payroll_export_applied_rate_text(
  p_base_rate_cents integer,
  p_numerator integer,
  p_denominator integer
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select to_char(
    coalesce(p_numerator, 0)::numeric
    / greatest(coalesce(p_denominator, 1), 1)::numeric,
    'FM999999990.00'
  );
$$;

create or replace function app.payroll_csv_escape(
  p_value text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_value is null then ''
    when p_value ~ '[,"\r\n]' then '"' || replace(p_value, '"', '""') || '"'
    else p_value
  end;
$$;

create or replace function public.create_payroll_export(
  payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_pay_period_id uuid;
  v_adapter_version text;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_existing_run public.payroll_export_runs%rowtype;
  v_previous_run public.payroll_export_runs%rowtype;
  v_new_run_id uuid := gen_random_uuid();
  v_result jsonb;
  v_csv_header text :=
    'schema_version,export_id,adjusts_export_id,organization_payroll_id,employee_payroll_id,pay_group_id,period_start,period_end,work_date,earning_code,hours,base_rate,applied_rate,gross_earnings,correction_indicator,snapshot_version,snapshot_hash';
  v_csv_body text := '';
  v_csv_text text;
  v_csv_bytes bytea;
  v_csv_sha256 text;
  v_source_snapshot_count integer := 0;
  v_source_row_count integer := 0;
  v_export_row_count integer := 0;
  v_total_regular_seconds integer := 0;
  v_total_overtime_seconds integer := 0;
  v_total_double_time_seconds integer := 0;
  v_total_meal_premium_cents integer := 0;
  v_total_gross_cents integer := 0;
  v_canonical_hash text;
  v_pay_group_id uuid;
  v_period_start date;
  v_period_end date;
  v_payroll_timezone text;
  v_pay_group_id_text text;
  v_organization_payroll_id text;
  v_exported_at timestamptz := timezone('utc', now());
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authenticated payroll export access is required';
  end if;

  if payload is null or app.jsonb_contains_authority_fields(payload) then
    raise exception using errcode = '42501', message = 'actor and organization are derived from auth context';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(coalesce(payload, '{}'::jsonb)) as payload_key(key)
    where payload_key.key not in ('payPeriodId', 'adapterVersion')
  ) then
    raise exception using errcode = '22023', message = 'unknown payload field';
  end if;

  if idempotency_key is null or btrim(idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;

  v_adapter_version := coalesce(nullif(btrim(payload ->> 'adapterVersion'), ''), 'provider-neutral-v1');
  if v_adapter_version <> 'provider-neutral-v1' then
    raise exception using errcode = '22023', message = 'unsupported adapter version';
  end if;

  v_pay_period_id := nullif(btrim(payload ->> 'payPeriodId'), '')::uuid;
  if v_pay_period_id is null then
    raise exception using errcode = '22023', message = 'pay period id is required';
  end if;

  v_payload := jsonb_build_object(
    'payPeriodId', v_pay_period_id,
    'adapterVersion', v_adapter_version
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);
  v_actor_org := app.resolve_user_organization_id(v_actor);

  if v_actor_org is null or not app.current_user_is_payroll_admin(v_actor_org) then
    raise exception using errcode = '42501', message = 'payroll export administration access is required';
  end if;

  if app.payroll_actor_has_capability(v_actor_org, 'payroll.export_period') is not true then
    raise exception using errcode = '42501', message = 'payroll.export_period capability is required';
  end if;

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'create_payroll_export'
    and receipt.idempotency_key = btrim(idempotency_key);

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      format('payroll-export:%s:%s', v_actor_org, v_pay_period_id),
      0
    )
  );

  select
    pay_period.pay_group_id,
    pay_period.starts_on,
    pay_period.ends_on,
    settings.external_payroll_organization_id,
    settings.timezone
  into
    v_pay_group_id,
    v_period_start,
    v_period_end,
    v_organization_payroll_id,
    v_payroll_timezone
  from public.pay_periods pay_period
  join public.payroll_organization_settings settings
    on settings.organization_id = pay_period.organization_id
  where pay_period.organization_id = v_actor_org
    and pay_period.id = v_pay_period_id
  order by settings.created_at desc, settings.id desc
  limit 1;

  if v_pay_group_id is null then
    raise exception using errcode = '42501', message = 'pay period is out of scope';
  end if;

  v_pay_group_id_text := v_pay_group_id::text;

  create temporary table temp_payroll_export_assigned_employments on commit drop as
  select distinct
    assignment.organization_id,
    assignment.pay_group_id,
    assignment.employment_profile_id,
    employment.payroll_employee_id
  from public.pay_group_assignments assignment
  join public.employment_profiles employment
    on employment.organization_id = assignment.organization_id
   and employment.id = assignment.employment_profile_id
  where assignment.organization_id = v_actor_org
    and assignment.pay_group_id = v_pay_group_id
    and daterange(
          assignment.effective_from,
          coalesce(assignment.effective_through + 1, 'infinity'::date),
          '[)'
        ) && daterange(v_period_start, v_period_end + 1, '[)')
    and daterange(
          employment.active_from,
          coalesce(employment.active_through + 1, 'infinity'::date),
          '[)'
        ) && daterange(v_period_start, v_period_end + 1, '[)');

  create temporary table temp_payroll_export_locked_snapshots on commit drop as
  with locked_states as (
    select
      approval_row.organization_id,
      approval_row.pay_period_id,
      approval_row.employment_profile_id,
      approval_row.snapshot_id,
      approval_row.snapshot_hash
    from public.timesheet_approval_current_states approval_row
    where approval_row.organization_id = v_actor_org
      and approval_row.pay_period_id = v_pay_period_id
      and approval_row.action = 'locked'
  )
  select
    locked_states.organization_id,
    locked_states.pay_period_id,
    locked_states.employment_profile_id,
    locked_states.snapshot_id,
    locked_states.snapshot_hash,
    snapshot_row.snapshot_version,
    snapshot_row.regular_seconds,
    snapshot_row.overtime_seconds,
    snapshot_row.double_time_seconds,
    snapshot_row.meal_premium_cents,
    snapshot_row.gross_earnings_cents
  from locked_states
  join public.timesheet_snapshots snapshot_row
    on snapshot_row.organization_id = locked_states.organization_id
   and snapshot_row.pay_period_id = locked_states.pay_period_id
   and snapshot_row.employment_profile_id = locked_states.employment_profile_id
   and snapshot_row.id = locked_states.snapshot_id
   and snapshot_row.canonical_snapshot_hash = locked_states.snapshot_hash
  join public.timesheet_snapshot_current_heads head_row
    on head_row.organization_id = locked_states.organization_id
   and head_row.pay_period_id = locked_states.pay_period_id
   and head_row.employment_profile_id = locked_states.employment_profile_id
   and head_row.snapshot_id = locked_states.snapshot_id;

  select count(*)::integer
  into v_source_snapshot_count
  from temp_payroll_export_locked_snapshots;

  if v_source_snapshot_count = 0 then
    raise exception using errcode = '23514', message = 'current locked snapshot set is required';
  end if;

  if exists (
    select 1
    from public.timesheet_approval_current_states approval_row
    where approval_row.organization_id = v_actor_org
      and approval_row.pay_period_id = v_pay_period_id
      and approval_row.action <> 'locked'
  ) then
    raise exception using errcode = '23514', message = 'current locked snapshot set is required';
  end if;

  if exists (
    select 1
    from temp_payroll_export_assigned_employments assigned
    left join temp_payroll_export_locked_snapshots locked
      on locked.organization_id = assigned.organization_id
     and locked.employment_profile_id = assigned.employment_profile_id
    where locked.employment_profile_id is null
  )
  or exists (
    select 1
    from temp_payroll_export_locked_snapshots locked
    left join temp_payroll_export_assigned_employments assigned
      on assigned.organization_id = locked.organization_id
     and assigned.employment_profile_id = locked.employment_profile_id
    where assigned.employment_profile_id is null
  ) then
    raise exception using errcode = '23514', message = 'assigned active employment population must match current locked snapshot population';
  end if;

  if exists (
    select 1
    from temp_payroll_export_locked_snapshots locked
    where app.payroll_unresolved_blocker_count(
      locked.organization_id,
      locked.employment_profile_id,
      locked.pay_period_id
    ) <> 0
  ) then
    raise exception using errcode = '23514', message = 'blocking issues remain unresolved';
  end if;

  create temporary table temp_payroll_export_raw_rows on commit drop as
  with snapshot_lines as (
    select
      locked.organization_id,
      locked.pay_period_id,
      v_pay_group_id as pay_group_id,
      locked.employment_profile_id,
      locked.snapshot_id,
      locked.snapshot_hash,
      locked.snapshot_version,
      v_organization_payroll_id as organization_payroll_id,
      employment.payroll_employee_id as employee_payroll_id,
      v_pay_group_id_text as pay_group_id_text,
      v_period_start as period_start,
      v_period_end as period_end,
      line_row.line_type,
      line_row.line_code,
      line_row.line_payload
    from temp_payroll_export_locked_snapshots locked
    join public.employment_profiles employment
      on employment.organization_id = locked.organization_id
     and employment.id = locked.employment_profile_id
    join public.timesheet_snapshot_lines line_row
      on line_row.organization_id = locked.organization_id
     and line_row.pay_period_id = locked.pay_period_id
     and line_row.employment_profile_id = locked.employment_profile_id
     and line_row.snapshot_id = locked.snapshot_id
  ),
  segment_rows as (
    select
      snapshot_line.organization_id,
      snapshot_line.pay_period_id,
      snapshot_line.pay_group_id,
      snapshot_line.employment_profile_id,
      snapshot_line.snapshot_id,
      snapshot_line.snapshot_hash,
      snapshot_line.snapshot_version,
      snapshot_line.organization_payroll_id,
      snapshot_line.employee_payroll_id,
      snapshot_line.pay_group_id_text,
      snapshot_line.period_start,
      snapshot_line.period_end,
      (snapshot_line.line_payload ->> 'dayKey')::date as work_date,
      case snapshot_line.line_code
        when 'regular' then 'REG'
        when 'overtime' then 'OT'
        when 'doubletime' then 'DT'
        else null
      end as earning_code,
      (snapshot_line.line_payload ->> 'seconds')::integer as seconds,
      rate_row.hourly_rate_cents as base_rate_cents,
      case snapshot_line.line_code
        when 'regular' then 1
        when 'overtime' then 3
        when 'doubletime' then 2
        else null
      end as applied_rate_numerator,
      case snapshot_line.line_code
        when 'overtime' then 2
        else 1
      end as applied_rate_denominator,
      (snapshot_line.line_payload ->> 'grossCents')::integer as gross_cents
    from snapshot_lines snapshot_line
    join public.employee_rate_versions rate_row
      on rate_row.organization_id = snapshot_line.organization_id
     and rate_row.employment_profile_id = snapshot_line.employment_profile_id
     and rate_row.id = (snapshot_line.line_payload ->> 'rateVersionId')::uuid
    where snapshot_line.line_type = 'segment'
      and snapshot_line.line_code in ('regular', 'overtime', 'doubletime')
      and (snapshot_line.line_payload ->> 'hourlyRateCents')::integer = rate_row.hourly_rate_cents
  ),
  premium_rows as (
    select
      snapshot_line.organization_id,
      snapshot_line.pay_period_id,
      snapshot_line.pay_group_id,
      snapshot_line.employment_profile_id,
      snapshot_line.snapshot_id,
      snapshot_line.snapshot_hash,
      snapshot_line.snapshot_version,
      snapshot_line.organization_payroll_id,
      snapshot_line.employee_payroll_id,
      snapshot_line.pay_group_id_text,
      snapshot_line.period_start,
      snapshot_line.period_end,
      ((snapshot_line.line_payload ->> 'deadlineAt')::timestamptz at time zone v_payroll_timezone)::date as work_date,
      'MEAL_PREMIUM'::text as earning_code,
      round(((snapshot_line.line_payload ->> 'cents')::numeric * 3600::numeric) / rate_row.hourly_rate_cents::numeric)::integer as seconds,
      rate_row.hourly_rate_cents as base_rate_cents,
      1 as applied_rate_numerator,
      1 as applied_rate_denominator,
      (snapshot_line.line_payload ->> 'cents')::integer as gross_cents
    from snapshot_lines snapshot_line
    join public.employee_rate_versions rate_row
      on rate_row.organization_id = snapshot_line.organization_id
     and rate_row.employment_profile_id = snapshot_line.employment_profile_id
     and rate_row.id = (snapshot_line.line_payload ->> 'rateVersionId')::uuid
    where snapshot_line.line_type = 'premium'
      and snapshot_line.line_code = 'meal'
  )
  select *
  from segment_rows
  union all
  select *
  from premium_rows;

  if exists (
    select 1
    from temp_payroll_export_raw_rows raw_row
    where not app.is_safe_payroll_export_identifier(raw_row.organization_payroll_id)
       or not app.is_safe_payroll_export_identifier(raw_row.employee_payroll_id)
       or not app.is_safe_payroll_export_identifier(raw_row.pay_group_id_text)
       or raw_row.earning_code is null
       or raw_row.base_rate_cents is null
  ) then
    raise exception using errcode = '22023', message = 'formula identifier rejection or missing compensation blocks export';
  end if;

  create temporary table temp_payroll_export_full_rows on commit drop as
  with aggregated as (
    select
      organization_id,
      pay_period_id,
      pay_group_id,
      employment_profile_id,
      snapshot_id,
      snapshot_hash,
      snapshot_version,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id_text,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator,
      sum(seconds)::integer as seconds,
      sum(gross_cents)::integer as gross_cents,
      min(
        case earning_code
          when 'REG' then 1
          when 'OT' then 2
          when 'DT' then 3
          else 4
        end
      ) as earning_sort
    from temp_payroll_export_raw_rows
    group by
      organization_id,
      pay_period_id,
      pay_group_id,
      employment_profile_id,
      snapshot_id,
      snapshot_hash,
      snapshot_version,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id_text,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator
  )
  select
    row_number() over (
      order by
        aggregated.employee_payroll_id,
        aggregated.work_date,
        aggregated.earning_sort,
        aggregated.base_rate_cents,
        aggregated.snapshot_version,
        aggregated.snapshot_hash
    ) as export_position,
    aggregated.organization_id,
    aggregated.pay_period_id,
    aggregated.pay_group_id,
    aggregated.employment_profile_id,
    aggregated.snapshot_id,
    aggregated.snapshot_hash,
    aggregated.snapshot_version,
    aggregated.organization_payroll_id,
    aggregated.employee_payroll_id,
    aggregated.pay_group_id_text,
    aggregated.period_start,
    aggregated.period_end,
    aggregated.work_date,
    aggregated.earning_code,
    aggregated.seconds,
    aggregated.base_rate_cents,
    aggregated.applied_rate_numerator,
    aggregated.applied_rate_denominator,
    aggregated.gross_cents,
    'N'::text as correction_indicator
  from aggregated;

  select
    count(*)::integer,
    coalesce(sum(case when earning_code = 'REG' then seconds else 0 end), 0)::integer,
    coalesce(sum(case when earning_code = 'OT' then seconds else 0 end), 0)::integer,
    coalesce(sum(case when earning_code = 'DT' then seconds else 0 end), 0)::integer,
    coalesce(sum(case when earning_code = 'MEAL_PREMIUM' then gross_cents else 0 end), 0)::integer,
    coalesce(sum(gross_cents), 0)::integer
  into
    v_source_row_count,
    v_total_regular_seconds,
    v_total_overtime_seconds,
    v_total_double_time_seconds,
    v_total_meal_premium_cents,
    v_total_gross_cents
  from temp_payroll_export_full_rows;

  if (select coalesce(sum(regular_seconds), 0)::integer from temp_payroll_export_locked_snapshots) <> v_total_regular_seconds
    or (select coalesce(sum(overtime_seconds), 0)::integer from temp_payroll_export_locked_snapshots) <> v_total_overtime_seconds
    or (select coalesce(sum(double_time_seconds), 0)::integer from temp_payroll_export_locked_snapshots) <> v_total_double_time_seconds
    or (select coalesce(sum(meal_premium_cents), 0)::integer from temp_payroll_export_locked_snapshots) <> v_total_meal_premium_cents
    or (select coalesce(sum(gross_earnings_cents), 0)::integer from temp_payroll_export_locked_snapshots) <> v_total_gross_cents
  then
    raise exception using errcode = '23514', message = 'export reconciliation failed';
  end if;

  select app.payroll_hash_payload(
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'schemaVersion', v_adapter_version,
          'organizationPayrollId', row_row.organization_payroll_id,
          'employeePayrollId', row_row.employee_payroll_id,
          'payGroupId', row_row.pay_group_id_text,
          'periodStart', row_row.period_start,
          'periodEnd', row_row.period_end,
          'workDate', row_row.work_date,
          'earningCode', row_row.earning_code,
          'seconds', row_row.seconds,
          'baseRateCents', row_row.base_rate_cents,
          'appliedRateNumerator', row_row.applied_rate_numerator,
          'appliedRateDenominator', row_row.applied_rate_denominator,
          'grossCents', row_row.gross_cents,
          'snapshotVersion', row_row.snapshot_version,
          'snapshotHash', row_row.snapshot_hash
        )
        order by row_row.export_position
      ),
      '[]'::jsonb
    )
  )
  into v_canonical_hash
  from temp_payroll_export_full_rows row_row;

  select run_row.*
  into v_existing_run
  from public.payroll_export_runs run_row
  where run_row.organization_id = v_actor_org
    and run_row.pay_period_id = v_pay_period_id
    and run_row.canonical_hash = v_canonical_hash
  order by run_row.exported_at desc, run_row.id desc
  limit 1;

  if found then
    v_result := jsonb_build_object(
      'runId', v_existing_run.id,
      'payPeriodId', v_existing_run.pay_period_id,
      'adapterVersion', v_existing_run.adapter_version,
      'replayed', true,
      'createdAt', v_existing_run.exported_at,
      'exportedAt', v_existing_run.exported_at,
      'reconciliationStatus', 'reconciled',
      'checksumSha256', v_existing_run.csv_sha256,
      'rowCount', v_existing_run.row_count,
      'totalRegularSeconds', v_existing_run.total_regular_seconds,
      'totalOvertimeSeconds', v_existing_run.total_overtime_seconds,
      'totalDoubleTimeSeconds', v_existing_run.total_double_time_seconds,
      'totalMealPremiumCents', v_existing_run.total_meal_premium_cents,
      'totalGrossEarningsCents', v_existing_run.total_gross_cents,
      'sourceSnapshotCount', v_existing_run.source_snapshot_count,
      'adjustsRunId', v_existing_run.adjusts_export_run_id
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
      'create_payroll_export',
      btrim(idempotency_key),
      v_payload_hash,
      v_result
    );

    return v_result;
  end if;

  select run_row.*
  into v_previous_run
  from public.payroll_export_runs run_row
  where run_row.organization_id = v_actor_org
    and run_row.pay_period_id = v_pay_period_id
  order by run_row.exported_at desc, run_row.id desc
  limit 1;

  create temporary table temp_payroll_export_prior_cumulative_rows on commit drop as
  with prior_rows as (
    select
      row_row.*,
      run_row.exported_at
    from public.payroll_export_rows row_row
    join public.payroll_export_runs run_row
      on run_row.organization_id = row_row.organization_id
     and run_row.id = row_row.export_run_id
    where row_row.organization_id = v_actor_org
      and row_row.pay_period_id = v_pay_period_id
  ),
  summed as (
    select
      organization_id,
      pay_period_id,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator,
      sum(seconds)::integer as seconds,
      sum(gross_cents)::integer as gross_cents
    from prior_rows
    group by
      organization_id,
      pay_period_id,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator
  ),
  latest as (
    select distinct on (
      organization_id,
      pay_period_id,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator
    )
      organization_id,
      pay_period_id,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator,
      employment_profile_id,
      snapshot_id,
      snapshot_version,
      snapshot_hash
    from prior_rows
    order by
      organization_id,
      pay_period_id,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator,
      exported_at desc,
      export_run_id desc,
      export_position desc
  )
  select
    summed.organization_id,
    summed.pay_period_id,
    latest.employment_profile_id,
    latest.snapshot_id,
    latest.snapshot_version,
    latest.snapshot_hash,
    summed.organization_payroll_id,
    summed.employee_payroll_id,
    summed.pay_group_id,
    summed.period_start,
    summed.period_end,
    summed.work_date,
    summed.earning_code,
    summed.base_rate_cents,
    summed.applied_rate_numerator,
    summed.applied_rate_denominator,
    summed.seconds,
    summed.gross_cents
  from summed
  join latest
    on latest.organization_id = summed.organization_id
   and latest.pay_period_id = summed.pay_period_id
   and latest.organization_payroll_id = summed.organization_payroll_id
   and latest.employee_payroll_id = summed.employee_payroll_id
   and latest.pay_group_id = summed.pay_group_id
   and latest.period_start = summed.period_start
   and latest.period_end = summed.period_end
   and latest.work_date = summed.work_date
   and latest.earning_code = summed.earning_code
   and latest.base_rate_cents = summed.base_rate_cents
   and latest.applied_rate_numerator = summed.applied_rate_numerator
   and latest.applied_rate_denominator = summed.applied_rate_denominator;

  create temporary table temp_payroll_export_render_rows on commit drop as
  with delta_rows as (
    select
      coalesce(cur.organization_id, prev.organization_id, v_actor_org) as organization_id,
      coalesce(cur.pay_period_id, prev.pay_period_id, v_pay_period_id) as pay_period_id,
      coalesce(cur.pay_group_id, prev.pay_group_id, v_pay_group_id) as pay_group_id,
      coalesce(cur.employment_profile_id, prev.employment_profile_id) as employment_profile_id,
      coalesce(cur.snapshot_id, prev.snapshot_id) as snapshot_id,
      coalesce(cur.snapshot_version, prev.snapshot_version) as snapshot_version,
      coalesce(cur.snapshot_hash, prev.snapshot_hash) as snapshot_hash,
      coalesce(cur.organization_payroll_id, prev.organization_payroll_id) as organization_payroll_id,
      coalesce(cur.employee_payroll_id, prev.employee_payroll_id) as employee_payroll_id,
      coalesce(cur.pay_group_id_text, prev.pay_group_id::text, v_pay_group_id_text) as pay_group_id_text,
      coalesce(cur.period_start, prev.period_start, v_period_start) as period_start,
      coalesce(cur.period_end, prev.period_end, v_period_end) as period_end,
      coalesce(cur.work_date, prev.work_date) as work_date,
      coalesce(cur.earning_code, prev.earning_code) as earning_code,
      coalesce(cur.base_rate_cents, prev.base_rate_cents) as base_rate_cents,
      coalesce(cur.applied_rate_numerator, prev.applied_rate_numerator) as applied_rate_numerator,
      coalesce(cur.applied_rate_denominator, prev.applied_rate_denominator) as applied_rate_denominator,
      coalesce(cur.seconds, 0) - coalesce(prev.seconds, 0) as seconds,
      coalesce(cur.gross_cents, 0) - coalesce(prev.gross_cents, 0) as gross_cents
    from temp_payroll_export_full_rows cur
    full outer join temp_payroll_export_prior_cumulative_rows prev
      on prev.organization_payroll_id = cur.organization_payroll_id
     and prev.employee_payroll_id = cur.employee_payroll_id
     and prev.pay_group_id::text = cur.pay_group_id_text
     and prev.period_start = cur.period_start
     and prev.period_end = cur.period_end
     and prev.work_date = cur.work_date
     and prev.earning_code = cur.earning_code
     and prev.base_rate_cents = cur.base_rate_cents
     and prev.applied_rate_numerator = cur.applied_rate_numerator
     and prev.applied_rate_denominator = cur.applied_rate_denominator
  ),
  filtered_delta as (
    select
      *
    from delta_rows
    where v_previous_run.id is not null
      and (seconds <> 0 or gross_cents <> 0)
  ),
  base_rows as (
    select
      organization_id,
      pay_period_id,
      pay_group_id,
      employment_profile_id,
      snapshot_id,
      snapshot_version,
      snapshot_hash,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id_text,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator,
      seconds,
      gross_cents,
      'N'::text as correction_indicator,
      case earning_code when 'REG' then 1 when 'OT' then 2 when 'DT' then 3 else 4 end as earning_sort
    from temp_payroll_export_full_rows
    where v_previous_run.id is null
  ),
  adjustment_rows as (
    select
      organization_id,
      pay_period_id,
      pay_group_id,
      employment_profile_id,
      snapshot_id,
      snapshot_version,
      snapshot_hash,
      organization_payroll_id,
      employee_payroll_id,
      pay_group_id_text,
      period_start,
      period_end,
      work_date,
      earning_code,
      base_rate_cents,
      applied_rate_numerator,
      applied_rate_denominator,
      seconds,
      gross_cents,
      'Y'::text as correction_indicator,
      case earning_code when 'REG' then 1 when 'OT' then 2 when 'DT' then 3 else 4 end as earning_sort
    from filtered_delta
  )
  select
    row_number() over (
      order by
        source_rows.employee_payroll_id,
        source_rows.work_date,
        source_rows.earning_sort,
        source_rows.base_rate_cents,
        source_rows.snapshot_version,
        source_rows.snapshot_hash
    ) as export_position,
    source_rows.organization_id,
    source_rows.pay_period_id,
    source_rows.pay_group_id,
    source_rows.employment_profile_id,
    source_rows.snapshot_id,
    source_rows.snapshot_version,
    source_rows.snapshot_hash,
    source_rows.organization_payroll_id,
    source_rows.employee_payroll_id,
    source_rows.pay_group_id_text,
    source_rows.period_start,
    source_rows.period_end,
    source_rows.work_date,
    source_rows.earning_code,
    source_rows.seconds,
    source_rows.base_rate_cents,
    source_rows.applied_rate_numerator,
    source_rows.applied_rate_denominator,
    source_rows.gross_cents,
    source_rows.correction_indicator
  from (
    select * from base_rows
    union all
    select * from adjustment_rows
  ) as source_rows;

  select count(*)::integer
  into v_export_row_count
  from temp_payroll_export_render_rows;

  if v_previous_run.id is not null and v_export_row_count = 0 then
    raise exception using errcode = '23514', message = 'delta adjustment export must contain changed rows';
  end if;

  select coalesce(
    string_agg(
      app.payroll_csv_escape(v_adapter_version)
      || ',' || app.payroll_csv_escape(v_new_run_id::text)
      || ',' || app.payroll_csv_escape(coalesce(v_previous_run.id::text, ''))
      || ',' || app.payroll_csv_escape(render_row.organization_payroll_id)
      || ',' || app.payroll_csv_escape(render_row.employee_payroll_id)
      || ',' || app.payroll_csv_escape(render_row.pay_group_id_text)
      || ',' || app.payroll_csv_escape(render_row.period_start::text)
      || ',' || app.payroll_csv_escape(render_row.period_end::text)
      || ',' || app.payroll_csv_escape(render_row.work_date::text)
      || ',' || app.payroll_csv_escape(render_row.earning_code)
      || ',' || app.payroll_csv_escape(app.payroll_export_hours_text(render_row.seconds))
      || ',' || app.payroll_csv_escape(app.payroll_export_money_text(render_row.base_rate_cents))
      || ',' || app.payroll_csv_escape(app.payroll_export_applied_rate_text(render_row.base_rate_cents, render_row.applied_rate_numerator, render_row.applied_rate_denominator))
      || ',' || app.payroll_csv_escape(app.payroll_export_money_text(render_row.gross_cents))
      || ',' || app.payroll_csv_escape(render_row.correction_indicator)
      || ',' || app.payroll_csv_escape(render_row.snapshot_version::text)
      || ',' || app.payroll_csv_escape(render_row.snapshot_hash),
      E'\r\n'
      order by render_row.export_position
    ),
    ''
  )
  into v_csv_body
  from temp_payroll_export_render_rows render_row;

  v_csv_text := v_csv_header || E'\r\n' || v_csv_body || E'\r\n';
  v_csv_bytes := convert_to(v_csv_text, 'UTF8');
  v_csv_sha256 := encode(extensions.digest(v_csv_bytes, 'sha256'), 'hex');

  insert into public.payroll_export_runs (
    id,
    organization_id,
    pay_period_id,
    pay_group_id,
    adjusts_export_run_id,
    actor_user_id,
    adapter_version,
    canonical_hash,
    csv_sha256,
    csv_bytes,
    source_snapshot_count,
    source_row_count,
    row_count,
    total_regular_seconds,
    total_overtime_seconds,
    total_double_time_seconds,
    total_meal_premium_cents,
    total_gross_cents,
    exported_at
  ) values (
    v_new_run_id,
    v_actor_org,
    v_pay_period_id,
    v_pay_group_id,
    v_previous_run.id,
    v_actor,
    v_adapter_version,
    v_canonical_hash,
    v_csv_sha256,
    v_csv_bytes,
    v_source_snapshot_count,
    v_source_row_count,
    v_export_row_count,
    v_total_regular_seconds,
    v_total_overtime_seconds,
    v_total_double_time_seconds,
    v_total_meal_premium_cents,
    v_total_gross_cents,
    v_exported_at
  );

  insert into public.payroll_export_rows (
    organization_id,
    export_run_id,
    adjusts_export_run_id,
    pay_period_id,
    pay_group_id,
    employment_profile_id,
    snapshot_id,
    export_position,
    schema_version,
    organization_payroll_id,
    employee_payroll_id,
    period_start,
    period_end,
    work_date,
    earning_code,
    seconds,
    base_rate_cents,
    applied_rate_numerator,
    applied_rate_denominator,
    gross_cents,
    correction_indicator,
    snapshot_version,
    snapshot_hash
  )
  select
    render_row.organization_id,
    v_new_run_id,
    v_previous_run.id,
    render_row.pay_period_id,
    render_row.pay_group_id,
    render_row.employment_profile_id,
    render_row.snapshot_id,
    render_row.export_position,
    v_adapter_version,
    render_row.organization_payroll_id,
    render_row.employee_payroll_id,
    render_row.period_start,
    render_row.period_end,
    render_row.work_date,
    render_row.earning_code,
    render_row.seconds,
    render_row.base_rate_cents,
    render_row.applied_rate_numerator,
    render_row.applied_rate_denominator,
    render_row.gross_cents,
    render_row.correction_indicator,
    render_row.snapshot_version,
    render_row.snapshot_hash
  from temp_payroll_export_render_rows render_row
  order by render_row.export_position;

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
    'create_payroll_export',
    'payroll_export_runs',
    v_new_run_id,
    jsonb_build_object(
      'payPeriodId', v_pay_period_id,
      'runId', v_new_run_id,
      'checksumSha256', v_csv_sha256,
      'rowCount', v_export_row_count,
      'adjustsRunId', v_previous_run.id
    )
  );

  update public.pay_periods
  set exported_at = v_exported_at
  where organization_id = v_actor_org
    and id = v_pay_period_id
    and exported_at is null;

  v_result := jsonb_build_object(
    'runId', v_new_run_id,
    'payPeriodId', v_pay_period_id,
    'adapterVersion', v_adapter_version,
    'replayed', false,
    'createdAt', v_exported_at,
    'exportedAt', v_exported_at,
    'reconciliationStatus', 'reconciled',
    'checksumSha256', v_csv_sha256,
    'rowCount', v_export_row_count,
    'totalRegularSeconds', v_total_regular_seconds,
    'totalOvertimeSeconds', v_total_overtime_seconds,
    'totalDoubleTimeSeconds', v_total_double_time_seconds,
    'totalMealPremiumCents', v_total_meal_premium_cents,
    'totalGrossEarningsCents', v_total_gross_cents,
    'sourceSnapshotCount', v_source_snapshot_count,
    'adjustsRunId', v_previous_run.id
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
    'create_payroll_export',
    btrim(idempotency_key),
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.get_payroll_export(
  run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_run public.payroll_export_runs%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authenticated payroll export access is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.current_user_is_payroll_admin(v_actor_org) then
    raise exception using errcode = '42501', message = 'payroll export administration access is required';
  end if;

  if app.payroll_actor_has_capability(v_actor_org, 'payroll.export_period') is not true then
    raise exception using errcode = '42501', message = 'payroll.export_period capability is required';
  end if;

  select run_row.*
  into v_run
  from public.payroll_export_runs run_row
  where run_row.organization_id = v_actor_org
    and run_row.id = run_id;

  if not found then
    raise exception using errcode = '42501', message = 'payroll export is out of scope';
  end if;

  return jsonb_build_object(
    'runId', v_run.id,
    'payPeriodId', v_run.pay_period_id,
    'adapterVersion', v_run.adapter_version,
    'periodStart', (
      select row_row.period_start
      from public.payroll_export_rows row_row
      where row_row.organization_id = v_actor_org
        and row_row.export_run_id = v_run.id
      order by row_row.export_position
      limit 1
    ),
    'periodEnd', (
      select row_row.period_end
      from public.payroll_export_rows row_row
      where row_row.organization_id = v_actor_org
        and row_row.export_run_id = v_run.id
      order by row_row.export_position
      limit 1
    ),
    'csv', convert_from(v_run.csv_bytes, 'UTF8')
  );
end;
$$;

alter function public.get_payroll_administration(date)
  rename to get_payroll_administration_without_export_capability;

revoke all on function public.get_payroll_administration_without_export_capability(date)
  from public, anon, authenticated, service_role;

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
  v_result jsonb;
  v_pay_periods jsonb := '[]'::jsonb;
  v_can_export_period boolean := false;
begin
  -- The reviewed administration RPC remains the authority gate and payload source.
  v_result := public.get_payroll_administration_without_export_capability(selected_local_date);
  v_actor_org := app.resolve_user_organization_id(v_actor);

  if v_result ->> 'state' = 'ok' and not (
    coalesce((v_result #>> '{capabilities,canConfigureEmployment}')::boolean, false)
    or coalesce((v_result #>> '{capabilities,canResolveExceptions}')::boolean, false)
    or coalesce((v_result #>> '{capabilities,canLockPeriod}')::boolean, false)
    or coalesce((v_result #>> '{capabilities,canReopenPeriod}')::boolean, false)
    or coalesce((v_result #>> '{capabilities,canViewCompensation}')::boolean, false)
  ) then
    raise exception using errcode = '42501', message = 'payroll administration capability is required';
  end if;

  if v_actor_org is not null then
    v_can_export_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.export_period');
  end if;

  if v_result ->> 'state' = 'ok' then
    v_result := jsonb_set(
      v_result,
      '{capabilities,canExportPeriod}',
      to_jsonb(v_can_export_period),
      true
    );

    select coalesce(jsonb_agg(
      period_entry.period_payload
      || jsonb_build_object(
        'exportedAt', latest_run.exported_at,
        'latestExport', case
          when latest_run.id is null then 'null'::jsonb
          else jsonb_build_object(
            'runId', latest_run.id,
            'adapterVersion', latest_run.adapter_version,
            'exportedAt', latest_run.exported_at,
            'reconciliationStatus', 'reconciled',
            'checksumSha256', latest_run.csv_sha256,
            'rowCount', latest_run.row_count,
            'totalRegularSeconds', latest_run.total_regular_seconds,
            'totalOvertimeSeconds', latest_run.total_overtime_seconds,
            'totalDoubleTimeSeconds', latest_run.total_double_time_seconds,
            'totalMealPremiumCents', latest_run.total_meal_premium_cents,
            'totalGrossEarningsCents', latest_run.total_gross_cents,
            'sourceSnapshotCount', latest_run.source_snapshot_count,
            'adjustsRunId', latest_run.adjusts_export_run_id
          )
        end
      )
      order by period_entry.ordinality
    ), '[]'::jsonb)
    into v_pay_periods
    from jsonb_array_elements(coalesce(v_result -> 'payPeriods', '[]'::jsonb))
      with ordinality as period_entry(period_payload, ordinality)
    left join lateral (
      select run_row.*
      from public.payroll_export_runs run_row
      where run_row.organization_id = v_actor_org
        and run_row.pay_period_id = nullif(period_entry.period_payload ->> 'id', '')::uuid
      order by run_row.exported_at desc, run_row.id desc
      limit 1
    ) latest_run on true;

    v_result := jsonb_set(v_result, '{payPeriods}', v_pay_periods, true);
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_payroll_administration(date) from public, anon, service_role;
revoke all on function public.get_payroll_administration(date) from authenticated;
grant execute on function public.get_payroll_administration(date) to authenticated;

alter function public.get_payroll_timesheet_period(date)
  rename to get_payroll_timesheet_period_without_export_status;

revoke all on function public.get_payroll_timesheet_period_without_export_status(date)
  from public, anon, authenticated, service_role;

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
  v_exported_at timestamptz := null;
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
      'employmentTimezone', null,
      'exportedAt', null
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
      'employmentTimezone', v_employment.timezone,
      'exportedAt', null
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
      'employmentTimezone', v_employment.timezone,
      'exportedAt', null
    );
  end if;

  if v_employment.home_jurisdiction <> 'CA' then
    return jsonb_build_object(
      'state', 'unsupported_jurisdiction',
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone,
      'exportedAt', null
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
      'employmentTimezone', v_employment.timezone,
      'exportedAt', null
    );
  end if;

  select pay_group.*
  into v_pay_group
  from public.pay_groups pay_group
  where pay_group.organization_id = v_actor_org
    and pay_group.id = v_pay_group_assignment.pay_group_id
  order by pay_group.created_at desc, pay_group.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'selectedLocalDate', v_selected_local_date,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone,
      'exportedAt', null
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
      'employmentTimezone', v_employment.timezone,
      'exportedAt', null
    );
  end if;

  select run_row.exported_at
  into v_exported_at
  from public.payroll_export_runs run_row
  where run_row.organization_id = v_actor_org
    and run_row.pay_period_id = v_pay_period.id
  order by run_row.exported_at desc, run_row.id desc
  limit 1;

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
      'employmentTimezone', v_employment.timezone,
      'exportedAt', v_exported_at
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
    'snapshot', v_snapshot,
    'exportedAt', v_exported_at
  );
end;
$$;

-- Preserve the reviewed period contract above and decorate it with export status only.
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
  v_result jsonb;
  v_pay_period_id uuid;
  v_exported_at timestamptz;
  v_adjusts_export_run_id uuid;
begin
  v_result := public.get_payroll_timesheet_period_without_export_status(selected_local_date);
  v_actor_org := app.resolve_user_organization_id(v_actor);
  v_pay_period_id := nullif(v_result #>> '{period,payPeriodId}', '')::uuid;

  if v_actor_org is not null and v_pay_period_id is not null then
    select run_row.exported_at, run_row.adjusts_export_run_id
    into v_exported_at, v_adjusts_export_run_id
    from public.payroll_export_runs run_row
    where run_row.organization_id = v_actor_org
      and run_row.pay_period_id = v_pay_period_id
    order by run_row.exported_at desc, run_row.id desc
    limit 1;
  end if;

  return v_result || jsonb_build_object(
    'exportedAt', v_exported_at,
    'exportKind', case
      when v_exported_at is null then null
      when v_adjusts_export_run_id is null then 'initial'
      else 'adjustment'
    end
  );
end;
$$;

revoke all on function public.get_payroll_timesheet_period(date) from public, anon, service_role;
revoke all on function public.get_payroll_timesheet_period(date) from authenticated;
grant execute on function public.get_payroll_timesheet_period(date) to authenticated;

drop trigger if exists payroll_export_runs_append_only on public.payroll_export_runs;
create trigger payroll_export_runs_append_only
  before update or delete on public.payroll_export_runs
  for each row
  execute function app.reject_payroll_export_ledger_mutation();

drop trigger if exists payroll_export_rows_append_only on public.payroll_export_rows;
create trigger payroll_export_rows_append_only
  before update or delete on public.payroll_export_rows
  for each row
  execute function app.reject_payroll_export_ledger_mutation();

alter table public.payroll_export_runs enable row level security;
alter table public.payroll_export_runs force row level security;
alter table public.payroll_export_rows enable row level security;
alter table public.payroll_export_rows force row level security;

create policy payroll_export_runs_authenticated_select
  on public.payroll_export_runs
  for select
  to authenticated
  using (
    app.current_user_is_payroll_admin(organization_id)
    and app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
  );

create policy payroll_export_rows_authenticated_select
  on public.payroll_export_rows
  for select
  to authenticated
  using (
    app.current_user_is_payroll_admin(organization_id)
    and app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
  );

revoke all on public.payroll_export_runs from public, anon, authenticated;
revoke all on public.payroll_export_rows from public, anon, authenticated;
revoke all on public.payroll_export_runs from service_role;
revoke all on public.payroll_export_rows from service_role;
grant select on public.payroll_export_runs to authenticated;
grant select on public.payroll_export_rows to authenticated;

revoke all on function app.reject_payroll_export_ledger_mutation() from public, anon, authenticated, service_role;
revoke all on function app.is_safe_payroll_export_identifier(text) from public, anon, authenticated, service_role;
revoke all on function app.payroll_export_hours_text(integer) from public, anon, authenticated, service_role;
revoke all on function app.payroll_export_money_text(integer) from public, anon, authenticated, service_role;
revoke all on function app.payroll_export_applied_rate_text(integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function app.payroll_csv_escape(text) from public, anon, authenticated, service_role;

revoke all on function public.create_payroll_export(jsonb, text) from public, anon, service_role;
revoke all on function public.create_payroll_export(jsonb, text) from authenticated;
grant execute on function public.create_payroll_export(jsonb, text) to authenticated;

revoke all on function public.get_payroll_export(uuid) from public, anon, service_role;
revoke all on function public.get_payroll_export(uuid) from authenticated;
grant execute on function public.get_payroll_export(uuid) to authenticated;

commit;
