import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_mutation_receipts_initplan.sql"),
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

const parityFiles = [
  "scripts/ci/check-runtime-migration-parity.mjs",
  "scripts/ci/check-session-deploy-safety.mjs",
  "tests/ci/check-runtime-migration-parity.test.ts",
  "tests/ci/check-session-deploy-safety.test.ts",
  ".github/workflows/ci.yml",
];

describe("payroll mutation receipts initplan migration", () => {
  it("adds exactly one forward-only WIN-219 remediation migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-intent:\s*payroll_mutation_receipts_initplan/i,
    );
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260814213754_session_audit_created_by_typo_repair\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*alter policy payroll_mutation_receipts_authenticated_select on public\.payroll_mutation_receipts using \(\(app\.payroll_actor_in_organization\(organization_id\) and actor_user_id = auth\.uid\(\)\) or app\.payroll_actor_has_capability\(organization_id, 'payroll\.resolve_exceptions'\)\);/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("changes only the actor auth call evaluation strategy", () => {
    expect(foundationSql).toMatch(
      /create policy payroll_mutation_receipts_authenticated_select[\s\S]*?actor_user_id\s*=\s*auth\.uid\(\)/i,
    );
    expect(migrationSql).toMatch(
      /alter policy payroll_mutation_receipts_authenticated_select\s+on public\.payroll_mutation_receipts\s+using\s*\(\s*\(\s*app\.payroll_actor_in_organization\(organization_id\)\s+and actor_user_id\s*=\s*\(\s*select auth\.uid\(\)\s*\)\s*\)\s*or app\.payroll_actor_has_capability\(organization_id,\s*'payroll\.resolve_exceptions'\)\s*\);/i,
    );
    expect(executableSql.match(/\balter\s+policy\b/gi)).toHaveLength(1);
    expect(executableSql).not.toMatch(/actor_user_id\s*=\s*auth\.uid\(\)/i);
    expect(executableSql).not.toMatch(/\b(create|drop)\s+policy\b/i);
  });

  it("preserves the authenticated SELECT policy, forced RLS, and read-only ACL contract", () => {
    expect(foundationSql).toMatch(
      /alter table public\.payroll_mutation_receipts enable row level security;/i,
    );
    expect(foundationSql).toMatch(
      /alter table public\.payroll_mutation_receipts force row level security;/i,
    );
    expect(foundationSql).toMatch(
      /create policy payroll_mutation_receipts_authenticated_select\s+on public\.payroll_mutation_receipts\s+for select\s+to authenticated/i,
    );
    expect(foundationSql).toMatch(
      /grant select on public\.payroll_mutation_receipts to authenticated;/i,
    );
    expect(executableSql).not.toMatch(/\b(grant|revoke)\b/i);
    expect(executableSql).not.toMatch(/\balter\s+table\b/i);
  });

  it("introduces no index, data, function, trigger, capability, or activation change", () => {
    expect(executableSql).not.toMatch(/\b(create|drop)\s+index\b/i);
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
    const parityEntry = `${version}|payroll_mutation_receipts_initplan`;

    expect(version).toMatch(/^\d{14}$/);
    for (const relativePath of parityFiles) {
      expect(
        readFileSync(join(repoRoot, relativePath), "utf8"),
        `${relativePath} must include ${parityEntry}`,
      ).toContain(parityEntry);
    }
  });
});
