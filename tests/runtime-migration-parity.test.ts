import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  collectAddedMigrationVersions,
  collectAddedMigrations,
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
});
