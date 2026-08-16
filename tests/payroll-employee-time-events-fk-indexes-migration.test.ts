import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_employee_time_events_fk_indexes.sql"),
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

const parityFiles = [
  "scripts/ci/check-runtime-migration-parity.mjs",
  "scripts/ci/check-session-deploy-safety.mjs",
  "tests/ci/check-runtime-migration-parity.test.ts",
  "tests/ci/check-session-deploy-safety.test.ts",
  ".github/workflows/ci.yml",
];

describe("payroll employee time events FK index migration", () => {
  it("adds exactly one forward-only WIN-219 remediation migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-intent:\s*payroll_employee_time_events_fk_indexes/i,
    );
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260815191838_payroll_mutation_receipts_actor_user_id_index\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*drop index if exists public\.employee_time_events_actor_user_id_idx;\s*drop index if exists public\.employee_time_events_employment_profile_org_idx;\s*drop index if exists public\.employee_time_events_replacement_event_org_idx;/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("covers exactly the three advisor-reported FK column sequences", () => {
    expect(foundationSql).toMatch(
      /create table if not exists public\.employee_time_events[\s\S]*?actor_user_id uuid not null references auth\.users\(id\) on delete restrict/i,
    );
    expect(foundationSql).toMatch(
      /foreign key\s*\(\s*employment_profile_id,\s*organization_id\s*\)[\s\S]*?references public\.employment_profiles\(id, organization_id\)/i,
    );
    expect(foundationSql).toMatch(
      /foreign key\s*\(\s*replacement_for_event_id,\s*organization_id\s*\)[\s\S]*?references public\.employee_time_events\(id, organization_id\)/i,
    );
    expect(snapshotsSql).toMatch(
      /create index if not exists employee_time_events_org_employment_event_at_idx[\s\S]*?\(organization_id, employment_profile_id, event_at, created_at, id\)/i,
    );

    expect(migrationSql).toMatch(
      /create index if not exists employee_time_events_actor_user_id_idx\s+on public\.employee_time_events\s+using btree\s*\(\s*actor_user_id\s*\);/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists employee_time_events_employment_profile_org_idx\s+on public\.employee_time_events\s+using btree\s*\(\s*employment_profile_id,\s*organization_id\s*\);/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists employee_time_events_replacement_event_org_idx\s+on public\.employee_time_events\s+using btree\s*\(\s*replacement_for_event_id,\s*organization_id\s*\);/i,
    );

    const createIndexMatches = executableSql.match(
      /\bcreate\s+(?:unique\s+)?index\b/gi,
    );
    expect(createIndexMatches).toHaveLength(3);
    expect(executableSql).not.toMatch(/\bcreate\s+unique\s+index\b/i);
    expect(executableSql).not.toMatch(/\bcreate\s+index\s+concurrently\b/i);
    expect(executableSql).not.toMatch(
      /create index[^;]+\(\s*organization_id,\s*employment_profile_id/i,
    );

    const indexNames = [...migrationSql.matchAll(/create index if not exists\s+([a-z0-9_]+)/gi)].map(
      ([, name]) => name,
    );
    expect(new Set(indexNames).size).toBe(3);
    expect(indexNames.every((name) => name.length <= 63)).toBe(true);
  });

  it("preserves the employee payroll read policy, RLS, and ACL contract", () => {
    expect(foundationSql).toMatch(
      /create policy employee_time_events_authenticated_select[\s\S]*?using \(app\.current_user_can_read_payroll_employee\(organization_id, employment_profile_id\)\);/i,
    );
    expect(foundationSql).toMatch(
      /alter table public\.employee_time_events enable row level security;/i,
    );
    expect(foundationSql).toMatch(
      /alter table public\.employee_time_events force row level security;/i,
    );
    expect(foundationSql).toMatch(
      /grant select on public\.employee_time_events to authenticated;/i,
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
    const parityEntry = `${version}|payroll_employee_time_events_fk_indexes`;

    expect(version).toMatch(/^\d{14}$/);
    for (const relativePath of parityFiles) {
      expect(
        readFileSync(join(repoRoot, relativePath), "utf8"),
        `${relativePath} must include ${parityEntry}`,
      ).toContain(parityEntry);
    }
  });
});
