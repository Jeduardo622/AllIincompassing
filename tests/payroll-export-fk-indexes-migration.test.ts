import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_export_fk_indexes.sql"),
);
const migrationFile = migrationFiles[0] ?? "";
const migrationSql = migrationFile
  ? readFileSync(join(migrationsDir, migrationFile), "utf8")
  : "";
const executableSql = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const exportLedgerSql = readFileSync(
  join(migrationsDir, "20260812230837_payroll_export_ledger.sql"),
  "utf8",
);

const parityFiles = [
  "scripts/ci/check-runtime-migration-parity.mjs",
  "scripts/ci/check-session-deploy-safety.mjs",
  "tests/ci/check-runtime-migration-parity.test.ts",
  "tests/ci/check-session-deploy-safety.test.ts",
  ".github/workflows/ci.yml",
];

describe("payroll export FK index migration", () => {
  it("adds exactly one forward-only WIN-219 remediation migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(/@migration-intent:\s*payroll_export_fk_indexes/i);
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260816153226_payroll_admin_helper_authenticated_execute\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*drop index if exists public\.payroll_export_runs_actor_user_idx;\s*drop index if exists public\.payroll_export_runs_adjusts_export_run_org_idx;\s*drop index if exists public\.payroll_export_runs_pay_group_org_idx;\s*drop index if exists public\.payroll_export_runs_pay_period_org_idx;\s*drop index if exists public\.payroll_export_rows_adjusts_export_run_org_idx;\s*drop index if exists public\.payroll_export_rows_employment_profile_org_idx;\s*drop index if exists public\.payroll_export_rows_export_run_org_idx;\s*drop index if exists public\.payroll_export_rows_pay_group_org_idx;\s*drop index if exists public\.payroll_export_rows_pay_period_org_idx;\s*drop index if exists public\.payroll_export_rows_snapshot_org_employment_period_idx;/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("covers exactly the ten advisor-reported FK column sequences", () => {
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_runs[\s\S]*?actor_user_id uuid not null references auth\.users\(id\) on delete restrict/i,
    );
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_runs[\s\S]*?foreign key\s*\(\s*adjusts_export_run_id,\s*organization_id\s*\)[\s\S]*?references public\.payroll_export_runs\(id, organization_id\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_runs[\s\S]*?foreign key\s*\(\s*pay_group_id,\s*organization_id\s*\)[\s\S]*?references public\.pay_groups\(id, organization_id\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_runs[\s\S]*?foreign key\s*\(\s*pay_period_id,\s*organization_id\s*\)[\s\S]*?references public\.pay_periods\(id, organization_id\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_rows[\s\S]*?foreign key\s*\(\s*adjusts_export_run_id,\s*organization_id\s*\)[\s\S]*?references public\.payroll_export_runs\(id, organization_id\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_rows[\s\S]*?foreign key\s*\(\s*employment_profile_id,\s*organization_id\s*\)[\s\S]*?references public\.employment_profiles\(id, organization_id\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_rows[\s\S]*?foreign key\s*\(\s*export_run_id,\s*organization_id\s*\)[\s\S]*?references public\.payroll_export_runs\(id, organization_id\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_rows[\s\S]*?foreign key\s*\(\s*pay_group_id,\s*organization_id\s*\)[\s\S]*?references public\.pay_groups\(id, organization_id\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create table if not exists public\.payroll_export_rows[\s\S]*?foreign key\s*\(\s*pay_period_id,\s*organization_id\s*\)[\s\S]*?references public\.pay_periods\(id, organization_id\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /foreign key\s*\(\s*snapshot_id,\s*organization_id,\s*employment_profile_id,\s*pay_period_id\s*\)[\s\S]*?references public\.timesheet_snapshots\(id, organization_id, employment_profile_id, pay_period_id\)/i,
    );

    const expectedIndexes = [
      ["payroll_export_runs_actor_user_idx", "payroll_export_runs", "actor_user_id"],
      [
        "payroll_export_runs_adjusts_export_run_org_idx",
        "payroll_export_runs",
        "adjusts_export_run_id,\\s*organization_id",
      ],
      [
        "payroll_export_runs_pay_group_org_idx",
        "payroll_export_runs",
        "pay_group_id,\\s*organization_id",
      ],
      [
        "payroll_export_runs_pay_period_org_idx",
        "payroll_export_runs",
        "pay_period_id,\\s*organization_id",
      ],
      [
        "payroll_export_rows_adjusts_export_run_org_idx",
        "payroll_export_rows",
        "adjusts_export_run_id,\\s*organization_id",
      ],
      [
        "payroll_export_rows_employment_profile_org_idx",
        "payroll_export_rows",
        "employment_profile_id,\\s*organization_id",
      ],
      [
        "payroll_export_rows_export_run_org_idx",
        "payroll_export_rows",
        "export_run_id,\\s*organization_id",
      ],
      [
        "payroll_export_rows_pay_group_org_idx",
        "payroll_export_rows",
        "pay_group_id,\\s*organization_id",
      ],
      [
        "payroll_export_rows_pay_period_org_idx",
        "payroll_export_rows",
        "pay_period_id,\\s*organization_id",
      ],
      [
        "payroll_export_rows_snapshot_org_employment_period_idx",
        "payroll_export_rows",
        "snapshot_id,\\s*organization_id,\\s*employment_profile_id,\\s*pay_period_id",
      ],
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
    expect(createIndexMatches).toHaveLength(10);
    expect(executableSql).not.toMatch(/\bcreate\s+unique\s+index\b/i);
    expect(executableSql).not.toMatch(/\bcreate\s+index\s+concurrently\b/i);

    const indexNames = [
      ...migrationSql.matchAll(/create index if not exists\s+([a-z0-9_]+)/gi),
    ].map(([, name]) => name);
    expect(new Set(indexNames).size).toBe(10);
    expect(indexNames.every((name) => name.length <= 63)).toBe(true);
  });

  it("does not duplicate the existing organization-first export indexes", () => {
    expect(exportLedgerSql).toMatch(
      /create index if not exists payroll_export_runs_period_exported_idx[\s\S]*?\(\s*organization_id,\s*pay_period_id,\s*exported_at desc,\s*id desc\s*\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create index if not exists payroll_export_rows_run_position_idx[\s\S]*?\(\s*organization_id,\s*export_run_id,\s*export_position\s*\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create index if not exists payroll_export_rows_rebuild_idx[\s\S]*?\(\s*organization_id,\s*pay_period_id,\s*employee_payroll_id,\s*work_date,\s*earning_code,\s*export_run_id,\s*export_position\s*\)/i,
    );
    expect(executableSql).not.toMatch(
      /create index[^;]+\(\s*organization_id,\s*(?:pay_period_id|export_run_id|employee_payroll_id)/i,
    );
  });

  it("preserves export capability, RLS, and ACL semantics", () => {
    for (const tableName of ["payroll_export_runs", "payroll_export_rows"]) {
      expect(exportLedgerSql).toMatch(
        new RegExp(`alter table public\\.${tableName} enable row level security;`, "i"),
      );
      expect(exportLedgerSql).toMatch(
        new RegExp(`alter table public\\.${tableName} force row level security;`, "i"),
      );
      expect(exportLedgerSql).toMatch(
        new RegExp(`grant select on public\\.${tableName} to authenticated;`, "i"),
      );
    }
    expect(exportLedgerSql).toMatch(
      /create policy payroll_export_runs_authenticated_select[\s\S]*?app\.current_user_is_payroll_admin\(organization_id\)[\s\S]*?app\.payroll_actor_has_capability\(organization_id, 'payroll\.export_period'\)/i,
    );
    expect(exportLedgerSql).toMatch(
      /create policy payroll_export_rows_authenticated_select[\s\S]*?app\.current_user_is_payroll_admin\(organization_id\)[\s\S]*?app\.payroll_actor_has_capability\(organization_id, 'payroll\.export_period'\)/i,
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
    const parityEntry = `${version}|payroll_export_fk_indexes`;

    expect(version).toMatch(/^\d{14}$/);
    for (const relativePath of parityFiles) {
      expect(
        readFileSync(join(repoRoot, relativePath), "utf8"),
        `${relativePath} must include ${parityEntry}`,
      ).toContain(parityEntry);
    }
  });
});
