import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationName = "20260812141324_payroll_review_read_models.sql";
const migrationPath = path.join(process.cwd(), "supabase", "migrations", migrationName);
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

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
    expect(sql).toMatch(/app\.current_user_can_read_payroll_employee\(employment\.organization_id,\s*employment\.id\)/i);
    expect(sql).toMatch(/time\.review_assigned|time\.approve_assigned/i);
    expect(sql).toMatch(/time\.review_assigned|time\.approve_assigned/i);
    expect(sql).toMatch(/payroll\.lock_period|payroll\.reopen_period|payroll\.resolve_exceptions|payroll\.view_compensation/i);
    expect(sql).toMatch(/'unresolvedBlockerCount'/i);
    expect(sql).toMatch(/'classifiedSeconds'/i);
    expect(sql).toMatch(/'snapshot'[\s\S]*'id'[\s\S]*'hash'/i);
    expect(sql).not.toMatch(/session_id/i);
    expect(sql).not.toMatch(/client_id/i);
    expect(sql).not.toMatch(/diagnosis/i);
    expect(sql).not.toMatch(/authorization/i);
    expect(sql).not.toMatch(/canonical_payload/i);
    expect(sql).not.toMatch(/timesheet_snapshot_lines[\s\S]*get_payroll_review_queue/i);
  });

  it("gates compensation and canonical snapshot detail leakage in manager and admin review payloads", () => {
    expect(sql).toMatch(/payroll\.view_compensation/i);
    expect(sql).toMatch(/'compensation'/i);
    expect(sql).not.toMatch(/hourly_rate_cents[\s\S]*get_payroll_review_queue/i);
    expect(sql).not.toMatch(/hourly_rate_cents[\s\S]*get_payroll_review_details/i);
    expect(sql).not.toMatch(/canonical_payload[\s\S]*get_payroll_review_details/i);
    expect(sql).not.toMatch(/timesheet_snapshot_lines[\s\S]*canonical/i);
    expect(sql).toMatch(/'approvalHistory'/i);
    expect(sql).toMatch(/'blockers'/i);
    expect(sql).toMatch(/'classifiedSeconds'/i);
    expect(sql).toMatch(/'punches'/i);
  });
});
