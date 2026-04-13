import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  collectAddedMigrationVersions,
  collectAddedMigrations,
  compareMigrationVersionStrings,
  resolveMissingMigrations,
  resolveMissingVersions,
} from "../scripts/ci/runtime-migration-parity.mjs";

describe("runtime migration parity helpers", () => {
  it("collects added migration versions from a git merge range", () => {
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "migration-parity-"));
    try {
      const migrationsDir = path.join(repoDir, "supabase", "migrations");
      mkdirSync(migrationsDir, { recursive: true });

      execSync("git init", { cwd: repoDir, stdio: "ignore" });
      execSync('git config user.email "ci@example.com"', { cwd: repoDir, stdio: "ignore" });
      execSync('git config user.name "CI Tester"', { cwd: repoDir, stdio: "ignore" });

      writeFileSync(
        path.join(migrationsDir, "20260401000000_existing.sql"),
        "select 1;\n",
        "utf8",
      );
      execSync("git add .", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "initial migration"', { cwd: repoDir, stdio: "ignore" });
      const baseSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf8" }).trim();

      writeFileSync(
        path.join(migrationsDir, "20260401143000_fix_user_roles_policy_recursion.sql"),
        "select 2;\n",
        "utf8",
      );
      execSync("git add .", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "add recursion fix migration"', { cwd: repoDir, stdio: "ignore" });
      const headSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf8" }).trim();

      const versions = collectAddedMigrationVersions({
        baseSha,
        headSha,
        cwd: repoDir,
      });

      expect(versions).toContain("20260401143000");

      const entries = collectAddedMigrations({
        baseSha,
        headSha,
        cwd: repoDir,
      });
      expect(entries.some((e) => e.version === "20260401143000" && e.name === "fix_user_roles_policy_recursion")).toBe(
        true,
      );
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("returns an empty list when all required versions are present", () => {
    const missing = resolveMissingVersions(
      ["20260401143000"],
      ["20260401143000", "20260401000000"],
    );

    expect(missing).toEqual([]);
  });

  it("returns missing migration versions clearly", () => {
    const missing = resolveMissingVersions(
      ["20260401143000", "20260402120000"],
      ["20260401143000"],
    );

    expect(missing).toEqual(["20260402120000"]);
  });

  it("treats runtime as satisfied when logical migration name matches but hosted version differs", () => {
    const required = [{ version: "20260413120000", name: "authorizations_therapist_read_caseload" }];
    const applied = [{ version: "20260413142741", name: "authorizations_therapist_read_caseload" }];

    expect(resolveMissingMigrations(required, applied)).toEqual([]);
  });

  it("still reports missing when neither version nor name matches", () => {
    const required = [{ version: "20260413120000", name: "authorizations_therapist_read_caseload" }];
    const applied = [{ version: "20260408142721", name: "schedule_rpc_include_availability_hours" }];

    expect(resolveMissingMigrations(required, applied)).toEqual(required);
  });

  it("does not satisfy by name when multiple applied rows share the same migration name (slug reuse)", () => {
    const required = [{ version: "20260901090000", name: "shared_slug" }];
    const applied = [
      { version: "20260101000000", name: "shared_slug" },
      { version: "20260901120000", name: "shared_slug" },
    ];

    expect(resolveMissingMigrations(required, applied)).toEqual(required);
  });

  it("does not satisfy by name when the merge adds more than one migration with the same name", () => {
    const required = [
      { version: "20260901090000", name: "dup" },
      { version: "20260901100000", name: "dup" },
    ];
    const applied = [{ version: "20260901100000", name: "dup" }];

    expect(resolveMissingMigrations(required, applied)).toEqual([{ version: "20260901090000", name: "dup" }]);
  });

  it("does not satisfy by name when the only applied row is older than required (reused slug, new SQL not applied)", () => {
    const required = [{ version: "20260201090000", name: "reused_feature" }];
    const applied = [{ version: "20250101090000", name: "reused_feature" }];

    expect(resolveMissingMigrations(required, applied)).toEqual(required);
  });

  it("compareMigrationVersionStrings orders numeric migration versions", () => {
    expect(compareMigrationVersionStrings("20260413142741", "20260413120000")).toBe(1);
    expect(compareMigrationVersionStrings("20260413120000", "20260413142741")).toBe(-1);
    expect(compareMigrationVersionStrings("20260413120000", "20260413120000")).toBe(0);
  });
});
