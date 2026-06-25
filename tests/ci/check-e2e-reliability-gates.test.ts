import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const gatePath = path.join(repoRoot, "scripts", "ci", "check-e2e-reliability-gates.mjs");
const runnerChildren = [
  "playwright:preflight",
  "playwright:auth",
  "playwright:schedule-conflict",
  "playwright:therapist-onboarding",
  "playwright:therapist-authorization",
  "playwright:session-no-show",
  "playwright:session-complete",
  "playwright:schedule-blocked-close",
  "playwright:session-note-measurement-roundtrip",
  "playwright:session-capture-adhoc-upsert",
];

const write = (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};

const directAuthBrowserSmokeLines = [
  "npm run playwright:session-no-show",
  "npm run playwright:session-complete",
  "npm run playwright:schedule-blocked-close",
  "npm run playwright:session-note-measurement-roundtrip",
];

const createFixture = (
  ciPlaywright: string,
  authBrowserSmokeLines = directAuthBrowserSmokeLines,
  extraWorkflowLines: string[] = [],
) => {
  const root = mkdtempSync(path.join(tmpdir(), "e2e-reliability-gate-"));

  write(
    root,
    "tests/reliability/policy.json",
    JSON.stringify({
      e2e: {
        maxSkippedCriticalFlows: 0,
        retryBudget: { cypressRunMode: 0, playwright: 0 },
        tier0PassRatePctFloor: 99,
      },
    }),
  );
  write(root, "cypress.config.cjs", "module.exports = { retries: 0 };\n");
  write(
    root,
    "package.json",
    JSON.stringify({
      scripts: {
        "ci:playwright": ciPlaywright,
        "playwright:preflight": "tsx scripts/playwright-preflight.ts",
      },
    }),
  );
  write(
    root,
    "cypress/support/routeScenarios.ts",
    [
      'roles: ["therapist", "admin", "super_admin"]',
      'cy.intercept("GET", "**/api/runtime-config").as("runtimeConfig");',
      'cy.wait("@runtimeConfig");',
    ].join("\n"),
  );
  write(
    root,
    "cypress/support/commands.ts",
    [
      "cy.intercept('GET', '**/api/runtime-config').as('runtimeConfigBootstrap');",
      "cy.wait('@runtimeConfigBootstrap');",
    ].join("\n"),
  );

  for (const specName of [
    "routes_public.cy.ts",
    "routes_client.cy.ts",
    "routes_schedule.cy.ts",
    "routes_admin.cy.ts",
    "routes_auth.cy.ts",
  ]) {
    write(root, `cypress/e2e/${specName}`, "runRoleMatrix();\n");
  }

  write(
    root,
    ".github/workflows/ci.yml",
    [
      "jobs:",
      "  tier0_browser:",
      "    steps:",
      "      - name: Record tier-0 evidence",
      "        run: npm run ci:write-evidence -- tier0-browser success",
      "  unrelated_browser_smoke:",
      "    steps:",
      ...extraWorkflowLines.map((line) => `      ${line}`),
      "  auth_browser_smoke:",
      "    name: auth-browser-smoke",
      "    timeout-minutes: 35",
      "    steps:",
      "      - name: Auth browser smoke gate",
      "        run: |",
      ...authBrowserSmokeLines.map((line) => `          ${line}`),
      "      - name: Record auth smoke evidence",
      "        if: always()",
      '        run: npm run ci:write-evidence -- auth-browser-smoke "${{ job.status }}"',
      "  iehp_assessment_import_smoke:",
      "    name: iehp-assessment-import-smoke",
      "    steps:",
      "      - run: npm run playwright:iehp-assessment-import-smoke",
      "      - name: Record IEHP import smoke evidence",
      "        if: always()",
      "  ci_gate:",
      "    needs:",
      "      - auth_browser_smoke",
      "      - iehp_assessment_import_smoke",
      "    steps:",
      "      - run: echo needs.iehp_assessment_import_smoke.result",
    ].join("\n"),
  );
  write(root, ".github/workflows/supabase-preview.yml", "Run preview smoke suite\n");
  write(root, ".github/workflows/rollback-drill.yml", "Run rollback drill contract checks\n");

  for (const scriptName of [
    "playwright-auth-smoke.ts",
    "playwright-schedule-conflict.ts",
    "playwright-therapist-onboarding.ts",
    "playwright-therapist-authorization.ts",
    "playwright-session-lifecycle.ts",
    "playwright-session-no-show.ts",
    "playwright-session-complete.ts",
    "playwright-schedule-blocked-close.ts",
    "playwright-session-note-measurement-roundtrip.ts",
    "playwright-iehp-assessment-import-smoke.ts",
  ]) {
    write(root, `scripts/${scriptName}`, "console.log('fixture smoke');\n");
  }

  return root;
};

describe("check-e2e-reliability-gates", () => {
  test("session note measurement roundtrip script does not emit soft-skip reliability warnings", () => {
    const scriptPath = path.join(repoRoot, "scripts", "playwright-session-note-measurement-roundtrip.ts");
    const content = readFileSync(scriptPath, "utf8");

    expect(content).not.toMatch(/skip(ped|s)?/i);
    expect(content).not.toMatch(/smoke skipped/i);
  });

  test("accepts ci:playwright runner invocation semantics", () => {
    const fixtureRoot = createFixture(`tsx scripts/playwright-ci-runner.ts ${runnerChildren.join(" ")}`);

    const result = spawnSync("node", [gatePath], { cwd: fixtureRoot, encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("E2E reliability gate check passed.");
  });

  test("accepts workflow aggregate ci:playwright runner semantics", () => {
    const fixtureRoot = createFixture(
      `tsx scripts/playwright-ci-runner.ts ${runnerChildren.join(" ")}`,
      ["npm run ci:playwright"],
    );

    const result = spawnSync("node", [gatePath], { cwd: fixtureRoot, encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("E2E reliability gate check passed.");
  });

  test("rejects ci:playwright outside auth-browser-smoke job", () => {
    const fixtureRoot = createFixture(
      `tsx scripts/playwright-ci-runner.ts ${runnerChildren.join(" ")}`,
      [],
      ["- run: npm run ci:playwright"],
    );

    const result = spawnSync("node", [gatePath], { cwd: fixtureRoot, encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "auth-browser-smoke gate must run playwright:session-no-show directly or via ci:playwright",
    );
  });

  test("rejects auth-browser-smoke timeout below the required hosted budget", () => {
    const fixtureRoot = createFixture(`tsx scripts/playwright-ci-runner.ts ${runnerChildren.join(" ")}`);
    const workflowPath = path.join(fixtureRoot, ".github/workflows/ci.yml");
    const workflow = readFileSync(workflowPath, "utf8").replace("timeout-minutes: 35", "timeout-minutes: 25");
    writeFileSync(workflowPath, workflow);

    const result = spawnSync("node", [gatePath], { cwd: fixtureRoot, encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("auth-browser-smoke timeout-minutes must be at least 35");
  });

  test("rejects old ci:playwright shell-chain semantics", () => {
    const fixtureRoot = createFixture(runnerChildren.map((scriptName) => `npm run ${scriptName}`).join(" && "));

    const result = spawnSync("node", [gatePath], { cwd: fixtureRoot, encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ci:playwright must invoke scripts/playwright-ci-runner.ts");
  });
});
