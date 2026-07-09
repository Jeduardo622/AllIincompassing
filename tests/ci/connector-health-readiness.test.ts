import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "connector-health-readiness.mjs");

const runConnectorHealth = (env: NodeJS.ProcessEnv) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "connector-health-readiness-"));
  execFileSync(process.execPath, [scriptPath], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...env,
    },
    encoding: "utf8",
  });

  const reportPath = path.join(cwd, "artifacts", "latest", "readiness", "connector-health-readiness.json");
  return JSON.parse(readFileSync(reportPath, "utf8")) as {
    result: string;
    checks: Array<{ name: string; status: string }>;
  };
};

describe("connector-health-readiness", () => {
  it("reports missing optional connector credentials without failing the artifact", () => {
    const report = runConnectorHealth({
      CONNECTOR_HEALTH_GITHUB_DISABLED: "true",
      CONNECTOR_HEALTH_SUPABASE_DISABLED: "true",
    });

    expect(report.result).toBe("pass");
    expect(report.checks.find((check) => check.name === "GitHub")?.status).toBe("intentionally_disabled");
    expect(report.checks.find((check) => check.name === "Supabase")?.status).toBe("intentionally_disabled");
    expect(report.checks.find((check) => check.name === "Postman")?.status).toBe("missing");
  });
});
