import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  collectLocalMigrationVersions,
  parseMigrationVersion,
  resolveMigrationDrift,
} from "../scripts/ci/check-supabase-preview-drift.mjs";

describe("supabase preview drift helpers", () => {
  it("parses migration versions from sql filenames", () => {
    expect(parseMigrationVersion("20260401143000_fix_user_roles_policy_recursion.sql")).toBe(
      "20260401143000",
    );
    expect(parseMigrationVersion("20251014_rls_and_functions_hardening.sql")).toBe("20251014");
    expect(parseMigrationVersion("20251014.sql")).toBe("20251014");
    expect(parseMigrationVersion("notes.txt")).toBe("");
  });

  it("collects sorted local migration versions", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "preview-drift-"));
    try {
      const migrationsDir = path.join(root, "supabase", "migrations");
      mkdirSync(migrationsDir, { recursive: true });
      writeFileSync(path.join(migrationsDir, "20260313160000_authz_storage_alignment.sql"), "-- sql");
      writeFileSync(path.join(migrationsDir, "20260313160000_duplicate.sql"), "-- sql");
      writeFileSync(path.join(migrationsDir, "20260313161000_performance_hotpath_indexes.sql"), "-- sql");
      writeFileSync(path.join(migrationsDir, "README.md"), "ignore me");

      const versions = await collectLocalMigrationVersions({ migrationsDir });
      expect(versions).toEqual(["20260313160000", "20260313161000"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("computes bidirectional drift correctly", () => {
    const drift = resolveMigrationDrift({
      localVersions: ["20260313160000", "20260313161000", "20260401143000"],
      remoteVersions: ["20260313160000", "20260313170000", "20260401143000"],
    });

    expect(drift.localOnly).toEqual(["20260313161000"]);
    expect(drift.remoteOnly).toEqual(["20260313170000"]);
    expect(drift.hasDrift).toBe(true);
  });
});
