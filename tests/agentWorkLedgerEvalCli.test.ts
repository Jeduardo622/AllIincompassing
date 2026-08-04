import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const packageJsonPath = path.join(process.cwd(), "package.json");
const fixturePath = path.join(
  process.cwd(),
  "scripts",
  "fixtures",
  "agent-work-ledger-eval-fixture.v1.json",
);
const cliPath = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "agent-work-ledger-eval-cli.ts",
);
const tsxCliPath = path.join(
  process.cwd(),
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  scripts?: Record<string, string>;
};

describe("agent work ledger eval cli contract", () => {
  it("registers the bounded eval script entry", () => {
    expect(packageJson.scripts?.["test:agent-work:eval"]).toBe(
      "tsx scripts/lib/agent-work-ledger-eval-cli.ts",
    );
  });

  it("emits deterministic sanitized json for the bundled fixture", () => {
    const first = spawnSync(process.execPath, [tsxCliPath, cliPath, "--fixture", fixturePath], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
    });
    const second = spawnSync(process.execPath, [tsxCliPath, cliPath, "--fixture", fixturePath], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
    });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);

    const parsed = JSON.parse(first.stdout);
    expect(parsed.summary.status).toBe("pass");
    expect(parsed.summary.releaseGates.readinessEvidenceCoveragePercent).toBe(100);
    expect(first.stdout).not.toContain("Jane Doe");
    expect(first.stdout).not.toContain("patient");
  });

  it("exits nonzero when violations are present", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "agent-work-ledger-eval-"));
    const badFixturePath = path.join(tempDir, "unsafe-fixture.json");
    writeFileSync(
      badFixturePath,
      JSON.stringify({
        datasetVersion: "2026-08-03.agent-work-ledger.eval.v1",
        seed: "agent-work-ledger-eval-v1-fixed-seed",
        cases: [
          {
            id: "unsafe-case",
            phiFree: false,
            expectedOutcome: "pass",
            trace: {
              finalState: "completed",
              note: "Patient name: Jane Doe",
            },
          },
        ],
      }),
    );

    const result = spawnSync(process.execPath, [tsxCliPath, cliPath, "--fixture", badFixturePath], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('"status":"fail"');
    expect(result.stdout).toContain("unsafe");
  });
});
