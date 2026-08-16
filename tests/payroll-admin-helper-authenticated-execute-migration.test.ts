import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_admin_helper_authenticated_execute.sql"),
);
const migrationFile = migrationFiles[0] ?? "";
const migrationSql = migrationFile
  ? readFileSync(join(migrationsDir, migrationFile), "utf8")
  : "";
const executableSql = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const administrationSql = readFileSync(
  join(migrationsDir, "20260812153628_payroll_administration.sql"),
  "utf8",
);
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

describe("payroll admin helper authenticated execute migration", () => {
  it("adds exactly one forward-only WIN-219 helper grant migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-intent:\s*payroll_admin_helper_authenticated_execute/i,
    );
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260816063149_payroll_pay_cycle_fk_indexes\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*revoke execute on function app\.current_user_is_payroll_admin\(uuid\) from authenticated;/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("re-grants execute on the exact payroll admin helper to authenticated only", () => {
    expect(administrationSql).toMatch(
      /revoke all on function app\.current_user_is_payroll_admin\(uuid\) from public,\s*anon,\s*authenticated,\s*service_role;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function app\.current_user_is_payroll_admin\(uuid\) to authenticated;/i,
    );
    expect(migrationSql).not.toMatch(
      /grant execute on function app\.current_user_is_payroll_admin\(uuid\) to (?:[^;]*\bservice_role\b|[^;]*\banon\b|[^;]*\bpublic\b)/i,
    );
    expect(
      executableSql.match(
        /\bgrant execute on function app\.current_user_is_payroll_admin\(uuid\) to authenticated;/gi,
      ),
    ).toHaveLength(1);
    expect(executableSql.match(/\bgrant\b/gi)).toHaveLength(1);
    expect(executableSql).not.toMatch(/\brevoke\b/i);
  });

  it("preserves the helper definition, dependent policy capability checks, and table auth contract", () => {
    expect(administrationSql).toMatch(
      /create or replace function app\.current_user_is_payroll_admin\(\s*p_target_organization_id uuid\s*\)[\s\S]*?returns boolean[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?membership\.user_id = auth\.uid\(\)[\s\S]*?role_row\.name in \('admin', 'super_admin'\)[\s\S]*?app\.payroll_actor_in_organization\(p_target_organization_id\)/i,
    );
    expect(administrationSql).toMatch(
      /create policy pay_group_generation_versions_authenticated_select[\s\S]*?app\.current_user_is_payroll_admin\(organization_id\)[\s\S]*?payroll\.configure_employment[\s\S]*?payroll\.export_period/i,
    );
    expect(exportLedgerSql).toMatch(
      /create policy payroll_export_runs_authenticated_select[\s\S]*?app\.current_user_is_payroll_admin\(organization_id\)[\s\S]*?payroll\.export_period/i,
    );
    expect(exportLedgerSql).toMatch(
      /create policy payroll_export_rows_authenticated_select[\s\S]*?app\.current_user_is_payroll_admin\(organization_id\)[\s\S]*?payroll\.export_period/i,
    );
    expect(administrationSql).toMatch(
      /alter table public\.pay_group_generation_versions enable row level security;/i,
    );
    expect(administrationSql).toMatch(
      /alter table public\.pay_group_generation_versions force row level security;/i,
    );
    expect(administrationSql).toMatch(
      /grant select on public\.pay_group_generation_versions to authenticated;/i,
    );
  });

  it("introduces no policy, helper, table, data, or activation drift", () => {
    expect(executableSql).not.toMatch(/\b(create|alter|drop)\s+policy\b/i);
    expect(executableSql).not.toMatch(
      /\b(create|alter|drop)\s+function\b/i,
    );
    expect(executableSql).not.toMatch(/\b(create|alter|drop)\s+table\b/i);
    expect(executableSql).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(executableSql).not.toMatch(
      /feature_flags|payroll_capability_grants|default_enabled|activation_status/i,
    );
  });

  it("adds the migration to every explicit WIN-219 runtime parity mirror", () => {
    const version = migrationFile.split("_")[0] ?? "";
    const parityEntry = `${version}|payroll_admin_helper_authenticated_execute`;

    expect(version).toMatch(/^\d{14}$/);
    for (const relativePath of parityFiles) {
      expect(
        readFileSync(join(repoRoot, relativePath), "utf8"),
        `${relativePath} must include ${parityEntry}`,
      ).toContain(parityEntry);
    }
  });
});
