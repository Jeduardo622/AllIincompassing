import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_mutation_receipts_actor_user_id_index.sql"),
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
const initplanSql = readFileSync(
  join(migrationsDir, "20260815002241_payroll_mutation_receipts_initplan.sql"),
  "utf8",
);

const parityFiles = [
  "scripts/ci/check-runtime-migration-parity.mjs",
  "scripts/ci/check-session-deploy-safety.mjs",
  "tests/ci/check-runtime-migration-parity.test.ts",
  "tests/ci/check-session-deploy-safety.test.ts",
  ".github/workflows/ci.yml",
];

describe("payroll mutation receipts actor index migration", () => {
  it("adds exactly one forward-only WIN-219 remediation migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-intent:\s*payroll_mutation_receipts_actor_user_id_index/i,
    );
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260815002241_payroll_mutation_receipts_initplan\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*drop index if exists public\.payroll_mutation_receipts_actor_user_id_idx;/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("adds only the missing actor_user_id FK-leading btree index", () => {
    expect(foundationSql).toMatch(
      /create table if not exists public\.payroll_mutation_receipts[\s\S]*?actor_user_id uuid not null references auth\.users\(id\) on delete restrict/i,
    );
    expect(foundationSql).toMatch(
      /unique\s*\(\s*organization_id,\s*actor_user_id,\s*operation,\s*idempotency_key\s*\)/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists payroll_mutation_receipts_actor_user_id_idx\s+on public\.payroll_mutation_receipts\s+using btree\s*\(\s*actor_user_id\s*\);/i,
    );
    expect(executableSql.match(/\bcreate\s+(?:unique\s+)?index\b/gi)).toHaveLength(1);
    expect(executableSql).not.toMatch(/\bcreate\s+unique\s+index\b/i);
    expect(executableSql).not.toMatch(/create index[^;]+\(\s*organization_id,\s*actor_user_id/i);
    expect(executableSql).not.toMatch(/\bcreate\s+index\s+concurrently\b/i);

    const indexName = migrationSql.match(
      /create index if not exists\s+([a-z0-9_]+)/i,
    )?.[1];
    expect(indexName).toBe("payroll_mutation_receipts_actor_user_id_idx");
    expect(indexName?.length).toBeLessThanOrEqual(63);
  });

  it("leaves the initplan policy, RLS, and ACL contract unchanged", () => {
    expect(initplanSql).toMatch(
      /alter policy payroll_mutation_receipts_authenticated_select[\s\S]*actor_user_id\s*=\s*\(\s*select auth\.uid\(\)\s*\)/i,
    );
    expect(foundationSql).toMatch(
      /alter table public\.payroll_mutation_receipts enable row level security;/i,
    );
    expect(foundationSql).toMatch(
      /alter table public\.payroll_mutation_receipts force row level security;/i,
    );
    expect(foundationSql).toMatch(
      /grant select on public\.payroll_mutation_receipts to authenticated;/i,
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
    const parityEntry = `${version}|payroll_mutation_receipts_actor_user_id_index`;

    expect(version).toMatch(/^\d{14}$/);
    for (const relativePath of parityFiles) {
      expect(
        readFileSync(join(repoRoot, relativePath), "utf8"),
        `${relativePath} must include ${parityEntry}`,
      ).toContain(parityEntry);
    }
  });
});
