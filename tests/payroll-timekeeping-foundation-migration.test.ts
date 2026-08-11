import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationName =
  "20260811190901_payroll_timekeeping_foundation.sql";
const migrationPath = path.join(migrationsDir, migrationName);
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

const enumValues = (typeName: string): string[] => {
  const body = sql.match(
    new RegExp(`create type public\\.${typeName} as enum \\(([\\s\\S]*?)\\);`, "i"),
  )?.[1];
  return body ? [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]) : [];
};

const functionDefinition = (qualifiedName: string): string =>
  sql.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0] ?? "";
const policyDefinition = (policyName: string): string =>
  sql.match(
    new RegExp(`create policy ${policyName}[\\s\\S]*?\\n\\s*\\);`, "i"),
  )?.[0] ?? "";

const requiredTables = [
  "employment_profiles",
  "payroll_organization_settings",
  "employee_rate_versions",
  "pay_groups",
  "pay_group_assignments",
  "pay_periods",
  "payroll_policy_versions",
  "payroll_capability_grants",
  "employee_manager_assignments",
  "payroll_mutation_receipts",
  "payroll_audit_events",
  "employee_time_events",
  "session_attendance_events",
  "time_correction_requests",
  "session_attendance_correction_requests",
  "timekeeping_exceptions",
  "payroll_retention_policies",
  "payroll_legal_holds",
] as const;

describe("payroll timekeeping foundation migration contract", () => {
  it("creates the payroll foundation migration file", () => {
    expect(migrationExists).toBe(true);
  });

  it("replaces the generated dependency placeholder and creates every protected table with forced RLS", () => {
    expect(sql).toMatch(
      /@migration-dependencies:\s*20260810222545_bt_closeout_legacy_therapist_compat\.sql/i,
    );

    for (const table of requiredTables) {
      expect(sql).toMatch(
        new RegExp(`create table(?: if not exists)? public\\.${table}`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table} force row level security`,
          "i",
        ),
      );
    }
  });

  it("hardens payroll functions, append-only protections, and least-privilege grants", () => {
    expect(sql).toMatch(/create or replace function app\.payroll_feature_enabled\(/i);
    expect(sql).toMatch(/create or replace function app\.payroll_actor_in_organization\(/i);
    expect(sql).toMatch(/create or replace function app\.payroll_actor_has_capability\(/i);
    expect(sql).toMatch(/create or replace function app\.reject_payroll_source_mutation\(/i);
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function public\.record_employee_time_event\(jsonb, text\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.record_employee_time_event\(jsonb, text\) to authenticated, service_role/i);
    expect(sql).not.toMatch(/record_employee_time_event\(uuid, uuid, public\.payroll_event_type, timestamptz, text, text, text, jsonb\)/i);
    expect(sql).toMatch(/revoke all on function public\.record_session_attendance_event\(jsonb, text\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.record_session_attendance_event\(jsonb, text\) to authenticated, service_role/i);
    expect(sql).not.toMatch(/record_session_attendance_event\(uuid, uuid, uuid, public\.session_attendance_event_type, timestamptz, text, uuid, text, jsonb\)/i);
    expect(sql).toMatch(/revoke all on function public\.request_time_correction\(jsonb, text\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.request_time_correction\(jsonb, text\) to authenticated, service_role/i);
    expect(sql).not.toMatch(/request_time_correction\(uuid, uuid, text, text, jsonb\)/i);
    expect(sql).toMatch(
      /revoke all on function public\.request_session_attendance_correction\(jsonb, text\) from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.request_session_attendance_correction\(jsonb, text\) to authenticated, service_role/i,
    );
    expect(sql).not.toMatch(
      /request_session_attendance_correction\(uuid, uuid, text, text, jsonb\)/i,
    );
    expect(sql).toMatch(
      /revoke\s+insert\s*,\s*update\s*,\s*delete[\s\S]+employee_time_events[\s\S]+authenticated/i,
    );
    expect(sql).toMatch(
      /create trigger[\s\S]+before update or delete on public\.employee_time_events[\s\S]+app\.reject_payroll_source_mutation/i,
    );
    expect(sql).toMatch(
      /create trigger[\s\S]+before update or delete on public\.payroll_audit_events[\s\S]+app\.reject_payroll_source_mutation/i,
    );
  });

  it("defines the exact stable payroll domain vocabularies", () => {
    expect(enumValues("payroll_capability")).toEqual([
      "time.clock_self",
      "time.view_self",
      "time.request_correction_self",
      "time.review_assigned",
      "time.approve_assigned",
      "session_attendance.record_assigned",
      "payroll.configure_employment",
      "payroll.resolve_exceptions",
      "payroll.lock_period",
      "payroll.reopen_period",
      "payroll.export_period",
      "payroll.view_compensation",
    ]);
    expect(enumValues("payroll_event_type")).toEqual([
      "shift_started",
      "shift_ended",
      "meal_started",
      "meal_ended",
      "work_category_changed",
    ]);
    expect(enumValues("session_attendance_event_type")).toEqual([
      "session_started",
      "session_ended",
    ]);
    expect(enumValues("work_category")).toEqual([
      "direct_service",
      "administration",
      "travel",
      "training",
    ]);
    expect(enumValues("work_location")).toEqual([
      "client_site",
      "office",
      "home",
      "community",
      "other",
    ]);
    expect(sql).not.toMatch(/session_no_show|shift_start'|session_start'/i);
  });

  it("uses only the exact stable payroll capability names", () => {
    expect(sql).toMatch(/time\.clock_self/i);
    expect(sql).toMatch(/time\.review_assigned/i);
    expect(sql).toMatch(/session_attendance\.record_assigned/i);
    expect(sql).toMatch(/payroll\.configure_employment/i);
    expect(sql).toMatch(/payroll\.view_compensation/i);
    expect(sql).not.toMatch(/'configure'|'compensation'|'lock'|'reopen'|'export'/i);
  });

  it("requires canonical actor scope and independent correction feature gates", () => {
    const actorPredicate = functionDefinition("app.payroll_actor_in_organization");
    expect(actorPredicate).toMatch(/auth\.uid\(\)/i);
    expect(actorPredicate).toMatch(/app\.resolve_user_organization_id\(v_actor\)/i);
    expect(actorPredicate).toMatch(/from public\.profiles/i);
    expect(actorPredicate).toMatch(/from public\.user_roles/i);
    expect(actorPredicate).toMatch(/join public\.roles role_row/i);
    expect(actorPredicate).toMatch(/membership\.expires_at/i);

    for (const name of [
      "app.current_user_can_read_payroll_employee",
      "app.current_user_can_manage_payroll_employee",
      "app.payroll_actor_has_capability",
    ]) {
      expect(functionDefinition(name)).toMatch(/app\.payroll_actor_in_organization\(/i);
    }

    expect(functionDefinition("app.current_user_can_read_payroll_employee")).toMatch(
      /time\.view_self/i,
    );
    expect(functionDefinition("app.current_user_can_read_payroll_employee")).toMatch(
      /time\.review_assigned/i,
    );
    expect(functionDefinition("app.current_user_can_manage_payroll_employee")).toMatch(
      /time\.request_correction_self/i,
    );
    expect(functionDefinition("app.current_user_can_manage_payroll_employee")).toMatch(
      /time\.approve_assigned/i,
    );
    const ratePolicy = policyDefinition("employee_rate_versions_authenticated_select");
    expect(ratePolicy).toMatch(/payroll\.view_compensation/i);
    expect(ratePolicy).not.toMatch(/current_user_can_read_payroll_employee/i);
    const payrollPolicyVersions = policyDefinition("payroll_policy_versions_authenticated_select");
    expect(payrollPolicyVersions).toMatch(/organization_id is null/i);
    expect(payrollPolicyVersions).toMatch(
      /app\.payroll_actor_in_organization\(app\.resolve_user_organization_id\(auth\.uid\(\)\)\)/i,
    );
    const managerAssignments = policyDefinition("employee_manager_assignments_authenticated_select");
    expect(managerAssignments).toMatch(/app\.payroll_actor_in_organization\(organization_id\)/i);
    expect(managerAssignments).toMatch(/time\.review_assigned/i);
    expect(managerAssignments).toMatch(/time\.approve_assigned/i);
    const mutationReceipts = policyDefinition("payroll_mutation_receipts_authenticated_select");
    expect(mutationReceipts).toMatch(/app\.payroll_actor_in_organization\(organization_id\)/i);
    expect(mutationReceipts).toMatch(/actor_user_id = auth\.uid\(\)/i);
    expect(sql).not.toMatch(/app\.user_has_role_for_org/i);
  });

  it("persists selected work context and serializes independent domain state", () => {
    expect(sql).toMatch(/employee_time_events[\s\S]*work_location public\.work_location not null/i);
    expect(sql).toMatch(/employee_time_events[\s\S]*work_category public\.work_category/i);
    const definition = functionDefinition("public.record_employee_time_event");
    expect(definition).toMatch(/pg_advisory_xact_lock[\s\S]*payroll-employee-state:/i);
    expect(definition).toMatch(/event_payload \? 'organization_id'/i);
    expect(definition).toMatch(/v_event_data \? 'organizationId'/i);
    expect(definition).toMatch(/actor and organization are derived from auth context/i);
    expect(definition).toMatch(/work category is only valid for work category changes/i);
    expect(definition).toMatch(/employment\.active_from <= \(\(v_event_at at time zone employment\.timezone\)::date\)/i);
    expect(definition).toMatch(
      /select max\(event_row\.event_at\)[\s\S]*from public\.employee_time_events event_row[\s\S]*event_row\.organization_id = v_actor_org[\s\S]*event_row\.employment_profile_id = v_employment\.id/i,
    );
    expect(definition).toMatch(/app\.payroll_event_is_locked\(v_actor_org, v_employment\.id, v_event_at\)/i);
    expect(definition).toMatch(/v_event_at <= v_latest_event_at/i);
    expect(definition.indexOf("return v_receipt.result_payload")).toBeLessThan(
      definition.indexOf("select max(event_row.event_at)"),
    );
  });

  it("anchors session attendance to the session organization", () => {
    expect(sql).toMatch(
      /alter table public\.sessions[\s\S]*unique\s*\(id,\s*organization_id\)/i,
    );
    expect(sql).toMatch(
      /foreign key \(session_id,\s*organization_id\)[\s\S]*references public\.sessions\(id,\s*organization_id\) on delete restrict/i,
    );
    expect(functionDefinition("public.record_session_attendance_event")).toMatch(
      /session_row\.therapist_id\s*=\s*employment\.therapist_id/i,
    );
  });

  it("requires authorized session attendance envelopes with isolated target state", () => {
    const definition = functionDefinition("public.record_session_attendance_event");
    expect(definition).toMatch(/event_payload jsonb,\s*idempotency_key text/i);
    expect(definition).toMatch(/event_payload \? 'organization_id'/i);
    expect(definition).toMatch(/v_event_data \? 'organizationId'/i);
    expect(definition).toMatch(/v_event_data ->> 'sessionId'/i);
    expect(definition).toMatch(/v_event_data ->> 'eventType'/i);
    expect(definition).toMatch(/event_payload ->> 'occurredAt'/i);
    expect(definition).toMatch(/event_payload ->> 'timezone'/i);
    expect(definition).toMatch(/event_payload ->> 'workLocation'/i);
    expect(definition).toMatch(
      /session_row\.id = v_session_id[\s\S]*session_row\.organization_id = v_actor_org[\s\S]*session_row\.therapist_id = employment\.therapist_id/i,
    );
    expect(definition).toMatch(/employment\.active_from <= \(\(v_event_at at time zone employment\.timezone\)::date\)/i);
    expect(definition).toMatch(/assignment_count[\s\S]*<> 1/i);
    expect(definition).toMatch(
      /v_employment\.user_id = v_actor[\s\S]*app\.payroll_actor_has_capability\(v_actor_org, 'time\.clock_self'\)/i,
    );
    expect(definition).toMatch(/app\.payroll_actor_has_capability\(v_actor_org, 'session_attendance\.record_assigned'\)/i);
    expect(definition).not.toMatch(/role_row\.name in \('admin', 'super_admin', 'admin_schedule'\)/i);
    expect(definition).toMatch(/session-attendance-state:/i);
    expect(definition).toMatch(
      /select max\(event_row\.event_at\)[\s\S]*from public\.session_attendance_events event_row[\s\S]*event_row\.employment_profile_id = v_employment\.id[\s\S]*event_row\.session_id = v_session_id/i,
    );
    expect(definition).toMatch(/v_event_at <= v_latest_event_at/i);
    expect(definition.indexOf("return v_receipt.result_payload")).toBeLessThan(
      definition.indexOf("select max(event_row.event_at)"),
    );
    expect(definition).toMatch(/duplicate session start/i);
    expect(definition).toMatch(/session end requires a started session/i);
    expect(definition).not.toMatch(/payroll-employee-state:/i);
    expect(definition).not.toMatch(/insert into public\.employee_time_events/i);
  });

  it("encodes the v1 fail-closed feature gate, one-active-org employment boundary, and therapist composite tenant link", () => {
    expect(sql).toMatch(/insert into public\.feature_flags[\s\S]+payroll_timekeeping_v1/i);
    expect(sql).toMatch(/default_enabled[\s\S]+false/i);
    expect(sql).toMatch(
      /insert into public\.payroll_policy_versions[\s\S]+activation_status[\s\S]+'inactive'/i,
    );
    expect(sql).toMatch(
      /exclude using gist[\s\S]+user_id with =[\s\S]+daterange\(active_from, coalesce\(active_through \+ 1/i,
    );
    expect(sql).toMatch(
      /alter table public\.therapists[\s\S]+add constraint[\s\S]+unique\s*\(id,\s*organization_id\)/i,
    );
    expect(sql).toMatch(
      /foreign key \(therapist_id,\s*organization_id\)[\s\S]+references public\.therapists\(id,\s*organization_id\) on delete restrict/i,
    );
  });

  it("keeps time corrections self-scoped, payload-only, and append-only", () => {
    const definition = functionDefinition("public.request_time_correction");
    expect(definition).toMatch(/correction_payload jsonb,\s*idempotency_key text/i);
    expect(definition).toMatch(/correction_payload \? 'organization_id'/i);
    expect(definition).toMatch(/correction_payload \? 'organizationId'/i);
    expect(definition).toMatch(/correction_payload \? 'actor_user_id'/i);
    expect(definition).toMatch(/correction_payload \? 'actorUserId'/i);
    expect(definition).toMatch(/app\.resolve_user_organization_id\(v_actor\)/i);
    expect(definition).toMatch(/time\.request_correction_self/i);
    expect(definition).toMatch(/app\.payroll_feature_enabled\(v_actor_org, v_employment\.home_jurisdiction, null\)/i);
    expect(definition).toMatch(/where employment\.id = v_original\.employment_profile_id/i);
    expect(definition).toMatch(/employment\.user_id = v_actor/i);
    expect(definition).toMatch(/original payroll event is out of scope/i);
    expect(definition).toMatch(/request_time_correction:/i);
    expect(definition).toMatch(/time-correction-request:/i);
    expect(definition).toMatch(/IDEMPOTENCY_CONFLICT/i);
    expect(definition).toMatch(/insert into public\.time_correction_requests/i);
    expect(definition).toMatch(/insert into public\.payroll_audit_events/i);
    expect(definition).toMatch(/insert into public\.payroll_mutation_receipts/i);
    expect(definition).not.toMatch(/current_user_can_manage_payroll_employee/i);
    expect(definition).not.toMatch(/no active payroll employment profile/i);
    expect(definition).not.toMatch(/app\.payroll_event_is_locked/i);
  });

  it("keeps attendance corrections self-scoped, payload-only, and domain-separated", () => {
    const definition = functionDefinition("public.request_session_attendance_correction");
    expect(definition).toMatch(/correction_payload jsonb,\s*idempotency_key text/i);
    expect(definition).toMatch(/correction_payload \? 'organization_id'/i);
    expect(definition).toMatch(/correction_payload \? 'organizationId'/i);
    expect(definition).toMatch(/correction_payload \? 'actor_user_id'/i);
    expect(definition).toMatch(/correction_payload \? 'actorUserId'/i);
    expect(definition).toMatch(/app\.resolve_user_organization_id\(v_actor\)/i);
    expect(definition).toMatch(/time\.request_correction_self/i);
    expect(definition).toMatch(/app\.payroll_feature_enabled\(v_actor_org, v_employment\.home_jurisdiction, null\)/i);
    expect(definition).toMatch(/where employment\.id = v_original\.employment_profile_id/i);
    expect(definition).toMatch(/employment\.user_id = v_actor/i);
    expect(definition).toMatch(/original attendance event is out of scope/i);
    expect(definition).toMatch(/request_session_attendance_correction:/i);
    expect(definition).toMatch(/attendance-correction-request:/i);
    expect(definition).toMatch(/IDEMPOTENCY_CONFLICT/i);
    expect(definition).toMatch(/insert into public\.session_attendance_correction_requests/i);
    expect(definition).toMatch(/insert into public\.payroll_audit_events/i);
    expect(definition).toMatch(/insert into public\.payroll_mutation_receipts/i);
    expect(definition).not.toMatch(/current_user_can_manage_payroll_employee/i);
    expect(definition).not.toMatch(/insert into public\.time_correction_requests/i);
    expect(definition).not.toMatch(/no active payroll employment profile/i);
    expect(definition).not.toMatch(/app\.payroll_event_is_locked/i);
  });
});
