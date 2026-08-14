import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationName =
  readdirSync(migrationsDir).find((name) => name.endsWith("payroll_security_repair.sql")) ?? "";
const migrationPath = migrationName ? path.join(migrationsDir, migrationName) : "";
const migrationExists = migrationName !== "" && existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

describe("payroll security repair migration contract", () => {
  it("creates a governed append-only repair migration for WIN-219", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_security_repair/i);
    expect(sql).toMatch(/@migration-dependencies:\s*20260812230837_payroll_export_ledger\.sql/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("adds payroll.configure_settings and rebinds generate_periods authority to that least-privilege capability", () => {
    expect(sql).toMatch(/alter type public\.payroll_capability add value if not exists 'payroll\.configure_settings'/i);
    expect(sql).toMatch(/pg_get_functiondef\('app\.payroll_actor_has_capability\(uuid,\s*text\)'::regprocedure\)/i);
    expect(sql).toMatch(/payroll\.configure_settings allowlist repair target was not found/i);
    expect(sql).toMatch(/pg_get_functiondef\('public\.get_payroll_administration_without_export_capability\(date\)'::regprocedure\)/i);
    expect(sql).toMatch(/v_can_configure_settings boolean := false/i);
    expect(sql).toMatch(/v_can_configure_settings := app\.payroll_actor_has_capability\(v_actor_org,\s*'payroll\.configure_settings'\)/i);
    expect(sql).toMatch(/\{capabilities,canGeneratePeriods\}/i);
    expect(sql).toMatch(/to_jsonb\(v_can_configure_settings\)/i);
    expect(sql).toMatch(/pg_get_functiondef\('public\.execute_payroll_administration\(jsonb,\s*text\)'::regprocedure\)/i);
    expect(sql).toMatch(/when ''generate_periods'' then ''payroll\.configure_settings''/i);
    expect(sql).toMatch(/generate periods capability repair target was not found/i);
  });

  it("binds payroll export organization settings to the row effective for the exported pay period and serializes same-key export replay", () => {
    expect(sql).toMatch(/pg_get_functiondef\('public\.create_payroll_export\(jsonb,\s*text\)'::regprocedure\)/i);
    expect(sql).toMatch(/create_payroll_export idempotency lock target was not found/i);
    expect(sql).toMatch(/create_payroll_export settings join repair target was not found/i);
    expect(sql).toMatch(/create_payroll_export settings ordering repair target was not found/i);
    expect(sql).toMatch(/create_payroll_export settings presence repair target was not found/i);
    expect(sql).toMatch(/:create_payroll_export:/i);
    expect(sql).toMatch(/settings\.effective_from <= pay_period\.starts_on/i);
    expect(sql).toMatch(/settings\.effective_through is null or settings\.effective_through >= pay_period\.ends_on/i);
    expect(sql).toMatch(/order by settings\.effective_from desc,\s*settings\.created_at desc,\s*settings\.id desc/i);
    expect(sql).toMatch(/payroll export settings effective for the pay period are required/i);
    expect(sql).toMatch(/when latest_run\.id is null or not v_can_export_period then 'null'::jsonb/i);
  });
});
