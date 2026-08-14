begin;

-- @migration-intent: payroll_security_repair
-- @migration-dependencies: 20260812230837_payroll_export_ledger.sql
-- @migration-rollback: Remove the WIN-219 repair migration, restore the pre-repair payroll function definitions from a clean local reset, and confirm exports plus generate_periods return to the August 12, 2026 contract before any follow-up replay testing.

do $$
begin
  alter type public.payroll_capability add value if not exists 'payroll.configure_settings';
exception
  when duplicate_object then
    null;
end;
$$;

do $$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('app.payroll_actor_has_capability(uuid, text)'::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'payroll capability allowlist repair target was not found';
  end if;

  v_patched := replace(
    v_definition,
    '''payroll.configure_employment'', ''payroll.resolve_exceptions'',',
    '''payroll.configure_employment'', ''payroll.configure_settings'', ''payroll.resolve_exceptions'','
  );
  if v_patched = v_definition then
    raise exception 'payroll.configure_settings allowlist repair target was not found';
  end if;

  execute v_patched;
end;
$$;

do $$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('public.get_payroll_administration_without_export_capability(date)'::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'payroll administration read-model repair target was not found';
  end if;

  v_patched := replace(
    v_definition,
    '  v_can_configure_employment boolean := false;',
    E'  v_can_configure_employment boolean := false;\n  v_can_configure_settings boolean := false;'
  );
  if v_patched = v_definition then
    raise exception 'payroll administration declaration repair target was not found';
  end if;
  v_definition := v_patched;

  v_patched := replace(
    v_definition,
    '  v_can_configure_employment := app.payroll_actor_has_capability(v_actor_org, ''payroll.configure_employment'');',
    E'  v_can_configure_employment := app.payroll_actor_has_capability(v_actor_org, ''payroll.configure_employment'');\n  v_can_configure_settings := app.payroll_actor_has_capability(v_actor_org, ''payroll.configure_settings'');'
  );
  if v_patched = v_definition then
    raise exception 'payroll administration capability repair target was not found';
  end if;
  v_definition := v_patched;

  v_patched := replace(
    v_definition,
    '    or v_can_resolve_exceptions',
    E'    or v_can_configure_settings\n    or v_can_resolve_exceptions'
  );
  if v_patched = v_definition then
    raise exception 'payroll administration gate repair target was not found';
  end if;
  v_definition := v_patched;

  v_patched := replace(
    v_definition,
    '      ''canGeneratePeriods'', v_can_configure_employment,',
    '      ''canGeneratePeriods'', v_can_configure_settings,'
  );
  if v_patched = v_definition then
    raise exception 'payroll administration canGeneratePeriods repair target was not found';
  end if;

  execute v_patched;
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
  v_result jsonb;
  v_pay_periods jsonb := '[]'::jsonb;
  v_can_configure_settings boolean := false;
  v_can_export_period boolean := false;
begin
  v_result := public.get_payroll_administration_without_export_capability(selected_local_date);
  v_actor_org := app.resolve_user_organization_id(v_actor);

  if v_actor_org is not null then
    v_can_configure_settings := app.payroll_actor_has_capability(v_actor_org, 'payroll.configure_settings');
    v_can_export_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.export_period');
  end if;

  if v_result ->> 'state' = 'ok' and not (
    coalesce((v_result #>> '{capabilities,canConfigureEmployment}')::boolean, false)
    or v_can_configure_settings
    or coalesce((v_result #>> '{capabilities,canResolveExceptions}')::boolean, false)
    or coalesce((v_result #>> '{capabilities,canLockPeriod}')::boolean, false)
    or coalesce((v_result #>> '{capabilities,canReopenPeriod}')::boolean, false)
    or coalesce((v_result #>> '{capabilities,canViewCompensation}')::boolean, false)
  ) then
    raise exception using errcode = '42501', message = 'payroll administration capability is required';
  end if;

  if v_result ->> 'state' = 'ok' then
    v_result := jsonb_set(
      v_result,
      '{capabilities,canGeneratePeriods}',
      to_jsonb(v_can_configure_settings),
      true
    );
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
          when latest_run.id is null or not v_can_export_period then 'null'::jsonb
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

do $$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('public.execute_payroll_administration(jsonb, text)'::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'payroll administration execute repair target was not found';
  end if;

  v_patched := regexp_replace(
    v_definition,
    'when ''generate_periods'' then ''payroll\.(configure_employment|export_period)''',
    'when ''generate_periods'' then ''payroll.configure_settings'''
  );
  if v_patched = v_definition then
    raise exception 'generate periods capability repair target was not found';
  end if;

  execute v_patched;
end;
$$;

do $$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('public.create_payroll_export(jsonb, text)'::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'create_payroll_export repair target was not found';
  end if;

  v_patched := regexp_replace(
    v_definition,
    E'  select receipt\\.\\*\\r?\\n  into v_receipt',
    E'  perform pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(\n      v_actor_org::text || '':'' || v_actor::text || '':create_payroll_export:'' || btrim(idempotency_key),\n      0\n    )\n  );\n\n  select receipt.*\n  into v_receipt'
  );
  if v_patched = v_definition then
    raise exception 'create_payroll_export idempotency lock target was not found';
  end if;
  v_definition := v_patched;

  v_patched := regexp_replace(
    v_definition,
    E'join public\\.payroll_organization_settings settings\\s+on settings\\.organization_id = pay_period\\.organization_id',
    E'left join public.payroll_organization_settings settings\n    on settings.organization_id = pay_period.organization_id\n   and settings.effective_from <= pay_period.starts_on\n   and (settings.effective_through is null or settings.effective_through >= pay_period.ends_on)'
  );
  if v_patched = v_definition then
    raise exception 'create_payroll_export settings join repair target was not found';
  end if;
  v_definition := v_patched;

  v_patched := regexp_replace(
    v_definition,
    'order by settings\.created_at desc, settings\.id desc',
    'order by settings.effective_from desc, settings.created_at desc, settings.id desc'
  );
  if v_patched = v_definition then
    raise exception 'create_payroll_export settings ordering repair target was not found';
  end if;
  v_definition := v_patched;

  v_patched := regexp_replace(
    v_definition,
    E'if v_pay_group_id is null then\\s+raise exception using errcode = ''42501'', message = ''pay period is out of scope'';\\s+end if;',
    E'if v_pay_group_id is null then\n    raise exception using errcode = ''42501'', message = ''pay period is out of scope'';\n  end if;\n\n  if v_organization_payroll_id is null or v_payroll_timezone is null then\n    raise exception using errcode = ''23514'', message = ''payroll export settings effective for the pay period are required'';\n  end if;'
  );
  if v_patched = v_definition then
    raise exception 'create_payroll_export settings presence repair target was not found';
  end if;

  execute v_patched;
end;
$$;

commit;
