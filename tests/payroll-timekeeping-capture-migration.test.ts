import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const captureMigrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith("payroll_timekeeping_capture_read_model.sql"),
);
const captureMigrationName = captureMigrationNames[0] ?? "";
const captureMigrationPath = captureMigrationName
  ? path.join(migrationsDir, captureMigrationName)
  : "";
const captureMigrationExists =
  captureMigrationPath !== "" && existsSync(captureMigrationPath);
const captureSql = captureMigrationExists
  ? readFileSync(captureMigrationPath, "utf8")
  : "";

const functionDefinition = (qualifiedName: string): string =>
  captureSql.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0] ?? "";

describe("payroll timekeeping capture migration contract", () => {
  it("creates exactly one governed Task 2A capture migration", () => {
    expect(captureMigrationNames).toHaveLength(1);
    expect(captureMigrationExists).toBe(true);
    expect(captureSql).toMatch(
      /@migration-dependencies:\s*20260811190901_payroll_timekeeping_foundation\.sql/i,
    );
    expect(captureSql).toMatch(
      /@migration-rollback:.*get_payroll_day.*source_session_attendance_event_id.*record_session_attendance_event/i,
    );
  });

  it("adds same-org exception source linkage with scoped uniqueness and append-only protection", () => {
    expect(captureSql).toMatch(
      /alter table public\.timekeeping_exceptions[\s\S]*add column(?: if not exists)? source_session_attendance_event_id uuid/i,
    );
    expect(captureSql).toMatch(
      /foreign key \(source_session_attendance_event_id,\s*organization_id\)[\s\S]*references public\.session_attendance_events\(id,\s*organization_id\) on delete restrict/i,
    );
    expect(captureSql).toMatch(
      /create unique index[\s\S]*on public\.timekeeping_exceptions[\s\S]*\(organization_id,\s*source_session_attendance_event_id\)[\s\S]*where source_session_attendance_event_id is not null[\s\S]*exception_code = 'session_outside_shift'/i,
    );
    expect(captureSql).toMatch(
      /create trigger[\s\S]*before update or delete on public\.timekeeping_exceptions[\s\S]*app\.reject_payroll_source_mutation/i,
    );
  });

  it("adds a self-only payroll day read RPC with explicit states and fail-closed capability handling", () => {
    const definition = functionDefinition("public.get_payroll_day");
    expect(definition).toMatch(/returns jsonb/i);
    expect(definition).toMatch(/stable/i);
    expect(definition).toMatch(/security definer/i);
    expect(definition).toMatch(/set search_path = ''/i);
    expect(definition).toMatch(/auth\.uid\(\)/i);
    expect(definition).toMatch(/app\.resolve_user_organization_id/i);
    expect(definition).toMatch(/time\.view_self/i);
    expect(definition).toMatch(/feature_disabled/i);
    expect(definition).toMatch(/unsupported_jurisdiction/i);
    expect(definition).toMatch(/no_employment_profile/i);
    expect(definition).toMatch(/jsonb_build_object\(\s*'state',\s*'ok'/i);
    expect(definition).toMatch(/'employeeTimeEvents'/i);
    expect(definition).toMatch(/'sessionAttendanceEvents'/i);
    expect(definition).toMatch(/'timeCorrectionRequests'/i);
    expect(definition).toMatch(/'sessionAttendanceCorrectionRequests'/i);
    expect(definition).toMatch(/'exceptions'/i);
    expect(definition).toMatch(/Calculation pending/i);
    expect(definition).toMatch(/employment\.timezone/i);
    expect(definition).toMatch(/workday_starts_at/i);
    expect(definition).toMatch(/\[day_start,\s*next_day_start\)/i);
    expect(captureSql).toMatch(/revoke all on function public\.get_payroll_day\(date\) from public, anon/i);
    expect(captureSql).toMatch(/grant execute on function public\.get_payroll_day\(date\) to authenticated, service_role/i);
  });

  it("replaces attendance recording to atomically create and trace one outside-shift exception", () => {
    const definition = functionDefinition("public.record_session_attendance_event");
    expect(definition).toMatch(/return v_receipt\.result_payload/i);
    expect(definition).toMatch(/v_receipt\.payload_hash <> v_payload_hash/i);
    expect(definition).toMatch(/insert into public\.session_attendance_events/i);
    expect(definition).toMatch(/event_type = 'session_started'/i);
    expect(definition).toMatch(/employee_time_event_id is null/i);
    expect(definition).toMatch(/insert into public\.timekeeping_exceptions/i);
    expect(definition).toMatch(/session_outside_shift/i);
    expect(definition).toMatch(/source_session_attendance_event_id/i);
    expect(definition).toMatch(/insert into public\.payroll_audit_events/i);
    expect(definition).toMatch(/insert into public\.payroll_mutation_receipts/i);
    expect(definition.indexOf("return v_receipt.result_payload")).toBeLessThan(
      definition.indexOf("insert into public.session_attendance_events"),
    );
  });
});
