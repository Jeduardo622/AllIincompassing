import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260811190901_payroll_timekeeping_foundation.sql",
  ),
  "utf8",
);

describe("payroll timekeeping tenant and RLS contract", () => {
  it("denies cross-organization event reads", () => {
    expect(sql).toMatch(
      /create policy employee_time_events_authenticated_select[\s\S]*app\.current_user_can_manage_payroll_employee/i,
    );
    expect(sql).toMatch(
      /create policy session_attendance_events_authenticated_select[\s\S]*app\.current_user_can_manage_payroll_employee/i,
    );
  });

  it("denies direct authenticated source-event inserts", () => {
    expect(sql).toMatch(/revoke all on public\.employee_time_events from public, anon, authenticated/i);
    expect(sql).toMatch(/revoke all on public\.session_attendance_events from public, anon, authenticated/i);
  });

  it("denies source-event update and delete through service role", () => {
    expect(sql).toMatch(/revoke all on public\.employee_time_events from service_role/i);
    expect(sql).toMatch(/revoke all on public\.session_attendance_events from service_role/i);
    expect(sql).toMatch(/before update or delete on public\.employee_time_events/i);
    expect(sql).toMatch(/before update or delete on public\.session_attendance_events/i);
  });

  it("allows an employee to read only their own source events", () => {
    expect(sql).toMatch(/create or replace function app\.current_user_can_read_payroll_employee/i);
    expect(sql).toMatch(/profile\.user_id = auth\.uid\(\)/i);
  });

  it("allows an assigned manager to read assigned time without rates", () => {
    expect(sql).toMatch(/create or replace function app\.current_user_can_manage_payroll_employee/i);
    expect(sql).toMatch(/employee_manager_assignments assignment_row/i);
    expect(sql).toMatch(/employee_rate_versions_authenticated_select[\s\S]*current_user_can_read_payroll_employee/i);
  });

  it("requires explicit payroll grant for compensation and export access", () => {
    expect(sql).toMatch(/create or replace function app\.payroll_actor_has_capability/i);
    expect(sql).toMatch(/role_row\.name in \('admin', 'super_admin'\)/i);
    expect(sql).toMatch(/from public\.payroll_capability_grants grant_row/i);
  });

  it("rejects metadata-only and profiles.role-only authority", () => {
    expect(sql).toMatch(/from public\.profiles profile[\s\S]*profile\.organization_id/i);
    expect(sql).not.toMatch(/profile\.role/i);
    expect(sql).not.toMatch(/user_has_role_for_org/i);
  });

  it("rejects overlapping active payroll employment across organizations", () => {
    expect(sql).toMatch(/employment_profiles_single_active_org_per_user/i);
    expect(sql).toMatch(/exclude using gist[\s\S]*user_id with =/i);
  });

  it("prevents retention below four years and blocks disposal under legal hold", () => {
    expect(sql).toMatch(/retention_years integer not null check \(retention_years >= 4\)/i);
    expect(sql).toMatch(/create table if not exists public\.payroll_legal_holds/i);
    expect(sql).not.toMatch(/\bdelete\s+from\s+public\.payroll_/i);
  });
});
