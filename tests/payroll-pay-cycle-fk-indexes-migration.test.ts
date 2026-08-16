import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_pay_cycle_fk_indexes.sql"),
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
const snapshotsSql = readFileSync(
  join(migrationsDir, "20260812060529_payroll_timesheet_snapshots.sql"),
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

describe("payroll pay-cycle FK index migration", () => {
  it("adds exactly one forward-only WIN-219 remediation migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-intent:\s*payroll_pay_cycle_fk_indexes/i,
    );
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260816033808_payroll_employee_rate_versions_fk_indexes\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*drop index if exists public\.pay_groups_created_by_idx;\s*drop index if exists public\.pay_group_assignments_employment_profile_org_idx;\s*drop index if exists public\.pay_group_assignments_pay_group_org_idx;\s*drop index if exists public\.pay_group_generation_versions_created_by_idx;\s*drop index if exists public\.pay_group_generation_versions_pay_group_org_idx;\s*drop index if exists public\.pay_periods_pay_group_org_idx;/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("covers exactly the six advisor-reported FK column sequences", () => {
    expect(administrationSql).toMatch(
      /alter table public\.pay_groups[\s\S]*?add column if not exists created_by uuid references auth\.users\(id\) on delete restrict/i,
    );
    expect(foundationSql).toMatch(
      /create table if not exists public\.pay_group_assignments[\s\S]*?foreign key\s*\(\s*employment_profile_id,\s*organization_id\s*\)[\s\S]*?references public\.employment_profiles\(id, organization_id\)/i,
    );
    expect(foundationSql).toMatch(
      /create table if not exists public\.pay_group_assignments[\s\S]*?foreign key\s*\(\s*pay_group_id,\s*organization_id\s*\)[\s\S]*?references public\.pay_groups\(id, organization_id\)/i,
    );
    expect(administrationSql).toMatch(
      /create table if not exists public\.pay_group_generation_versions[\s\S]*?created_by uuid not null references auth\.users\(id\) on delete restrict/i,
    );
    expect(administrationSql).toMatch(
      /create table if not exists public\.pay_group_generation_versions[\s\S]*?foreign key\s*\(\s*pay_group_id,\s*organization_id\s*\)[\s\S]*?references public\.pay_groups\(id, organization_id\)/i,
    );
    expect(foundationSql).toMatch(
      /create table if not exists public\.pay_periods[\s\S]*?foreign key\s*\(\s*pay_group_id,\s*organization_id\s*\)[\s\S]*?references public\.pay_groups\(id, organization_id\)/i,
    );

    const expectedIndexes = [
      ["pay_groups_created_by_idx", "pay_groups", "created_by"],
      [
        "pay_group_assignments_employment_profile_org_idx",
        "pay_group_assignments",
        "employment_profile_id,\\s*organization_id",
      ],
      [
        "pay_group_assignments_pay_group_org_idx",
        "pay_group_assignments",
        "pay_group_id,\\s*organization_id",
      ],
      [
        "pay_group_generation_versions_created_by_idx",
        "pay_group_generation_versions",
        "created_by",
      ],
      [
        "pay_group_generation_versions_pay_group_org_idx",
        "pay_group_generation_versions",
        "pay_group_id,\\s*organization_id",
      ],
      ["pay_periods_pay_group_org_idx", "pay_periods", "pay_group_id,\\s*organization_id"],
    ] as const;

    for (const [indexName, tableName, columns] of expectedIndexes) {
      expect(migrationSql).toMatch(
        new RegExp(
          `create index if not exists ${indexName}\\s+on public\\.${tableName}\\s+using btree\\s*\\(\\s*${columns}\\s*\\);`,
          "i",
        ),
      );
    }

    const createIndexMatches = executableSql.match(
      /\bcreate\s+(?:unique\s+)?index\b/gi,
    );
    expect(createIndexMatches).toHaveLength(6);
    expect(executableSql).not.toMatch(/\bcreate\s+unique\s+index\b/i);
    expect(executableSql).not.toMatch(/\bcreate\s+index\s+concurrently\b/i);

    const indexNames = [
      ...migrationSql.matchAll(/create index if not exists\s+([a-z0-9_]+)/gi),
    ].map(([, name]) => name);
    expect(new Set(indexNames).size).toBe(6);
    expect(indexNames.every((name) => name.length <= 63)).toBe(true);
  });

  it("does not duplicate the existing organization-first lookup indexes", () => {
    expect(snapshotsSql).toMatch(
      /create index if not exists pay_group_assignments_org_employment_effective_idx[\s\S]*?\(organization_id, employment_profile_id, effective_from, effective_through\)/i,
    );
    expect(administrationSql).toMatch(
      /create index if not exists pay_groups_active_idx[\s\S]*?\(organization_id, effective_from desc, effective_through\)/i,
    );
    expect(administrationSql).toMatch(
      /create index if not exists pay_group_generation_versions_active_idx[\s\S]*?\(organization_id, pay_group_id, effective_from desc, effective_through\)/i,
    );
    expect(executableSql).not.toMatch(
      /create index[^;]+\(\s*organization_id,\s*(?:employment_profile_id|pay_group_id|effective_from)/i,
    );
  });

  it("preserves pay-cycle capability, RLS, and ACL semantics", () => {
    for (const tableName of ["pay_groups", "pay_group_assignments", "pay_periods"]) {
      expect(foundationSql).toMatch(
        new RegExp(`alter table public\\.${tableName} enable row level security;`, "i"),
      );
      expect(foundationSql).toMatch(
        new RegExp(`alter table public\\.${tableName} force row level security;`, "i"),
      );
      expect(foundationSql).toMatch(
        new RegExp(`grant select on public\\.${tableName} to authenticated;`, "i"),
      );
    }
    expect(administrationSql).toMatch(
      /alter table public\.pay_group_generation_versions enable row level security;/i,
    );
    expect(administrationSql).toMatch(
      /alter table public\.pay_group_generation_versions force row level security;/i,
    );
    expect(administrationSql).toMatch(
      /grant select on public\.pay_group_generation_versions to authenticated;/i,
    );
    expect(foundationSql).toMatch(
      /create policy pay_group_assignments_authenticated_select[\s\S]*?app\.current_user_can_read_payroll_employee\(organization_id, employment_profile_id\)/i,
    );
    expect(foundationSql).toMatch(
      /create policy pay_groups_authenticated_select[\s\S]*?payroll\.configure_employment[\s\S]*?payroll\.export_period/i,
    );
    expect(foundationSql).toMatch(
      /create policy pay_periods_authenticated_select[\s\S]*?payroll\.lock_period[\s\S]*?payroll\.reopen_period[\s\S]*?payroll\.export_period/i,
    );
    expect(administrationSql).toMatch(
      /create policy pay_group_generation_versions_authenticated_select[\s\S]*?app\.current_user_is_payroll_admin\(organization_id\)[\s\S]*?payroll\.configure_employment[\s\S]*?payroll\.export_period/i,
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
    const parityEntry = `${version}|payroll_pay_cycle_fk_indexes`;

    expect(version).toMatch(/^\d{14}$/);
    for (const relativePath of parityFiles) {
      expect(
        readFileSync(join(repoRoot, relativePath), "utf8"),
        `${relativePath} must include ${parityEntry}`,
      ).toContain(parityEntry);
    }
  });
});
