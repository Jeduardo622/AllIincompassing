import { readdirSync, readFileSync } from "node:fs";
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
const captureMigrationName =
  readdirSync(path.join(process.cwd(), "supabase", "migrations")).find((name) =>
    name.endsWith("payroll_timekeeping_capture_read_model.sql"),
  ) ?? "";
const captureSql = captureMigrationName
  ? readFileSync(
      path.join(process.cwd(), "supabase", "migrations", captureMigrationName),
      "utf8",
    )
  : "";
const sessionLifecycleBaseMigrationName =
  "20260812103000_payroll_session_lifecycle_context.sql";
const sessionLifecycleBaseSql = readFileSync(
  path.join(process.cwd(), "supabase", "migrations", sessionLifecycleBaseMigrationName),
  "utf8",
);
const sessionLifecycleAdditiveMigrationName =
  "20260812113000_payroll_session_lifecycle_context_disabled_state.sql";
const sessionLifecycleAdditiveSql = readFileSync(
  path.join(process.cwd(), "supabase", "migrations", sessionLifecycleAdditiveMigrationName),
  "utf8",
);
const sessionLifecycleSql = `${sessionLifecycleBaseSql}\n${sessionLifecycleAdditiveSql}`;
const functionDefinition = (qualifiedName: string): string => {
  const matches = `${sql}\n${captureSql}\n${sessionLifecycleSql}`.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "gi",
    ),
  );
  return matches?.at(-1) ?? "";
};
const policyDefinition = (policyName: string): string =>
  sql.match(
    new RegExp(`create policy ${policyName}[\\s\\S]*?\\n\\s*\\);`, "i"),
  )?.[0] ?? "";

describe("payroll timekeeping tenant and RLS contract", () => {
  it("adds the bounded Task 2 capture migration without widening raw exception reads", () => {
    expect(captureSql).toMatch(
      /@migration-dependencies:\s*20260811190901_payroll_timekeeping_foundation\.sql/i,
    );
    expect(captureSql).toMatch(
      /create or replace function public\.get_payroll_day\(local_date date\)/i,
    );
    expect(captureSql).toMatch(
      /grant execute on function public\.get_payroll_day\(date\) to authenticated, service_role/i,
    );
    expect(captureSql).not.toMatch(/grant select on public\.timekeeping_exceptions to service_role/i);
    expect(captureSql).not.toMatch(
      /create policy .*timekeeping_exceptions.*for select.*to authenticated.*using\s*\(\s*true\s*\)/i,
    );
  });

  it("keeps the bounded Task 2E lifecycle base migration and adds a scoped disabled-state override without widening raw source-event access", () => {
    expect(sessionLifecycleBaseSql).toMatch(
      /@migration-dependencies:\s*20260811214856_payroll_timekeeping_capture_read_model\.sql/i,
    );
    expect(sessionLifecycleBaseSql).toMatch(
      /create or replace function public\.get_session_payroll_context\(session_id uuid\)/i,
    );
    expect(sessionLifecycleAdditiveSql).toMatch(
      /@migration-dependencies:\s*20260812103000_payroll_session_lifecycle_context\.sql/i,
    );
    expect(sessionLifecycleAdditiveSql).toMatch(
      /create or replace function public\.get_session_payroll_context\(session_id uuid\)/i,
    );
    expect(sessionLifecycleAdditiveSql).toMatch(
      /grant execute on function public\.get_session_payroll_context\(uuid\) to authenticated/i,
    );
    expect(sessionLifecycleSql).not.toMatch(
      /grant execute on function public\.get_session_payroll_context\(uuid\) to authenticated,\s*service_role/i,
    );
    expect(sessionLifecycleSql).not.toMatch(
      /grant select on public\.session_attendance_events to service_role/i,
    );
  });

  it("denies cross-organization event reads", () => {
    expect(sql).toMatch(
      /create policy employee_time_events_authenticated_select[\s\S]*app\.current_user_can_read_payroll_employee/i,
    );
    expect(sql).toMatch(
      /create policy session_attendance_events_authenticated_select[\s\S]*app\.current_user_can_read_payroll_employee/i,
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
    const definition = functionDefinition("app.current_user_can_read_payroll_employee");
    expect(definition).toMatch(/app\.payroll_actor_in_organization\(/i);
    expect(definition).toMatch(/time\.view_self/i);
  });

  it("allows an assigned manager to read assigned time without rates", () => {
    expect(sql).toMatch(/create or replace function app\.current_user_can_read_payroll_employee/i);
    expect(sql).toMatch(/employee_manager_assignments assignment_row/i);
    const ratePolicy = policyDefinition("employee_rate_versions_authenticated_select");
    expect(ratePolicy).not.toMatch(/current_user_can_read_payroll_employee/i);
    expect(ratePolicy).not.toMatch(/time\.view_self/i);
    expect(ratePolicy).toMatch(/payroll\.view_compensation/i);
    expect(functionDefinition("app.current_user_can_read_payroll_employee")).toMatch(
      /time\.review_assigned/i,
    );
  });

  it("requires explicit payroll grant for compensation and export access", () => {
    expect(sql).toMatch(/create or replace function app\.payroll_actor_has_capability/i);
    expect(sql).toMatch(/role_row\.name in \('admin', 'super_admin'\)/i);
    expect(sql).toMatch(/from public\.payroll_capability_grants grant_row/i);
    expect(functionDefinition("app.payroll_actor_has_capability")).toMatch(
      /payroll\.view_compensation/i,
    );
    expect(sql).toMatch(/payroll\.export_period/i);
    expect(sql).not.toMatch(/'configure'|'compensation'|'lock'|'reopen'|'export'/i);
  });

  it("keeps correction and exception reads on the narrower manage helper", () => {
    const definition = functionDefinition("app.current_user_can_manage_payroll_employee");
    expect(definition).toMatch(/app\.payroll_actor_in_organization\(/i);
    expect(definition).toMatch(/time\.request_correction_self/i);
    expect(definition).toMatch(/time\.approve_assigned/i);
    expect(definition).toMatch(/payroll\.resolve_exceptions/i);
  });

  it("keeps payroll-day reads self-scoped and sanitized through the read RPC instead of raw table grants", () => {
    const definition = functionDefinition("public.get_payroll_day");
    expect(definition).toMatch(/time\.view_self/i);
    expect(definition).toMatch(/employment\.user_id = v_actor/i);
    expect(definition).toMatch(/employee_time_events/i);
    expect(definition).toMatch(/session_attendance_events/i);
    expect(definition).toMatch(/time_correction_requests/i);
    expect(definition).toMatch(/session_attendance_correction_requests/i);
    expect(definition).toMatch(/timekeeping_exceptions/i);
    expect(definition).not.toMatch(/employee_rate_versions/i);
    expect(definition).not.toMatch(/hourly_rate_cents/i);
  });

  it("keeps outside-shift exception uniqueness scoped to one attendance source row per org and code", () => {
    expect(captureSql).toMatch(
      /create unique index[\s\S]*on public\.timekeeping_exceptions[\s\S]*\(organization_id,\s*source_session_attendance_event_id\)[\s\S]*exception_code = 'session_outside_shift'/i,
    );
    expect(captureSql).not.toMatch(
      /create unique index[\s\S]*on public\.timekeeping_exceptions[\s\S]*\(organization_id,\s*source_session_attendance_event_id\)[\s\S]*where source_session_attendance_event_id is not null\s*;$/i,
    );
  });

  it("requires canonical actor-org proof on policy self and global-access branches", () => {
    const payrollPolicyVersions = policyDefinition("payroll_policy_versions_authenticated_select");
    expect(payrollPolicyVersions).toMatch(/organization_id is null/i);
    expect(payrollPolicyVersions).toMatch(
      /app\.payroll_actor_in_organization\(app\.resolve_user_organization_id\(auth\.uid\(\)\)\)/i,
    );
    const managerAssignments = policyDefinition("employee_manager_assignments_authenticated_select");
    expect(managerAssignments).toMatch(/app\.payroll_actor_in_organization\(organization_id\)/i);
    expect(managerAssignments).toMatch(/manager_user_id = auth\.uid\(\)/i);
    const mutationReceipts = policyDefinition("payroll_mutation_receipts_authenticated_select");
    expect(mutationReceipts).toMatch(/app\.payroll_actor_in_organization\(organization_id\)/i);
    expect(mutationReceipts).toMatch(/actor_user_id = auth\.uid\(\)/i);
  });

  it("rejects metadata-only and profiles.role-only authority", () => {
    expect(sql).toMatch(/from public\.profiles profile[\s\S]*profile\.organization_id/i);
    expect(sql).not.toMatch(/profile\.role/i);
    expect(sql).not.toMatch(/user_has_role_for_org/i);
  });

  it("routes delegated attendance append authority through the named capability inventory only", () => {
    expect(functionDefinition("app.payroll_actor_has_capability")).toMatch(
      /session_attendance\.record_assigned/i,
    );
    expect(functionDefinition("app.payroll_actor_has_capability")).toMatch(
      /role_row\.name in \('admin', 'super_admin', 'admin_schedule'\)/i,
    );
    const definition = functionDefinition("public.record_session_attendance_event");
    expect(definition).not.toMatch(/public\.get_session_payroll_context/i);
    expect(definition).toMatch(/v_employment\.user_id = v_actor/i);
    expect(definition).toMatch(/session_attendance\.record_assigned/i);
  });

  it("keeps session attendance authority server-derived and authenticated-only", () => {
    const contextDefinition = functionDefinition("public.get_session_payroll_context");
    expect(contextDefinition).toMatch(/auth\.uid\(\)/i);
    expect(contextDefinition).toMatch(/app\.resolve_user_organization_id/i);
    expect(contextDefinition).toMatch(/session_attendance\.record_assigned/i);
    expect(contextDefinition).toMatch(/from public\.feature_flags flag/i);
    expect(contextDefinition).toMatch(/left join public\.organization_feature_flags org_override/i);
    expect(contextDefinition).not.toMatch(/user_therapist_links/i);
    expect(contextDefinition).not.toMatch(/app\.payroll_feature_enabled/i);
    expect(contextDefinition).toMatch(/location_type/i);
    expect(contextDefinition).toMatch(/'other'/i);
    expect(contextDefinition).toMatch(/'state',\s*'feature_disabled'/i);
    expect(contextDefinition).toMatch(/'state',\s*'ok'/i);
    expect(contextDefinition).toMatch(/unsupported payroll jurisdiction/i);
    expect(contextDefinition).toMatch(/active payroll policy is required/i);
    expect(contextDefinition).not.toMatch(/profile\.role/i);
    expect(contextDefinition).not.toMatch(/event_payload/i);

    const definition = functionDefinition("public.record_session_attendance_event");
    expect(definition).not.toMatch(/public\.get_session_payroll_context/i);
    expect(definition).toMatch(/app\.payroll_feature_enabled\(v_actor_org,\s*v_employment\.home_jurisdiction,\s*null\)/i);
    expect(definition).not.toMatch(/event_payload ->> 'timezone'/i);
    expect(definition).not.toMatch(/event_payload ->> 'workLocation'/i);
    expect(definition).not.toMatch(/v_event_data ->> 'employeeTimeEventId'/i);
    expect(definition).not.toMatch(/data->>'employeeTimeEventId'/i);
    expect(definition).not.toMatch(/data->>'activeShiftEventId'/i);
  });

  it("uses employment and pay-group event time instead of current_date for source authority and locks", () => {
    expect(functionDefinition("public.record_employee_time_event")).toMatch(
      /employment\.active_from <= \(\(v_event_at at time zone employment\.timezone\)::date\)/i,
    );
    expect(functionDefinition("public.record_session_attendance_event")).toMatch(
      /employment\.active_from <= \(\(v_event_at at time zone employment\.timezone\)::date\)/i,
    );
    expect(functionDefinition("app.payroll_event_is_locked")).toMatch(
      /p_employment_profile_id uuid[\s\S]*assignment_row\.employment_profile_id = p_employment_profile_id[\s\S]*group_row\.timezone/i,
    );
    expect(functionDefinition("app.current_user_can_read_payroll_employee")).not.toMatch(
      /active_from <= current_date/i,
    );
    expect(functionDefinition("app.current_user_can_manage_payroll_employee")).not.toMatch(
      /active_from <= current_date/i,
    );
  });

  it("removes blanket service-role raw-table reads while preserving reviewed RPC execution", () => {
    expect(sql).not.toMatch(/create policy .*_service_role_select/i);
    expect(sql).not.toMatch(/grant select on public\.employee_rate_versions to authenticated,\s*service_role/i);
    expect(sql).toMatch(
      /grant execute on function public\.record_employee_time_event\(jsonb, text\) to authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.request_session_attendance_correction\(jsonb, text\) to authenticated, service_role/i,
    );
    expect(sessionLifecycleSql).toMatch(
      /revoke all on function public\.record_session_attendance_event\(jsonb, text\) from service_role/i,
    );
    expect(sessionLifecycleSql).not.toMatch(
      /grant execute on function public\.record_session_attendance_event\(jsonb, text\) to authenticated,\s*service_role/i,
    );
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
