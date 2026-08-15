import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_manager_assignment_advisor_remediation.sql"),
);
const migrationSql = migrationFiles[0]
  ? readFileSync(join(migrationsDir, migrationFiles[0]), "utf8")
  : "";
const executableSql = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const foundationSql = readFileSync(
  join(migrationsDir, "20260811190901_payroll_timekeeping_foundation.sql"),
  "utf8",
);

describe("payroll manager assignment advisor remediation migration", () => {
  it("adds exactly one forward-only WIN-219 remediation migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-intent:\s*payroll_manager_assignment_advisor_remediation/i,
    );
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260814153000_payroll_manager_assignment_lookup_index\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*drop index if exists public\.employee_manager_assignments_employment_profile_org_idx;\s*drop index if exists public\.employee_manager_assignments_manager_user_id_idx;\s*alter policy employee_manager_assignments_authenticated_select on public\.employee_manager_assignments using/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("adds only the two missing FK-leading btree indexes", () => {
    expect(migrationSql).toMatch(
      /create index if not exists employee_manager_assignments_employment_profile_org_idx\s+on public\.employee_manager_assignments\s+using btree\s*\(\s*employment_profile_id,\s*organization_id\s*\);/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists employee_manager_assignments_manager_user_id_idx\s+on public\.employee_manager_assignments\s+using btree\s*\(\s*manager_user_id\s*\);/i,
    );
    expect(migrationSql.match(/\bcreate\s+(?:unique\s+)?index\b/gi)).toHaveLength(2);
    expect(migrationSql).not.toMatch(
      /create index[^;]+\(\s*organization_id,\s*manager_user_id,\s*employment_profile_id/i,
    );

    const indexNames = [
      ...migrationSql.matchAll(/create index if not exists\s+([a-z0-9_]+)/gi),
    ].map((match) => match[1]);
    expect(indexNames).toHaveLength(2);
    expect(indexNames.every((name) => name.length <= 63)).toBe(true);
  });

  it("changes only the manager auth call evaluation strategy in the existing policy", () => {
    expect(foundationSql).toMatch(/manager_user_id\s*=\s*auth\.uid\(\)/i);
    expect(migrationSql).toMatch(
      /alter policy employee_manager_assignments_authenticated_select\s+on public\.employee_manager_assignments\s+using\s*\(\s*\(\s*app\.payroll_actor_in_organization\(organization_id\)\s+and manager_user_id\s*=\s*\(\s*select auth\.uid\(\)\s*\)\s+and\s*\(\s*app\.payroll_actor_has_capability\(organization_id,\s*'time\.review_assigned'\)\s+or app\.payroll_actor_has_capability\(organization_id,\s*'time\.approve_assigned'\)\s*\)\s*\)\s+or app\.payroll_actor_has_capability\(organization_id,\s*'payroll\.configure_employment'\)\s*\);/i,
    );
    expect(executableSql.match(/\balter\s+policy\b/gi)).toHaveLength(1);
    expect(executableSql).not.toMatch(/manager_user_id\s*=\s*auth\.uid\(\)/i);
    expect(executableSql).not.toMatch(/\b(create|drop)\s+policy\b/i);
  });

  it("preserves RLS, ACLs, and the single authenticated SELECT policy metadata", () => {
    expect(foundationSql).toMatch(
      /alter table public\.employee_manager_assignments enable row level security;/i,
    );
    expect(foundationSql).toMatch(
      /alter table public\.employee_manager_assignments force row level security;/i,
    );
    expect(foundationSql).toMatch(
      /create policy employee_manager_assignments_authenticated_select\s+on public\.employee_manager_assignments\s+for select\s+to authenticated/i,
    );
    expect(foundationSql).toMatch(
      /grant select on public\.employee_manager_assignments to authenticated;/i,
    );
    expect(executableSql).not.toMatch(/\b(grant|revoke)\b/i);
    expect(executableSql).not.toMatch(/\balter\s+table\b/i);
  });

  it("introduces no data, function, trigger, capability, or activation change", () => {
    expect(executableSql).not.toMatch(/\bcreate\s+unique\s+index\b/i);
    expect(executableSql).not.toMatch(/\bcreate\s+index\s+concurrently\b/i);
    expect(executableSql).not.toMatch(
      /\b(create|alter|drop)\s+(table|function|trigger|type)\b/i,
    );
    expect(executableSql).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(executableSql).not.toMatch(
      /feature_flags|payroll_capability_grants|default_enabled|activation_status/i,
    );
  });
});
