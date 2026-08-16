import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_employee_rate_versions_fk_indexes.sql"),
);
const migrationFile = migrationFiles[0] ?? "";
const migrationSql = migrationFile
  ? readFileSync(join(migrationsDir, migrationFile), "utf8")
  : "";
const executableSql = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const foundationSql = readFileSync(
  join(migrationsDir, "20260811190901_payroll_timekeeping_foundation.sql"),
  "utf8",
);
const administrationSql = readFileSync(
  join(migrationsDir, "20260812153628_payroll_administration.sql"),
  "utf8",
);

const parityFiles = [
  "scripts/ci/check-runtime-migration-parity.mjs",
  "scripts/ci/check-session-deploy-safety.mjs",
  "tests/ci/check-runtime-migration-parity.test.ts",
  "tests/ci/check-session-deploy-safety.test.ts",
  ".github/workflows/ci.yml",
];

describe("payroll employee rate versions FK index migration", () => {
  it("adds exactly one forward-only WIN-219 remediation migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-intent:\s*payroll_employee_rate_versions_fk_indexes/i,
    );
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260816014726_payroll_employee_time_events_fk_indexes\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*drop index if exists public\.employee_rate_versions_created_by_idx;\s*drop index if exists public\.employee_rate_versions_employment_profile_org_idx;/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("covers exactly the two advisor-reported FK column sequences", () => {
    expect(foundationSql).toMatch(
      /create table if not exists public\.employee_rate_versions[\s\S]*?created_by uuid not null references auth\.users\(id\) on delete restrict/i,
    );
    expect(foundationSql).toMatch(
      /foreign key\s*\(\s*employment_profile_id,\s*organization_id\s*\)[\s\S]*?references public\.employment_profiles\(id, organization_id\)/i,
    );
    expect(administrationSql).toMatch(
      /create index if not exists employee_rate_versions_history_lookup_idx[\s\S]*?\(\s*organization_id,\s*employment_profile_id,\s*effective_from desc,\s*created_at desc,\s*id desc\s*\)/i,
    );

    expect(migrationSql).toMatch(
      /create index if not exists employee_rate_versions_created_by_idx\s+on public\.employee_rate_versions\s+using btree\s*\(\s*created_by\s*\);/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists employee_rate_versions_employment_profile_org_idx\s+on public\.employee_rate_versions\s+using btree\s*\(\s*employment_profile_id,\s*organization_id\s*\);/i,
    );

    const createIndexMatches = executableSql.match(
      /\bcreate\s+(?:unique\s+)?index\b/gi,
    );
    expect(createIndexMatches).toHaveLength(2);
    expect(executableSql).not.toMatch(/\bcreate\s+unique\s+index\b/i);
    expect(executableSql).not.toMatch(/\bcreate\s+index\s+concurrently\b/i);
    expect(executableSql).not.toMatch(
      /create index[^;]+\(\s*organization_id,\s*employment_profile_id/i,
    );

    const indexNames = [
      ...migrationSql.matchAll(/create index if not exists\s+([a-z0-9_]+)/gi),
    ].map(([, name]) => name);
    expect(new Set(indexNames).size).toBe(2);
    expect(indexNames.every((name) => name.length <= 63)).toBe(true);
  });

  it("preserves compensation capability, RLS, and ACL semantics", () => {
    expect(foundationSql).toMatch(
      /create policy employee_rate_versions_authenticated_select[\s\S]*?using \(\s*app\.payroll_actor_has_capability\(organization_id, 'payroll\.view_compensation'\)\s*\);/i,
    );
    expect(foundationSql).toMatch(
      /alter table public\.employee_rate_versions enable row level security;/i,
    );
    expect(foundationSql).toMatch(
      /alter table public\.employee_rate_versions force row level security;/i,
    );
    expect(foundationSql).toMatch(
      /grant select on public\.employee_rate_versions to authenticated;/i,
    );
    expect(executableSql).not.toMatch(/\balter\s+policy\b/i);
    expect(executableSql).not.toMatch(/\b(create|drop)\s+policy\b/i);
    expect(executableSql).not.toMatch(/\b(grant|revoke)\b/i);
    expect(executableSql).not.toMatch(/\balter\s+table\b/i);
  });

  it("introduces no data, function, trigger, capability, or activation change", () => {
    expect(executableSql).not.toMatch(
      /\b(create|alter|drop)\s+(table|function|trigger|type)\b/i,
    );
    expect(executableSql).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(executableSql).not.toMatch(
      /feature_flags|payroll_capability_grants|default_enabled|activation_status/i,
    );
  });

  it("adds the migration to every explicit WIN-219 runtime parity mirror", () => {
    const version = migrationFile.split("_")[0] ?? "";
    const parityEntry = `${version}|payroll_employee_rate_versions_fk_indexes`;

    expect(version).toMatch(/^\d{14}$/);
    for (const relativePath of parityFiles) {
      expect(
        readFileSync(join(repoRoot, relativePath), "utf8"),
        `${relativePath} must include ${parityEntry}`,
      ).toContain(parityEntry);
    }
  });
});
