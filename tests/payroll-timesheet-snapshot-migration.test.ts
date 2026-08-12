import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationName = "20260812060529_payroll_timesheet_snapshots.sql";
const migrationPath = path.join(process.cwd(), "supabase", "migrations", migrationName);
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

describe("payroll timesheet snapshot migration contract", () => {
  it("creates the generated migration file with the preserved governance header", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_timesheet_snapshots/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("creates immutable snapshot headers, lines, and current heads with forced RLS", () => {
    expect(sql).toMatch(/create table(?: if not exists)? public\.timesheet_snapshots/i);
    expect(sql).toMatch(/create table(?: if not exists)? public\.timesheet_snapshot_lines/i);
    expect(sql).toMatch(/create table(?: if not exists)? public\.timesheet_snapshot_current_heads/i);
    expect(sql).toMatch(/create table(?: if not exists)? public\.timesheet_meal_resolutions/i);

    for (const tableName of [
      "timesheet_snapshots",
      "timesheet_snapshot_lines",
      "timesheet_snapshot_current_heads",
      "timesheet_meal_resolutions",
    ]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${tableName} enable row level security`, "i"));
      expect(sql).toMatch(new RegExp(`alter table public\\.${tableName} force row level security`, "i"));
    }

    expect(sql).toMatch(/source_hash text not null/i);
    expect(sql).toMatch(/canonical_payload jsonb not null/i);
    expect(sql).toMatch(/source_high_water jsonb not null/i);
    expect(sql).toMatch(/gross_earnings_cents integer not null/i);
    expect(sql).toMatch(/meal_premium_cents integer not null/i);
    expect(sql).toMatch(/regular_seconds integer not null/i);
    expect(sql).toMatch(/overtime_seconds integer not null/i);
    expect(sql).toMatch(/double_time_seconds integer not null/i);
    expect(sql).toMatch(/shift_start_event_id uuid not null/i);
    expect(sql).toMatch(/deadline_at timestamptz not null/i);
    expect(sql).toMatch(/prior_snapshot_id uuid/i);
    expect(sql).not.toMatch(/invalidated_by_snapshot_id uuid/i);
    expect(sql).not.toMatch(/is_current boolean/i);
  });

  it("adds the required composite indexes, replay lookup, and protected derivation RPC", () => {
    expect(sql).toMatch(/create index if not exists employee_time_events_org_employment_event_at_idx/i);
    expect(sql).toMatch(/create index if not exists session_attendance_events_org_employment_event_at_idx/i);
    expect(sql).toMatch(/create index if not exists time_correction_requests_org_employment_created_at_idx/i);
    expect(sql).toMatch(/create index if not exists session_attendance_correction_requests_org_employment_created_at_idx/i);
    expect(sql).toMatch(/create index if not exists timekeeping_exceptions_org_employment_created_at_idx/i);
    expect(sql).toMatch(/create index if not exists pay_group_assignments_org_employment_effective_idx/i);
    expect(sql).toMatch(/create unique index if not exists timesheet_snapshots_org_employment_period_hash_uidx/i);
    expect(sql).toMatch(/create unique index if not exists timesheet_snapshot_current_heads_org_employment_period_uidx/i);
    expect(sql).toMatch(/create index if not exists timesheet_snapshots_org_employment_period_hash_idx/i);
    expect(sql).toMatch(/create or replace function public\.get_payroll_timesheet_period\(\s*selected_local_date date\s*\)/i);
    expect(sql).toMatch(/create or replace function public\.derive_timesheet_snapshot\(\s*selected_local_date date,\s*p_idempotency_key text\s*\)/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/v_selected_local_date/i);
    expect(sql).toMatch(/v_period_start_utc/i);
    expect(sql).toMatch(/v_period_end_utc/i);
    expect(sql).toMatch(/event_row\.event_at >= v_period_start_utc/i);
    expect(sql).toMatch(/event_row\.event_at < v_period_end_utc/i);
    expect(sql).toMatch(/grant execute on function public\.derive_timesheet_snapshot/i);
    expect(sql).toMatch(/revoke all on function public\.derive_timesheet_snapshot/i);
  });

  it("fails closed on feature/jurisdiction gates and documents the deliberate self-compensation projection", () => {
    expect(sql).toMatch(/flag\.flag_key = 'payroll_timekeeping_v1'/i);
    expect(sql).toMatch(/payroll timekeeping feature flag is not configured|feature_disabled/i);
    expect(sql).toMatch(/unsupported payroll jurisdiction/i);
    expect(sql).toMatch(/home_jurisdiction <> 'CA'/i);
    expect(sql).toMatch(/time\.view_self capability is required/i);
    expect(sql).toMatch(/self-pay projection|deliberate self-pay projection/i);
    expect(sql).toMatch(/effectiveFrom/i);
    expect(sql).toMatch(/effectiveThrough/i);
    expect(sql).not.toMatch(/grant select on public\.employee_rate_versions to authenticated/i);
  });

  it("serializes derivation with source and config mutations through a common advisory lock", () => {
    expect(sql).toMatch(/create or replace function app\.payroll_timesheet_global_config_lock/i);
    expect(sql).toMatch(/create or replace function app\.payroll_timesheet_org_lock/i);
    expect(sql).toMatch(/create or replace function app\.payroll_timesheet_derivation_lock/i);
    expect(sql).toMatch(/create or replace function app\.payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/create or replace function app\.payroll_timesheet_policy_mutation_guard/i);
    expect(sql).toMatch(/pg_advisory_xact_lock_shared/i);
    expect(sql).toMatch(/pg_advisory_xact_lock\(/i);
    expect(sql).toMatch(/perform app\.payroll_timesheet_global_config_lock\(false\)/i);
    expect(sql).toMatch(/perform app\.payroll_timesheet_global_config_lock\(true\)/i);
    expect(sql).toMatch(/perform app\.payroll_timesheet_org_lock\(/i);
    expect(sql).toMatch(/coalesce\(new\.organization_id,\s*old\.organization_id\)/i);
    expect(sql).toMatch(/create or replace function app\.payroll_timesheet_global_mutation_guard/i);
    expect(sql).not.toMatch(/app\.payroll_timesheet_derivation_test_pause/i);
    expect(sql).not.toMatch(/current_setting\('app\.payroll_timesheet_derivation_test_pause'/i);
    expect(sql).toMatch(/employee_time_events[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/session_attendance_events[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/time_correction_requests[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/session_attendance_correction_requests[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/timekeeping_exceptions[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/timesheet_meal_resolutions[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/employee_rate_versions[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/pay_group_assignments[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/pay_periods[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/payroll_policy_versions[\s\S]*payroll_timesheet_policy_mutation_guard/i);
    expect(sql).toMatch(/payroll_organization_settings[\s\S]*payroll_timesheet_derivation_mutation_guard/i);
    expect(sql).toMatch(/feature_flags[\s\S]*payroll_timesheet_global_mutation_guard/i);
    expect(sql).toMatch(
      /perform app\.payroll_timesheet_derivation_lock\(v_actor_org\)[\s\S]*from public\.employee_time_events/i,
    );
    expect(sql).toMatch(/revoke all on function app\.payroll_timesheet_global_config_lock\(boolean\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function app\.payroll_timesheet_org_lock\(uuid\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function app\.payroll_timesheet_derivation_lock\(uuid\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function app\.payroll_timesheet_derivation_mutation_guard\(\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function app\.payroll_timesheet_policy_mutation_guard\(\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function app\.payroll_timesheet_global_mutation_guard\(\) from public, anon, authenticated, service_role/i);
  });

  it("keeps snapshot payloads append-only and denies application-role updates or deletes", () => {
    expect(sql).toMatch(/create trigger timesheet_snapshots_append_only/i);
    expect(sql).toMatch(/create trigger timesheet_snapshot_lines_append_only/i);
    expect(sql).toMatch(/create trigger timesheet_snapshot_current_heads_append_only/i);
    expect(sql).toMatch(/revoke update, delete on public\.timesheet_snapshots from authenticated, service_role/i);
    expect(sql).toMatch(/revoke update, delete on public\.timesheet_snapshot_lines from authenticated, service_role/i);
    expect(sql).not.toMatch(/delete from public\.timesheet_snapshots/i);
    expect(sql).toMatch(/insert into public\.payroll_audit_events/i);
  });

  it("treats meal resolutions as canonical source input and persists premium detail lines", () => {
    expect(sql).toMatch(/'mealResolutions'/i);
    expect(sql).toMatch(/from public\.timesheet_meal_resolutions/i);
    expect(sql).toMatch(/v_combined_source_count[\s\S]*mealResolutions/i);
    expect(sql).toMatch(/jsonb_build_object\([\s\S]*'mealResolutions'/i);
    expect(sql).toMatch(/line_type text not null check \(line_type in \('segment', 'exception', 'summary', 'premium'\)\)/i);
    expect(sql).toMatch(/'premium'[\s\S]*'meal'/i);
    expect(sql).toMatch(/'cents'/i);
    expect(sql).toMatch(/rate_version_id/i);
  });

  it("binds every meal-resolution event link to the same organization and employment", () => {
    expect(sql).toMatch(/unique \(id, organization_id, employment_profile_id\)/i);
    expect(sql).toMatch(
      /foreign key \(shift_start_event_id, organization_id, employment_profile_id\)[\s\S]*references public\.employee_time_events\(id, organization_id, employment_profile_id\)/i,
    );
    expect(sql).toMatch(
      /foreign key \(meal_start_event_id, organization_id, employment_profile_id\)[\s\S]*references public\.employee_time_events\(id, organization_id, employment_profile_id\)/i,
    );
    expect(sql).toMatch(
      /foreign key \(meal_end_event_id, organization_id, employment_profile_id\)[\s\S]*references public\.employee_time_events\(id, organization_id, employment_profile_id\)/i,
    );
    expect(sql).toMatch(/shift_event\.employment_profile_id = resolution_row\.employment_profile_id/i);
  });
});
