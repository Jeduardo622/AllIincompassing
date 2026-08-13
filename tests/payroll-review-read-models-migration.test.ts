import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationName = "20260812141324_payroll_review_read_models.sql";
const migrationPath = path.join(process.cwd(), "supabase", "migrations", migrationName);
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";
const functionDefinition = (name: string) =>
  sql.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}[\\s\\S]*?\\n\\$\\$;`, "i"))?.[0] ?? "";

describe("payroll review read models migration contract", () => {
  it("creates the generated migration file with the preserved governance header", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_review_read_models/i);
    expect(sql).toMatch(/@migration-dependencies:\s*20260812122436_payroll_approval_workflow\.sql/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("adds authenticated-only self, queue, and review-detail read rpc surfaces", () => {
    expect(sql).toMatch(/create or replace function public\.get_payroll_self_approval\(\s*selected_local_date date\s*\)/i);
    expect(sql).toMatch(/create or replace function public\.get_payroll_review_queue\(\s*selected_local_date date\s*\)/i);
    expect(sql).toMatch(/create or replace function public\.get_payroll_review_details\(\s*snapshot_id uuid,\s*snapshot_hash text\s*\)/i);
    expect(sql).toMatch(/revoke all on function public\.get_payroll_self_approval\(date\) from public,\s*anon,\s*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_payroll_self_approval\(date\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.get_payroll_self_approval\(date\) to authenticated,\s*service_role/i);
    expect(sql).toMatch(/revoke all on function public\.get_payroll_review_queue\(date\) from public,\s*anon,\s*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_payroll_review_queue\(date\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.get_payroll_review_queue\(date\) to authenticated,\s*service_role/i);
    expect(sql).toMatch(/revoke all on function public\.get_payroll_review_details\(uuid,\s*text\) from public,\s*anon,\s*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_payroll_review_details\(uuid,\s*text\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.get_payroll_review_details\(uuid,\s*text\) to authenticated,\s*service_role/i);
  });

  it("keeps self approval sanitized while preserving self-only gross earnings and atomic snapshot binding", () => {
    expect(sql).toMatch(/'currentState'/i);
    expect(sql).toMatch(/'submittedAt'/i);
    expect(sql).toMatch(/'returnedComment'/i);
    expect(sql).toMatch(/'unresolvedBlockerCount'/i);
    expect(sql).toMatch(/'snapshot'[\s\S]*'id'[\s\S]*'hash'[\s\S]*'isCurrent'/i);
    expect(sql).toMatch(/'actions'[\s\S]*'canSubmit'/i);
    expect(sql).toMatch(/app\.timesheet_snapshot_is_current\(/i);
    expect(sql).toMatch(/gross_earnings_cents/i);
    expect(sql).not.toMatch(/hourly_rate_cents[\s\S]*get_payroll_self_approval/i);
  });

  it("binds manager review queue visibility to exact current assignment or explicit admin grant and strips non-payroll fields", () => {
    const queue = functionDefinition("public.get_payroll_review_queue");
    expect(queue).toMatch(/app\.current_user_can_read_payroll_employee\(employment\.organization_id,\s*employment\.id\)/i);
    expect(queue).toMatch(/time\.review_assigned/i);
    expect(queue).toMatch(/time\.approve_assigned/i);
    expect(queue).toMatch(/payroll\.configure_employment/i);
    expect(queue).toMatch(/payroll\.resolve_exceptions/i);
    expect(queue).toMatch(/payroll\.lock_period/i);
    expect(queue).toMatch(/payroll\.reopen_period/i);
    expect(queue).toMatch(/payroll\.export_period/i);
    expect(queue).toMatch(/payroll\.view_compensation/i);
    expect(queue).toMatch(/app\.payroll_feature_enabled\(/i);
    expect(queue).toMatch(/payroll_policy_versions/i);
    expect(queue).toMatch(/'classifiedSeconds'/i);
    expect(queue).toMatch(/'snapshot'[\s\S]*'id'[\s\S]*'hash'/i);
    expect(queue).not.toMatch(/session_id/i);
    expect(queue).not.toMatch(/client_id/i);
    expect(queue).not.toMatch(/diagnosis/i);
    expect(queue).not.toMatch(/authorization/i);
  });

  it("reconstructs sanitized details from the immutable canonical snapshot and gates sensitive disclosures", () => {
    const queue = functionDefinition("public.get_payroll_review_queue");
    const details = functionDefinition("public.get_payroll_review_details");
    expect(queue).toMatch(/app\.payroll_actor_has_capability\(v_actor_org,\s*'payroll\.view_compensation'\)/i);
    expect(details).toMatch(/app\.payroll_actor_has_capability\(v_actor_org,\s*'payroll\.view_compensation'\)/i);
    expect(details).toMatch(/v_snapshot\.canonical_payload\s*->\s*'period'/i);
    expect(details).toMatch(/app\.current_user_can_manage_payroll_employee\(/i);
    expect(details).not.toMatch(/from public\.employee_time_events/i);
    expect(details).not.toMatch(/from public\.session_attendance_events/i);
    expect(details).not.toMatch(/from public\.time_correction_requests/i);
    expect(details).not.toMatch(/from public\.session_attendance_correction_requests/i);
    expect(details).not.toMatch(/from public\.timekeeping_exceptions/i);
    expect(details).not.toMatch(/hourly_rate_cents/i);
    expect(details).not.toMatch(/'canonicalPayload'/i);
    expect(details).toMatch(/'approvalHistory'/i);
    expect(details).toMatch(/'blockers'/i);
    expect(details).toMatch(/'classifiedSeconds'/i);
    expect(details).toMatch(/'punches'/i);
  });
});
