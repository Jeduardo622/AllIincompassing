import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts", "ci", "check-api-convergence.mjs");

const writeJson = (filePath: string, value: unknown) => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeFixtureRepo = (root: string) => {
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "netlify", "functions"), { recursive: true });

  writeFileSync(path.join(root, "src", "noop.ts"), "export const noop = true;\n", "utf8");
  writeFileSync(path.join(root, "netlify", "functions", "payroll-time-events.ts"), "export default {};\n", "utf8");
  writeFileSync(
    path.join(root, "netlify.toml"),
    [
      '[[redirects]]',
      'from = "/api/payroll-time-events"',
      'to = "/.netlify/functions/payroll-time-events"',
      'status = 200',
      "",
    ].join("\n"),
    "utf8",
  );

  writeJson(path.join(root, "docs", "api", "netlify-function-allowlist.json"), {
    authoritativeRuntime: "supabase-edge",
    bootstrapFunctions: [],
    legacyCompatibilityFunctions: ["dashboard.ts"],
    boundaryExceptions: ["payroll-time-events.ts"],
  });

  writeJson(path.join(root, "docs", "api", "endpoint-convergence-status.json"), {
    targetAuthority: "supabase-edge",
    quarter: "2026-Q3",
    ownerGroup: "Platform Engineering",
    entries: [
      {
        functionFile: "dashboard.ts",
        publicApiPath: "/api/dashboard",
        edgeTarget: "get-dashboard-data",
        wave: "A",
        status: "migrating",
        owner: "Backend Platform",
      },
      {
        functionFile: "payroll-time-events.ts",
        publicApiPath: "/api/payroll-time-events",
        edgeTarget: "payroll-time-events",
        wave: "B",
        status: "migrating",
        owner: "Backend Platform",
      },
    ],
  });

  writeJson(path.join(root, "docs", "api", "critical-endpoint-authority.json"), {
    updatedAt: "2026-08-11",
    ownerGroup: "Platform Engineering",
    criticalEndpoints: [
      {
        publicApiPath: "/api/dashboard",
        functionFile: "dashboard.ts",
        status: "migrating",
        owner: "Backend Platform",
        wave: "A",
        authoritativeTarget: "get-dashboard-data",
      },
      {
        publicApiPath: "/api/payroll-time-events",
        functionFile: "payroll-time-events.ts",
        status: "migrating",
        owner: "Backend Platform",
        wave: "B",
        authoritativeTarget: "payroll-time-events",
      },
    ],
  });

  writeJson(path.join(root, "docs", "api", "runtime-exceptions.json"), {
    exceptions: [
      {
        functionFile: "dashboard.ts",
        publicApiPath: "/api/dashboard",
        reason:
          "Netlify redirect, transport adapter, and `/api/dashboard` callsites remain active for contract stability while the edge-backed dashboard cutover still retains the compatibility shim; re-review for retirement in the next policy pass.",
        owner: "Backend Platform",
        expiresAt: "2026-09-01T23:59:59.999Z",
      },
      {
        functionFile: "payroll-time-events.ts",
        publicApiPath: "/api/payroll-time-events",
        reason: "The public API adapter remains for contract stability while direct Edge convergence is reviewed.",
        owner: "Backend Platform",
        expiresAt: "2026-09-01T23:59:59.999Z",
      },
    ],
  });
};

describe("API convergence boundary exceptions", () => {
  it("treats active boundary exceptions as tracked adapters without legacy reclassification", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "api-convergence-boundary-"));
    try {
      writeFixtureRepo(root);

      expect(() =>
        execFileSync(process.execPath, [scriptPath], {
          cwd: root,
          encoding: "utf8",
          stdio: "pipe",
        })).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
