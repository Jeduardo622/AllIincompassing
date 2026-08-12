import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationName =
  readdirSync(migrationsDir).find((name) => name.endsWith("payroll_administration.sql")) ?? "";
const migrationPath = migrationName ? path.join(migrationsDir, migrationName) : "";
const migrationExists = migrationName !== "" && existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

const functionDefinition = (qualifiedName: string): string =>
  sql.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0] ?? "";

describe("payroll administration migration contract", () => {
  it("creates the generated payroll administration migration file with the preserved governance header", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_administration/i);
    expect(sql).toMatch(/@migration-dependencies:\s*20260812141324_payroll_review_read_models\.sql/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("adds effective-dated payroll administration state without widening the source domain boundary", () => {
    expect(sql).toMatch(/alter table public\.payroll_organization_settings[\s\S]*add column if not exists effective_from date not null/i);
    expect(sql).toMatch(/alter table public\.payroll_organization_settings[\s\S]*add column if not exists effective_through date/i);
    expect(sql).toMatch(/alter table public\.pay_groups[\s\S]*add column if not exists effective_from date not null/i);
    expect(sql).toMatch(/alter table public\.pay_groups[\s\S]*add column if not exists effective_through date/i);
    expect(sql).toMatch(/create table(?: if not exists)? public\.pay_group_generation_versions/i);
    expect(sql).toMatch(/organization_id uuid not null/i);
    expect(sql).toMatch(/pay_group_id uuid not null/i);
    expect(sql).toMatch(/cadence public\.pay_group_cadence not null/i);
    expect(sql).toMatch(/starts_on date not null/i);
    expect(sql).toMatch(/timezone text not null/i);
    expect(sql).toMatch(/created_by uuid not null/i);
    expect(sql).toMatch(/check\s*\(\s*cadence in \('weekly', 'biweekly'\)\s*\)/i);
    expect(sql).toMatch(/effective_through is null or effective_through >= effective_from/i);
    expect(sql).toMatch(/exclude using gist[\s\S]*pay_group_generation_versions[\s\S]*organization_id with =[\s\S]*pay_group_id with =[\s\S]*daterange\(effective_from, coalesce\(effective_through \+ 1/i);
    expect(sql).toMatch(/alter table public\.pay_periods[\s\S]*exclude using gist[\s\S]*organization_id with =[\s\S]*pay_group_id with =[\s\S]*daterange\(starts_on, ends_on \+ 1, '\[\)'\) with &&/i);
  });

  it("defines deterministic containing-period helpers that fail closed for monthly cadence", () => {
    const definition = functionDefinition("app.payroll_containing_period");
    expect(definition).toMatch(/p_anchor_starts_on date/i);
    expect(definition).toMatch(/p_target_date date/i);
    expect(definition).toMatch(/p_cadence public\.pay_group_cadence/i);
    expect(definition).toMatch(/when p_cadence = 'weekly'/i);
    expect(definition).toMatch(/when p_cadence = 'biweekly'/i);
    expect(definition).toMatch(/floor\(\(\(p_target_date - p_anchor_starts_on\)::numeric\) \/ v_length_days::numeric\)/i);
    expect(definition).toMatch(/raise exception using errcode = '22023', message = 'monthly cadence is unsupported for payroll administration'/i);
  });

  it("adds authenticated-only payroll administration rpc surfaces with recursive authority rejection, org-derived scope, and idempotent receipts", () => {
    const executeDefinition = functionDefinition("public.execute_payroll_administration");
    const readDefinition = functionDefinition("public.get_payroll_administration");

    expect(sql).toMatch(/create or replace function public\.execute_payroll_administration\(\s*p_payload jsonb,\s*p_idempotency_key text\s*\)/i);
    expect(sql).toMatch(/create or replace function public\.get_payroll_administration\(\s*selected_local_date date\s*\)/i);
    expect(sql).toMatch(/revoke all on function public\.execute_payroll_administration\(jsonb, text\) from public,\s*anon,\s*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.execute_payroll_administration\(jsonb, text\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.execute_payroll_administration\(jsonb, text\) to authenticated,\s*service_role/i);
    expect(sql).toMatch(/revoke all on function public\.get_payroll_administration\(date\) from public,\s*anon,\s*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_payroll_administration\(date\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.get_payroll_administration\(date\) to authenticated,\s*service_role/i);

    expect(executeDefinition).toMatch(/security definer/i);
    expect(executeDefinition).toMatch(/set search_path = ''/i);
    expect(executeDefinition).toMatch(/auth\.uid\(\)/i);
    expect(executeDefinition).toMatch(/app\.resolve_user_organization_id/i);
    expect(executeDefinition).toMatch(/actor and organization are derived from auth context/i);
    expect(executeDefinition).toMatch(/app\.jsonb_contains_authority_fields\(p_payload\)/i);
    expect(sql).toMatch(/role_row\.name in \('admin', 'super_admin'\)/i);
    expect(executeDefinition).toMatch(/IDEMPOTENCY_CONFLICT/i);
    expect(executeDefinition).toMatch(/insert into public\.payroll_mutation_receipts/i);
    expect(executeDefinition).toMatch(/insert into public\.payroll_audit_events/i);
    expect(executeDefinition).toMatch(/unsupported payroll administration action/i);
    expect(executeDefinition).toMatch(/pg_catalog\.pg_advisory_xact_lock/i);
    expect(executeDefinition).toMatch(/payroll-administration:organization:/i);
    expect(executeDefinition).not.toMatch(
      /payroll-administration:'\s*\|\|\s*v_actor_org::text\s*\|\|\s*':'\s*\|\|\s*v_action/i,
    );

    for (const action of [
      "create_org_settings",
      "supersede_org_settings",
      "create_employment",
      "deactivate_employment",
      "add_rate_version",
      "create_manager_assignment",
      "deactivate_manager_assignment",
      "grant_capability",
      "revoke_capability",
      "create_pay_group",
      "deactivate_pay_group",
      "create_pay_group_assignment",
      "deactivate_pay_group_assignment",
      "set_generation_version",
      "generate_periods",
    ]) {
      expect(executeDefinition).toMatch(new RegExp(action, "i"));
    }

    expect(readDefinition).toMatch(/security definer/i);
    expect(readDefinition).toMatch(/set search_path = ''/i);
    expect(readDefinition).toMatch(/auth\.uid\(\)/i);
    expect(readDefinition).toMatch(/role_row\.name in \('admin', 'super_admin'\)/i);
    expect(readDefinition).toMatch(/'capabilities'/i);
    expect(readDefinition).toMatch(/'orgSettings'/i);
    expect(readDefinition).toMatch(/'policies'/i);
    expect(readDefinition).toMatch(/'employments'/i);
    expect(readDefinition).toMatch(/'payGroups'/i);
    expect(readDefinition).toMatch(/'generationVersions'/i);
    expect(readDefinition).toMatch(/'payPeriods'/i);
    expect(readDefinition).toMatch(/payroll\.view_compensation/i);
    expect(readDefinition).not.toMatch(/client_id/i);
    expect(readDefinition).not.toMatch(/session_id/i);
    expect(readDefinition).not.toMatch(/clinical/i);
  });

  it("keeps policy mutation read-only in v1 and preserves append-only administration semantics", () => {
    const executeDefinition = functionDefinition("public.execute_payroll_administration");
    expect(executeDefinition).toMatch(/policy mutation is read-only in v1/i);
    expect(sql).not.toMatch(/\bdelete\s+from\s+public\.(employment_profiles|employee_rate_versions|employee_manager_assignments|payroll_capability_grants|pay_groups|pay_group_assignments|pay_group_generation_versions|payroll_organization_settings|pay_periods)\b/i);
  });
});
