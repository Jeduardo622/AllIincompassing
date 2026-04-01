import { describe, expect, it } from "vitest";

import {
  collectAddedMigrationVersions,
  resolveMissingVersions,
} from "../scripts/ci/runtime-migration-parity.mjs";

describe("runtime migration parity helpers", () => {
  it("collects added migration versions from a git merge range", () => {
    const versions = collectAddedMigrationVersions({
      baseSha: "4b5787c22469772446201b13cf3a8ead429738c0",
      headSha: "3e28e5526a8c03e771226abb11b0c542c9138025",
      cwd: process.cwd(),
    });

    expect(versions).toContain("20260401143000");
  });

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
});
