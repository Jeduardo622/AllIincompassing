import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const sessionLifecycleMigrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith("payroll_session_lifecycle_context.sql"),
);
const sessionLifecycleMigrationName = sessionLifecycleMigrationNames[0] ?? "";
const sessionLifecycleMigrationPath = sessionLifecycleMigrationName
  ? path.join(migrationsDir, sessionLifecycleMigrationName)
  : "";
const sessionLifecycleMigrationExists =
  sessionLifecycleMigrationPath !== "" && existsSync(sessionLifecycleMigrationPath);
const sessionLifecycleSql = sessionLifecycleMigrationExists
  ? readFileSync(sessionLifecycleMigrationPath, "utf8")
  : "";

const functionDefinition = (qualifiedName: string): string =>
  sessionLifecycleSql.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0] ?? "";

describe("payroll session lifecycle context migration contract", () => {
  it("creates exactly one governed Task 2E-A lifecycle migration", () => {
    expect(sessionLifecycleMigrationNames).toHaveLength(1);
    expect(sessionLifecycleMigrationExists).toBe(true);
    expect(sessionLifecycleSql).toMatch(
      /@migration-dependencies:\s*20260811214856_payroll_timekeeping_capture_read_model\.sql/i,
    );
    expect(sessionLifecycleSql).toMatch(
      /@migration-rollback:.*get_session_payroll_context.*record_session_attendance_event/i,
    );
  });

  it("adds a caller-jwt scoped session payroll context rpc", () => {
    const definition = functionDefinition("public.get_session_payroll_context");
    expect(definition).toMatch(/returns jsonb/i);
    expect(definition).toMatch(/stable/i);
    expect(definition).toMatch(/security definer/i);
    expect(definition).toMatch(/set search_path = ''/i);
    expect(definition).toMatch(/auth\.uid\(\)/i);
    expect(definition).toMatch(/app\.resolve_user_organization_id/i);
    expect(definition).toMatch(/current_user_is_super_admin/i);
    expect(definition).toMatch(/current_user_has_exact_role_for_org/i);
    expect(definition).toMatch(/user_therapist_links/i);
    expect(definition).toMatch(/time\.clock_self/i);
    expect(definition).toMatch(/actorIsAssignedEmployee/i);
    expect(definition).toMatch(/canClockSelf/i);
    expect(definition).toMatch(/employmentTimezone/i);
    expect(definition).toMatch(/canonicalWorkLocation/i);
    expect(definition).toMatch(/activeShiftEventId/i);
    expect(definition).toMatch(/location_type/i);
    expect(definition).toMatch(/shift_event\.event_type = 'shift_started'/i);
    expect(definition).toMatch(/shift_end\.event_type = 'shift_ended'/i);
    expect(definition).toMatch(/else 'other'::public\.work_location/i);
    expect(sessionLifecycleSql).toMatch(
      /revoke all on function public\.get_session_payroll_context\(uuid\) from public, anon, authenticated/i,
    );
    expect(sessionLifecycleSql).toMatch(
      /revoke all on function public\.get_session_payroll_context\(uuid\) from service_role/i,
    );
    expect(sessionLifecycleSql).toMatch(
      /grant execute on function public\.get_session_payroll_context\(uuid\) to authenticated/i,
    );
    expect(sessionLifecycleSql).not.toMatch(
      /grant execute on function public\.get_session_payroll_context\(uuid\) to authenticated,\s*service_role/i,
    );
  });

  it("replaces attendance recording with server-derived authority and shift linkage", () => {
    const definition = functionDefinition("public.record_session_attendance_event");
    expect(definition).toMatch(/public\.get_session_payroll_context/i);
    expect(definition).toMatch(/return v_receipt\.result_payload/i);
    expect(definition).toMatch(/v_receipt\.payload_hash <> v_payload_hash/i);
    expect(definition).toMatch(/actorIsAssignedEmployee/i);
    expect(definition).toMatch(/canClockSelf/i);
    expect(definition).toMatch(/canonicalWorkLocation/i);
    expect(definition).toMatch(/activeShiftEventId/i);
    expect(definition).toMatch(/openSessionStartedEventId/i);
    expect(definition).toMatch(/insert into public\.session_attendance_events/i);
    expect(definition).toMatch(/event_type = 'session_started' and v_linked_employee_time_event_id is null/i);
    expect(definition).toMatch(/session_outside_shift/i);
    expect(definition).toMatch(/source_session_attendance_event_id/i);
    expect(definition).not.toMatch(/event_payload ->> 'timezone'/i);
    expect(definition).not.toMatch(/event_payload ->> 'workLocation'/i);
    expect(definition).not.toMatch(/v_event_data ->> 'employeeTimeEventId'/i);
    expect(definition).not.toMatch(/data->>'employeeTimeEventId'/i);
    expect(definition).not.toMatch(/data->>'activeShiftEventId'/i);
    expect(sessionLifecycleSql).toMatch(
      /revoke all on function public\.record_session_attendance_event\(jsonb, text\) from service_role/i,
    );
    expect(sessionLifecycleSql).toMatch(
      /grant execute on function public\.record_session_attendance_event\(jsonb, text\) to authenticated/i,
    );
    expect(sessionLifecycleSql).not.toMatch(
      /grant execute on function public\.record_session_attendance_event\(jsonb, text\) to authenticated,\s*service_role/i,
    );
  });
});
