import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const migrationsDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
  fileName.endsWith("_payroll_blocker_resolutions_advisor_remediation.sql"),
);
const migrationFile = migrationFiles[0] ?? "";
const migrationSql = migrationFile
  ? readFileSync(join(migrationsDir, migrationFile), "utf8")
  : "";
const executableSql = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const approvalWorkflowSql = readFileSync(
  join(migrationsDir, "20260812122436_payroll_approval_workflow.sql"),
  "utf8",
);

const parityFiles = [
  "scripts/ci/check-runtime-migration-parity.mjs",
  "scripts/ci/check-session-deploy-safety.mjs",
  "tests/ci/check-runtime-migration-parity.test.ts",
  "tests/ci/check-session-deploy-safety.test.ts",
  ".github/workflows/ci.yml",
];

describe("payroll blocker resolutions advisor remediation migration", () => {
  it("adds exactly one forward-only WIN-219 remediation migration", () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-intent:\s*payroll_blocker_resolutions_advisor_remediation/i,
    );
    expect(migrationSql).toMatch(
      /@migration-dependencies:\s*20260816201115_payroll_export_fk_indexes\.sql/i,
    );
    expect(migrationSql).toMatch(
      /@migration-rollback:\s*drop index if exists public\.payroll_blocker_resolutions_actor_user_id_idx;\s*drop index if exists public\.payroll_blocker_resolutions_employment_profile_org_idx;\s*drop index if exists public\.payroll_blocker_resolutions_pay_period_org_idx;\s*drop index if exists public\.payroll_blocker_resolutions_previous_resolution_org_idx;\s*drop index if exists public\.payroll_blocker_resolutions_session_attendance_req_org_idx;\s*drop index if exists public\.payroll_blocker_resolutions_time_correction_req_org_idx;\s*drop index if exists public\.payroll_blocker_resolutions_timekeeping_exception_org_idx;\s*alter policy payroll_blocker_resolutions_authenticated_select on public\.payroll_blocker_resolutions using/i,
    );
    expect(executableSql).toMatch(/^\s*begin;/i);
    expect(executableSql).toMatch(/\bcommit;\s*$/i);
  });

  it("covers exactly the seven remaining advisor-reported FK column sequences", () => {
    expect(approvalWorkflowSql).toMatch(
      /actor_user_id uuid not null references auth\.users\(id\) on delete restrict/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /foreign key\s*\(\s*employment_profile_id,\s*organization_id\s*\)\s*references public\.employment_profiles\(id,\s*organization_id\)/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /foreign key\s*\(\s*pay_period_id,\s*organization_id\s*\)\s*references public\.pay_periods\(id,\s*organization_id\)/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /foreign key\s*\(\s*time_correction_request_id,\s*organization_id\s*\)\s*references public\.time_correction_requests\(id,\s*organization_id\)/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /foreign key\s*\(\s*session_attendance_correction_request_id,\s*organization_id\s*\)\s*references public\.session_attendance_correction_requests\(id,\s*organization_id\)/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /foreign key\s*\(\s*timekeeping_exception_id,\s*organization_id\s*\)\s*references public\.timekeeping_exceptions\(id,\s*organization_id\)/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /foreign key\s*\(\s*previous_resolution_id,\s*organization_id\s*\)\s*references public\.payroll_blocker_resolutions\(id,\s*organization_id\)/i,
    );

    const expectedIndexes = [
      [
        "payroll_blocker_resolutions_actor_user_id_idx",
        "actor_user_id",
      ],
      [
        "payroll_blocker_resolutions_employment_profile_org_idx",
        "employment_profile_id,\\s*organization_id",
      ],
      [
        "payroll_blocker_resolutions_pay_period_org_idx",
        "pay_period_id,\\s*organization_id",
      ],
      [
        "payroll_blocker_resolutions_previous_resolution_org_idx",
        "previous_resolution_id,\\s*organization_id",
      ],
      [
        "payroll_blocker_resolutions_session_attendance_req_org_idx",
        "session_attendance_correction_request_id,\\s*organization_id",
      ],
      [
        "payroll_blocker_resolutions_time_correction_req_org_idx",
        "time_correction_request_id,\\s*organization_id",
      ],
      [
        "payroll_blocker_resolutions_timekeeping_exception_org_idx",
        "timekeeping_exception_id,\\s*organization_id",
      ],
    ] as const;

    for (const [indexName, columns] of expectedIndexes) {
      expect(migrationSql).toMatch(
        new RegExp(
          `create index if not exists ${indexName}\\s+on public\\.payroll_blocker_resolutions\\s+using btree\\s*\\(\\s*${columns}\\s*\\);`,
          "i",
        ),
      );
    }

    const createIndexMatches = executableSql.match(
      /\bcreate\s+(?:unique\s+)?index\b/gi,
    );
    expect(createIndexMatches).toHaveLength(7);
    expect(executableSql).not.toMatch(/\bcreate\s+unique\s+index\b/i);
    expect(executableSql).not.toMatch(/\bcreate\s+index\s+concurrently\b/i);

    const indexNames = [
      ...migrationSql.matchAll(/create index if not exists\s+([a-z0-9_]+)/gi),
    ].map(([, name]) => name);
    expect(new Set(indexNames).size).toBe(7);
    expect(indexNames.every((name) => name.length <= 63)).toBe(true);
  });

  it("does not duplicate the existing organization-first blocker indexes", () => {
    expect(approvalWorkflowSql).toMatch(
      /create index if not exists payroll_blocker_resolutions_org_employment_period_idx[\s\S]*?\(\s*organization_id,\s*employment_profile_id,\s*pay_period_id,\s*occurred_at desc,\s*received_at desc,\s*id desc\s*\)/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /create index if not exists payroll_blocker_resolutions_current_state_idx[\s\S]*?\(\s*organization_id,\s*employment_profile_id,\s*pay_period_id,\s*blocker_type,\s*coalesce\(/i,
    );
    expect(executableSql).not.toMatch(
      /create index[^;]+\(\s*organization_id\s*(?:,|\))/i,
    );
  });

  it("changes only the manager-assignment auth evaluation strategy in the existing policy", () => {
    expect(approvalWorkflowSql).toMatch(
      /create policy payroll_blocker_resolutions_authenticated_select[\s\S]*assignment_row\.manager_user_id\s*=\s*auth\.uid\(\)/i,
    );
    expect(migrationSql).toMatch(
      /alter policy payroll_blocker_resolutions_authenticated_select\s+on public\.payroll_blocker_resolutions\s+using\s*\(\s*app\.current_user_can_read_payroll_employee\(organization_id,\s*employment_profile_id\)\s+or\s+\(\s*app\.payroll_actor_in_organization\(organization_id\)\s+and\s+(?:\(\s*)?exists\s*\(\s*select 1[\s\S]*assignment_row\.organization_id = payroll_blocker_resolutions\.organization_id[\s\S]*assignment_row\.employment_profile_id = payroll_blocker_resolutions\.employment_profile_id[\s\S]*assignment_row\.manager_user_id = \(select auth\.uid\(\)\)[\s\S]*assignment_row\.effective_from <= (?:pg_catalog\.)?now\(\)[\s\S]*assignment_row\.effective_through[\s\S]*\)\s*\)?\s+and\s+\(\s*app\.payroll_actor_has_capability\(organization_id,\s*'time\.review_assigned'\)\s+or\s+app\.payroll_actor_has_capability\(organization_id,\s*'time\.approve_assigned'\)\s*\)\s*\)\s+or\s+app\.payroll_actor_has_capability\(organization_id,\s*'payroll\.lock_period'\)\s+or\s+app\.payroll_actor_has_capability\(organization_id,\s*'payroll\.reopen_period'\)\s+or\s+app\.payroll_actor_has_capability\(organization_id,\s*'payroll\.resolve_exceptions'\)\s*\);/i,
    );
    expect(executableSql.match(/\balter\s+policy\b/gi)).toHaveLength(1);
    expect(executableSql).not.toMatch(
      /assignment_row\.manager_user_id\s*=\s*auth\.uid\(\)/i,
    );
    expect(executableSql).not.toMatch(/\b(create|drop)\s+policy\b/i);
  });

  it("preserves the authenticated SELECT policy metadata, forced RLS, and read-only ACL contract", () => {
    expect(approvalWorkflowSql).toMatch(
      /alter table public\.payroll_blocker_resolutions enable row level security;/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /alter table public\.payroll_blocker_resolutions force row level security;/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /create policy payroll_blocker_resolutions_authenticated_select\s+on public\.payroll_blocker_resolutions\s+for select\s+to authenticated/i,
    );
    expect(approvalWorkflowSql).toMatch(
      /grant select on public\.payroll_blocker_resolutions to authenticated;/i,
    );
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
    const parityEntry = `${version}|payroll_blocker_resolutions_advisor_remediation`;

    expect(version).toMatch(/^\d{14}$/);
    for (const relativePath of parityFiles) {
      expect(
        readFileSync(join(repoRoot, relativePath), "utf8"),
        `${relativePath} must include ${parityEntry}`,
      ).toContain(parityEntry);
    }
  });
});
