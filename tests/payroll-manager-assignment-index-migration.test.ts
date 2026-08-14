import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("payroll manager assignment lookup index migration", () => {
  const migrationsDir = join(process.cwd(), "supabase/migrations");
  const migrationFile = "20260814153000_payroll_manager_assignment_lookup_index.sql";
  const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
    fileName.endsWith("_payroll_manager_assignment_lookup_index.sql"),
  );
  const migrationSql = migrationFiles.includes(migrationFile)
    ? readFileSync(join(migrationsDir, migrationFile), "utf8")
    : "";
  const executableSql = migrationSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("adds exactly one governed WIN-219 follow-up migration", () => {
    expect(migrationFiles).toEqual([migrationFile]);
    expect(migrationSql).toMatch(/@migration-intent:\s*payroll_manager_assignment_lookup_index/i);
    expect(migrationSql).toMatch(/@migration-dependencies:\s*20260813103000_payroll_security_repair\.sql/i);
    expect(migrationSql).toMatch(/@migration-rollback:\s*drop index if exists public\.employee_manager_assignments_org_manager_employment_effective_idx/i);
  });

  it("creates the tenant-prefixed manager authority lookup index", () => {
    expect(migrationSql).toMatch(
      /create index if not exists employee_manager_assignments_org_manager_employment_effective_idx\s+on public\.employee_manager_assignments\s*\(\s*organization_id,\s*manager_user_id,\s*employment_profile_id,\s*effective_from desc\s*\)\s*include\s*\(\s*effective_through\s*\);/i,
    );
    expect(migrationSql.match(/\bcreate\s+(?:unique\s+)?index\b/gi)).toHaveLength(1);
  });

  it("stays additive and index-only", () => {
    expect(executableSql).not.toMatch(/\bcreate\s+unique\s+index\b/i);
    expect(executableSql).not.toMatch(/\bcreate\s+index\s+concurrently\b/i);
    expect(executableSql).not.toMatch(/\b(create|alter|drop)\s+(table|policy|function|trigger|type)\b/i);
    expect(executableSql).not.toMatch(/\b(grant|revoke|insert|update|delete)\b/i);
  });
});
