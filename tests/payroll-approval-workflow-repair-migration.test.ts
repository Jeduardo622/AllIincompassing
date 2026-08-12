import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationName =
  readdirSync(migrationsDir).find((name) => name.endsWith("payroll_approval_workflow_repair.sql")) ?? "";
const migrationPath = migrationName ? path.join(migrationsDir, migrationName) : "";
const migrationExists = migrationName !== "" && existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

describe("payroll approval workflow repair migration contract", () => {
  it("creates a governed repair migration for the bounded Task 4 payroll database contract fixes", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_approval_workflow_repair/i);
    expect(sql).toMatch(/@migration-dependencies:\s*20260812153628_payroll_administration\.sql/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("repairs generate_periods capability derivation without broadening payroll grants", () => {
    expect(sql).toMatch(/when 'generate_periods' then 'payroll\.configure_employment'/i);
    expect(sql).toMatch(/'canGeneratePeriods',\s*v_can_configure_employment/i);
    expect(sql).not.toMatch(/grant execute on function public\.execute_payroll_administration\(jsonb,\s*text\) to authenticated,\s*service_role/i);
  });

  it("returns selectedLocalDate in the ok self-approval read model without changing the transport contract", () => {
    expect(sql).toMatch(/pg_get_functiondef\('public\.get_payroll_self_approval\(date\)'::regprocedure\)/i);
    expect(sql).toMatch(/v_period_payload -> 'snapshot' -> 'period'/i);
    expect(sql).toMatch(/'state',\s*'ok'/i);
    expect(sql).toMatch(/'selectedLocalDate',\s*selected_local_date/i);
    expect(sql).toMatch(/'approval',\s*jsonb_build_object/i);
    expect(sql).toMatch(/'compensation',\s*jsonb_build_object\(\s*'grossEarningsCents'/i);
  });

  it("atomically appends one approval_invalidated transition for reviewable payroll appends only in submitted or manager_approved states", () => {
    expect(sql).toMatch(/create or replace function app\.append_payroll_approval_invalidation\(/i);
    expect(sql).toMatch(/p_target_organization_id uuid/i);
    expect(sql).toMatch(/p_employment_profile_id uuid/i);
    expect(sql).toMatch(/p_pay_period_id uuid/i);
    expect(sql).toMatch(/p_source_actor_user_id uuid/i);
    expect(sql).toMatch(/p_source_table text/i);
    expect(sql).toMatch(/pg_catalog\.pg_advisory_xact_lock/i);
    expect(sql).toMatch(/from public\.timesheet_approvals/i);
    expect(sql).toMatch(/app\.payroll_approval_transition_allowed\(v_latest\.action,\s*'approval_invalidated'\)/i);
    expect(sql).toMatch(/insert into public\.timesheet_approvals/i);
    expect(sql).toMatch(/'approval_invalidated'/i);
    expect(sql).toMatch(/previous_transition_id/i);
    expect(sql).toMatch(/actor_user_id[\s\S]*p_source_actor_user_id/i);
    expect(sql).toMatch(/target_table[\s\S]*'timesheet_approvals'/i);
    expect(sql).toMatch(/resolvedAction',\s*'approval_invalidated'/i);
  });

  it("wires invalidation triggers to reviewable payroll append tables without widening tenant scope, RLS, or grants", () => {
    for (const tableName of [
      "employee_time_events",
      "session_attendance_events",
      "time_correction_requests",
      "session_attendance_correction_requests",
      "timekeeping_exceptions",
    ]) {
      expect(sql).toMatch(new RegExp(`create trigger[\\s\\S]*on public\\.${tableName}`, "i"));
      expect(sql).toMatch(new RegExp(`for each row[\\s\\S]*execute function app\\..*${tableName}`, "i"));
    }

    expect(sql).toMatch(/organization_id = new\.organization_id/i);
    expect(sql).not.toMatch(/grant select on public\.timesheet_approvals to service_role/i);
    expect(sql).not.toMatch(/grant insert on public\.timesheet_approvals to authenticated/i);
    expect(sql).not.toMatch(/alter table public\.timesheet_approvals disable row level security/i);
  });
});
