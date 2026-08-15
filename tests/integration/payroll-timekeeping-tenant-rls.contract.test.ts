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
const sessionLifecyclePrecedenceRepairMigrationName =
  "20260814183500_payroll_session_context_disabled_precedence.sql";
const sessionLifecyclePrecedenceRepairSql = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    sessionLifecyclePrecedenceRepairMigrationName,
  ),
  "utf8",
);
const sessionLifecycleEnabledAuthorityRepairMigrationName =
  "20260814191200_payroll_session_context_enabled_authority_repair.sql";
const sessionLifecycleEnabledAuthorityRepairSql = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    sessionLifecycleEnabledAuthorityRepairMigrationName,
  ),
  "utf8",
);
const approvalMigrationName =
  readdirSync(path.join(process.cwd(), "supabase", "migrations")).find((name) =>
    name.endsWith("payroll_approval_workflow.sql"),
  ) ?? "";
const approvalSql = approvalMigrationName
  ? readFileSync(
      path.join(process.cwd(), "supabase", "migrations", approvalMigrationName),
      "utf8",
    )
  : "";
const reviewReadModelsMigrationName =
  readdirSync(path.join(process.cwd(), "supabase", "migrations")).find((name) =>
    name.endsWith("payroll_review_read_models.sql"),
  ) ?? "";
const reviewReadModelsSql = reviewReadModelsMigrationName
  ? readFileSync(
      path.join(process.cwd(), "supabase", "migrations", reviewReadModelsMigrationName),
      "utf8",
    )
  : "";
const managerAssignmentAdvisorRemediationMigrationName =
  readdirSync(path.join(process.cwd(), "supabase", "migrations")).find((name) =>
    name.endsWith("payroll_manager_assignment_advisor_remediation.sql"),
  ) ?? "";
const managerAssignmentAdvisorRemediationSql =
  managerAssignmentAdvisorRemediationMigrationName
    ? readFileSync(
        path.join(
          process.cwd(),
          "supabase",
          "migrations",
          managerAssignmentAdvisorRemediationMigrationName,
        ),
        "utf8",
      )
    : "";
const mutationReceiptsInitplanMigrationName =
  readdirSync(path.join(process.cwd(), "supabase", "migrations")).find((name) =>
    name.endsWith("payroll_mutation_receipts_initplan.sql"),
  ) ?? "";
const mutationReceiptsInitplanSql =
  mutationReceiptsInitplanMigrationName
    ? readFileSync(
        path.join(
          process.cwd(),
          "supabase",
          "migrations",
          mutationReceiptsInitplanMigrationName,
        ),
        "utf8",
      )
    : "";
const sessionLifecycleSql = `${sessionLifecycleBaseSql}\n${sessionLifecycleAdditiveSql}\n${sessionLifecyclePrecedenceRepairSql}\n${sessionLifecycleEnabledAuthorityRepairSql}`;
const functionDefinition = (qualifiedName: string): string => {
  const matches = `${sql}\n${captureSql}\n${sessionLifecycleSql}\n${approvalSql}\n${reviewReadModelsSql}`.match(
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

  it("keeps the bounded Task 2E lifecycle history and adds a capability-gated disabled-state precedence repair", () => {
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
    expect(sessionLifecyclePrecedenceRepairSql).toMatch(
      /@migration-dependencies:\s*20260812113000_payroll_session_lifecycle_context_disabled_state\.sql/i,
    );
    expect(sessionLifecyclePrecedenceRepairSql).toMatch(
      /v_can_record_assigned\s*:=\s*app\.payroll_actor_has_capability\([\s\S]*?'session_attendance\.record_assigned'/i,
    );
    expect(sessionLifecyclePrecedenceRepairSql).toMatch(
      /v_feature_flag_found is true[\s\S]*?v_can_record_assigned[\s\S]*?'state',\s*'feature_disabled'/i,
    );
    expect(sessionLifecycleEnabledAuthorityRepairSql).toMatch(
      /@migration-dependencies:\s*20260814183500_payroll_session_context_disabled_precedence\.sql/i,
    );
    expect(sessionLifecycleEnabledAuthorityRepairSql).toMatch(
      /v_actor_is_assigned_employee\s*:=\s*v_employment\.user_id\s*=\s*v_actor/i,
    );
    expect(sessionLifecycleEnabledAuthorityRepairSql).not.toMatch(
      /v_actor_is_assigned_employee\s*:=\s*v_session\.therapist_id\s*=\s*v_actor/i,
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

  it("keeps the foundation policy shape while the effective remediation policy uses initplan-safe auth uid evaluation", () => {
    const foundationManagerAssignments = policyDefinition(
      "employee_manager_assignments_authenticated_select",
    );

    expect(foundationManagerAssignments).toMatch(
      /app\.payroll_actor_in_organization\(organization_id\)/i,
    );
    expect(foundationManagerAssignments).toMatch(/manager_user_id = auth\.uid\(\)/i);
    expect(foundationManagerAssignments).toMatch(/time\.review_assigned/i);
    expect(foundationManagerAssignments).toMatch(/time\.approve_assigned/i);
    expect(foundationManagerAssignments).toMatch(/payroll\.configure_employment/i);

    expect(managerAssignmentAdvisorRemediationSql).toMatch(
      /alter policy employee_manager_assignments_authenticated_select\s+on public\.employee_manager_assignments\s+using\s*\(\s*\(\s*app\.payroll_actor_in_organization\(organization_id\)\s+and manager_user_id = \(select auth\.uid\(\)\)\s+and\s+\(\s*app\.payroll_actor_has_capability\(organization_id,\s*'time\.review_assigned'\)\s+or app\.payroll_actor_has_capability\(organization_id,\s*'time\.approve_assigned'\)\s*\)\s*\)\s+or app\.payroll_actor_has_capability\(organization_id,\s*'payroll\.configure_employment'\)\s*\);/i,
    );
    expect(managerAssignmentAdvisorRemediationSql).not.toMatch(
      /payroll\.resolve_exceptions|payroll\.view_compensation|time\.view_self/i,
    );

    const foundationMutationReceipts = policyDefinition(
      "payroll_mutation_receipts_authenticated_select",
    );

    expect(foundationMutationReceipts).toMatch(
      /app\.payroll_actor_in_organization\(organization_id\)/i,
    );
    expect(foundationMutationReceipts).toMatch(/actor_user_id = auth\.uid\(\)/i);
    expect(foundationMutationReceipts).toMatch(/payroll\.resolve_exceptions/i);

    expect(mutationReceiptsInitplanSql).toMatch(
      /alter policy payroll_mutation_receipts_authenticated_select\s+on public\.payroll_mutation_receipts\s+using\s*\(\s*\(\s*app\.payroll_actor_in_organization\(organization_id\)\s+and actor_user_id = \(select auth\.uid\(\)\)\s*\)\s+or app\.payroll_actor_has_capability\(organization_id,\s*'payroll\.resolve_exceptions'\)\s*\);/i,
    );
    expect(mutationReceiptsInitplanSql).not.toMatch(
      /time\.review_assigned|time\.approve_assigned|payroll\.configure_employment|payroll\.view_compensation|time\.view_self/i,
    );
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

  it("keeps approval history and blocker resolutions rpc-only behind authenticated read policies", () => {
    expect(approvalSql).toMatch(/alter table public\.timesheet_approvals enable row level security/i);
    expect(approvalSql).toMatch(/alter table public\.payroll_blocker_resolutions enable row level security/i);
    expect(approvalSql).toMatch(/create policy timesheet_approvals_authenticated_select/i);
    expect(approvalSql).toMatch(/create policy payroll_blocker_resolutions_authenticated_select/i);
    expect(approvalSql).toMatch(/revoke all on public\.timesheet_approvals from public, anon, authenticated/i);
    expect(approvalSql).toMatch(/revoke all on public\.payroll_blocker_resolutions from public, anon, authenticated/i);
    expect(approvalSql).toMatch(/grant select on public\.timesheet_approvals to authenticated/i);
    expect(approvalSql).toMatch(/grant select on public\.payroll_blocker_resolutions to authenticated/i);
    expect(approvalSql).not.toMatch(/grant insert on public\.timesheet_approvals to authenticated/i);
    expect(approvalSql).not.toMatch(/grant update on public\.timesheet_approvals to authenticated/i);
    expect(approvalSql).not.toMatch(/grant delete on public\.timesheet_approvals to authenticated/i);
  });

  it("keeps actor-bound approval and blocker-resolution rpc execution off service role", () => {
    expect(approvalSql).toMatch(
      /revoke all on function public\.transition_timesheet_approval\(jsonb, text\) from public, anon, service_role/i,
    );
    expect(approvalSql).toMatch(
      /grant execute on function public\.transition_timesheet_approval\(jsonb, text\) to authenticated/i,
    );
    expect(approvalSql).not.toMatch(
      /grant execute on function public\.transition_timesheet_approval\(jsonb, text\) to authenticated,\s*service_role/i,
    );
    expect(approvalSql).toMatch(
      /revoke all on function public\.resolve_payroll_blocker\(jsonb, text\) from public, anon, service_role/i,
    );
    expect(approvalSql).toMatch(
      /grant execute on function public\.resolve_payroll_blocker\(jsonb, text\) to authenticated/i,
    );
    expect(approvalSql).not.toMatch(
      /grant execute on function public\.resolve_payroll_blocker\(jsonb, text\) to authenticated,\s*service_role/i,
    );
  });

  it("scopes approval visibility to self, exact assigned managers, and explicit payroll grants without exposing compensation through manager review", () => {
    const approvalPolicy = approvalSql.match(
      /create policy timesheet_approvals_authenticated_select[\s\S]*?\n\s*\);/i,
    )?.[0] ?? "";
    expect(approvalPolicy).toMatch(/app\.current_user_can_read_payroll_employee\(organization_id,\s*employment_profile_id\)/i);
    expect(approvalPolicy).toMatch(/employee_manager_assignments assignment_row/i);
    expect(approvalPolicy).toMatch(/manager_user_id = auth\.uid\(\)/i);
    expect(approvalPolicy).toMatch(/time\.review_assigned|time\.approve_assigned/i);
    expect(approvalPolicy).toMatch(/payroll\.lock_period|payroll\.reopen_period|payroll\.resolve_exceptions/i);
    expect(approvalPolicy).not.toMatch(/employee_rate_versions/i);
    expect(approvalPolicy).not.toMatch(/payroll\.view_compensation/i);
  });

  it("moves pay-period lock authority to the latest approval transition chain", () => {
    expect(functionDefinition("app.payroll_event_is_locked")).toMatch(/from public\.timesheet_approvals/i);
    expect(functionDefinition("app.payroll_event_is_locked")).toMatch(/approval_row\.action = 'locked'/i);
    expect(functionDefinition("app.payroll_event_is_locked")).not.toMatch(/period_row\.locked_at is not null/i);
    expect(functionDefinition("app.payroll_event_is_locked")).toMatch(/period_row\.exported_at is not null/i);
  });

  it("keeps payroll review read models authenticated-only and off raw service-role table access", () => {
    expect(reviewReadModelsSql).toMatch(
      /revoke all on function public\.get_payroll_self_approval\(date\) from public,\s*anon,\s*service_role/i,
    );
    expect(reviewReadModelsSql).toMatch(
      /grant execute on function public\.get_payroll_self_approval\(date\) to authenticated/i,
    );
    expect(reviewReadModelsSql).not.toMatch(
      /grant execute on function public\.get_payroll_self_approval\(date\) to authenticated,\s*service_role/i,
    );
    expect(reviewReadModelsSql).toMatch(
      /revoke all on function public\.get_payroll_review_queue\(date\) from public,\s*anon,\s*service_role/i,
    );
    expect(reviewReadModelsSql).toMatch(
      /grant execute on function public\.get_payroll_review_queue\(date\) to authenticated/i,
    );
    expect(reviewReadModelsSql).not.toMatch(
      /grant execute on function public\.get_payroll_review_queue\(date\) to authenticated,\s*service_role/i,
    );
    expect(reviewReadModelsSql).toMatch(
      /revoke all on function public\.get_payroll_review_details\(uuid,\s*text\) from public,\s*anon,\s*service_role/i,
    );
    expect(reviewReadModelsSql).toMatch(
      /grant execute on function public\.get_payroll_review_details\(uuid,\s*text\) to authenticated/i,
    );
    expect(reviewReadModelsSql).not.toMatch(
      /grant execute on function public\.get_payroll_review_details\(uuid,\s*text\) to authenticated,\s*service_role/i,
    );
    expect(reviewReadModelsSql).not.toMatch(/grant select on public\.employee_rate_versions to authenticated,\s*service_role/i);
    expect(reviewReadModelsSql).not.toMatch(/grant select on public\.timesheet_snapshot_lines to authenticated,\s*service_role/i);
  });

  it("keeps payroll administration rpc execution authenticated-only and off direct admin-table deletes", () => {
    const administrationMigrationName =
      readdirSync(path.join(process.cwd(), "supabase", "migrations")).find((name) =>
        name.endsWith("payroll_administration.sql"),
      ) ?? "";
    const administrationSql = administrationMigrationName
      ? readFileSync(
          path.join(process.cwd(), "supabase", "migrations", administrationMigrationName),
          "utf8",
        )
      : "";

    expect(administrationSql).toMatch(
      /revoke all on function public\.execute_payroll_administration\(jsonb, text\) from public,\s*anon,\s*service_role/i,
    );
    expect(administrationSql).toMatch(
      /grant execute on function public\.execute_payroll_administration\(jsonb, text\) to authenticated/i,
    );
    expect(administrationSql).not.toMatch(
      /grant execute on function public\.execute_payroll_administration\(jsonb, text\) to authenticated,\s*service_role/i,
    );
    expect(administrationSql).toMatch(
      /revoke all on function public\.get_payroll_administration\(date\) from public,\s*anon,\s*service_role/i,
    );
    expect(administrationSql).toMatch(
      /grant execute on function public\.get_payroll_administration\(date\) to authenticated/i,
    );
    expect(administrationSql).not.toMatch(
      /grant delete on public\.pay_group_generation_versions to authenticated/i,
    );
    expect(administrationSql).not.toMatch(
      /grant delete on public\.pay_periods to authenticated/i,
    );
    expect(administrationSql).not.toMatch(/grant select on public\.employee_rate_versions to service_role/i);
  });

  it("binds review reads to exact current assignment or explicit payroll grants without exposing non-payroll fields", () => {
    const queueDefinition = functionDefinition("public.get_payroll_review_queue");
    const detailsDefinition = functionDefinition("public.get_payroll_review_details");
    expect(queueDefinition).toMatch(
      /app\.current_user_can_read_payroll_employee\(employment\.organization_id,\s*employment\.id\)/i,
    );
    expect(queueDefinition).toMatch(/time\.review_assigned/i);
    expect(queueDefinition).toMatch(/time\.approve_assigned/i);
    expect(queueDefinition).toMatch(/payroll\.configure_employment/i);
    expect(queueDefinition).toMatch(/payroll\.lock_period/i);
    expect(queueDefinition).toMatch(/payroll\.reopen_period/i);
    expect(queueDefinition).toMatch(/payroll\.resolve_exceptions/i);
    expect(queueDefinition).toMatch(/payroll\.export_period/i);
    expect(queueDefinition).toMatch(/payroll\.view_compensation/i);
    expect(queueDefinition).toMatch(/app\.payroll_feature_enabled\(/i);
    expect(queueDefinition).not.toMatch(/session_id/i);
    expect(queueDefinition).not.toMatch(/client_id/i);
    expect(detailsDefinition).toMatch(/app\.timesheet_snapshot_is_current\(/i);
    expect(detailsDefinition).toMatch(/v_snapshot\.canonical_payload\s*->\s*'period'/i);
    expect(detailsDefinition).toMatch(/app\.current_user_can_manage_payroll_employee\(/i);
    expect(detailsDefinition).not.toMatch(/from public\.employee_time_events/i);
    expect(detailsDefinition).not.toMatch(/from public\.session_attendance_events/i);
    expect(detailsDefinition).not.toMatch(/from public\.time_correction_requests/i);
    expect(detailsDefinition).not.toMatch(/from public\.session_attendance_correction_requests/i);
    expect(detailsDefinition).not.toMatch(/from public\.timekeeping_exceptions/i);
    expect(detailsDefinition).not.toMatch(/session_id/i);
    expect(detailsDefinition).not.toMatch(/client_id/i);
    expect(detailsDefinition).not.toMatch(/hourly_rate_cents/i);
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
