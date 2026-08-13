import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationName = "20260812212854_payroll_timesheet_period_contract_repair.sql";
const migrationPath = path.join(process.cwd(), "supabase", "migrations", migrationName);
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

describe("payroll timesheet period contract repair migration", () => {
  it("creates the generated additive repair migration with the administration dependency", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_timesheet_period_contract_repair/i);
    expect(sql).toMatch(/@migration-dependencies:\s*20260812153628_payroll_administration\.sql/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("restores the nested public.get_payroll_timesheet_period transport contract while keeping the snapshot envelope", () => {
    expect(sql).toMatch(/create or replace function public\.get_payroll_timesheet_period\(\s*selected_local_date date\s*\)/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/'state',\s*'ok'/i);
    expect(sql).toMatch(/'snapshot',\s*v_snapshot/i);
    expect(sql).toMatch(/'period',\s*jsonb_build_object\(/i);
    expect(sql).toMatch(/'selectedLocalDate',\s*v_selected_local_date/i);
    expect(sql).toMatch(/'periodStart',\s*v_period_start/i);
    expect(sql).toMatch(/'periodEnd',\s*v_period_end/i);
    expect(sql).toMatch(/'employmentProfileId',\s*v_employment\.id/i);
    expect(sql).toMatch(/'timezone',\s*v_employment\.timezone/i);
    expect(sql).toMatch(/'workdayStartsAt',\s*coalesce\(v_settings\.workday_starts_at,\s*time '00:00'\)/i);
    expect(sql).toMatch(/'workweekStartsOn',\s*coalesce\(v_settings\.workweek_starts_on,\s*0\)/i);
    expect(sql).toMatch(/'policyVersionId',\s*v_policy\.id/i);
    expect(sql).toMatch(/'payPeriodId',\s*v_pay_period\.id/i);
    expect(sql).toMatch(/'events',\s*v_events/i);
    expect(sql).toMatch(/'mealResolutions',\s*v_meal_resolutions/i);
    expect(sql).toMatch(/'rateVersions',\s*v_rate_versions/i);
    expect(sql).toMatch(/'timeCorrectionRequests',\s*v_corrections/i);
    expect(sql).toMatch(/'sessionAttendanceCorrectionRequests',\s*v_attendance_corrections/i);
    expect(sql).toMatch(/'exceptions',\s*v_exceptions/i);
  });

  it("preserves administration-era effective-dated settings and pay-group selection plus monthly fail-closed behavior", () => {
    expect(sql).toMatch(/from public\.payroll_organization_settings settings/i);
    expect(sql).toMatch(/settings\.effective_from <= v_selected_local_date/i);
    expect(sql).toMatch(/settings\.effective_through is null or settings\.effective_through >= v_selected_local_date/i);
    expect(sql).toMatch(/order by settings\.effective_from desc,\s*settings\.created_at desc,\s*settings\.id desc/i);
    expect(sql).toMatch(
      /from public\.payroll_organization_settings settings[\s\S]*?if not found then[\s\S]*?'state',\s*'missing_prerequisite'/i,
    );
    expect(sql).toMatch(/from public\.pay_groups pay_group/i);
    expect(sql).toMatch(/pay_group\.effective_from <= v_selected_local_date/i);
    expect(sql).toMatch(/pay_group\.effective_through is null or pay_group\.effective_through >= v_selected_local_date/i);
    expect(sql).toMatch(/order by pay_group\.effective_from desc,\s*pay_group\.created_at desc,\s*pay_group\.id desc/i);
    expect(sql).toMatch(/policy\.effective_from <= v_selected_local_date/i);
    expect(sql).toMatch(/policy\.effective_through is null or policy\.effective_through >= v_selected_local_date/i);
    expect(sql).toMatch(
      /order by \(policy\.organization_id is not null\) desc,\s*policy\.effective_from desc,\s*policy\.created_at desc,\s*policy\.id desc/i,
    );
    expect(sql).not.toMatch(/policy\.effective_from <= v_period_end/i);
    expect(sql).toMatch(/if v_pay_group\.cadence = 'monthly' then/i);
    expect(sql).toMatch(/'state',\s*'unsupported_policy'/i);
    expect(sql).toMatch(
      /from public\.payroll_policy_versions policy[\s\S]*?if not found then[\s\S]*?'state',\s*'unsupported_policy'/i,
    );
    expect(sql).not.toMatch(/supports_monthly_nonexempt/i);
  });
});
