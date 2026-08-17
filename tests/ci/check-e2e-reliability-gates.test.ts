import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveOpportunityCountForMetric } from "../../scripts/playwright-session-note-measurement-roundtrip";

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
const sessionSmokeRunnerChildren = [
  "playwright:preflight",
  "playwright:session-no-show",
  "playwright:session-complete",
  "playwright:schedule-blocked-close",
  "playwright:session-note-measurement-roundtrip",
];
const normalizeLf = (content: string) => content.replace(/\r\n/g, "\n");

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
        "ci:playwright:session-smoke": `tsx scripts/playwright-ci-runner.ts ${sessionSmokeRunnerChildren.join(" ")}`,
        "ci:playwright:optional-smoke":
          "tsx scripts/playwright-ci-runner.ts playwright:authorizations-read-scope playwright:assessment-upload-promote-smoke playwright:assessment-pdf-smoke playwright:clinical-data-parity-agent",
        "ci:playwright:env-readiness": "node scripts/ci/playwright-env-readiness.mjs",
        "ci:connector-health": "node scripts/ci/connector-health-readiness.mjs",
        "playwright:preflight": "tsx scripts/playwright-preflight.ts",
      },
    }),
  );
  write(
    root,
    "cypress/support/routeScenarios.ts",
    [
      'roles: ["bt", "therapist", "midtier", "admin_schedule", "admin", "bcba", "super_admin"]',
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
      "  playwright_env_readiness:",
      "    name: playwright-env-readiness",
      "    steps:",
      "      - name: Select Playwright readiness scope",
      "        run: node scripts/ci/select-browser-checks.mjs --format github-output",
      "      - run: npm run ci:playwright:env-readiness -- --fail-on-blocking",
      "  iehp_assessment_import_smoke:",
      "    name: iehp-assessment-import-smoke",
      "    steps:",
      "      - run: npm run playwright:iehp-assessment-import-smoke",
      "      - name: Record IEHP import smoke evidence",
      "        if: always()",
      "  optional_playwright_smoke:",
      "    name: optional-playwright-smoke",
      "    steps:",
      "      - name: Optional Playwright smoke secret gate",
      "        env:",
      "          PW_OPTIONAL_PLAYWRIGHT_SMOKE: ${{ secrets.PW_OPTIONAL_PLAYWRIGHT_SMOKE }}",
      "          PW_CLINICAL_QA_TARGET_MARKER: ${{ secrets.PW_CLINICAL_QA_TARGET_MARKER }}",
      "        run: echo 'redacted|synthetic|smoke|test'",
      "      - run: npm run ci:playwright:optional-smoke",
      "  ci_gate:",
      "    needs:",
      "      - auth_browser_smoke",
      "      - playwright_env_readiness",
      "      - iehp_assessment_import_smoke",
      "    steps:",
      "      - run: echo needs.iehp_assessment_import_smoke.result",
      "      - run: echo needs.playwright_env_readiness.result",
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

  test("session note measurement edit keeps correct trials within opportunities", () => {
    const scriptPath = path.join(repoRoot, "scripts", "playwright-session-note-measurement-roundtrip.ts");
    const content = readFileSync(scriptPath, "utf8");

    expect(content).toContain('`#goal-measurement-opportunities-${goalId}`');
    expect(content).toContain("resolveOpportunityCountForMetric(updatedMetric, currentOpportunities)");
    expect(content).toContain("edit upsert failed: HTTP ${res.status()} body=");

    expect(resolveOpportunityCountForMetric(8, 7)).toBe(8);
    expect(resolveOpportunityCountForMetric(8, 9)).toBe(9);
    expect(resolveOpportunityCountForMetric(8, Number.NaN)).toBe(8);
  });

  test("session note measurement activates the plan target before requiring target-trial controls", () => {
    const scriptPath = path.join(repoRoot, "scripts", "playwright-session-note-measurement-roundtrip.ts");
    const content = readFileSync(scriptPath, "utf8");
    const goalCaptureScope = 'locator(`[data-testid="session-modal-goal-capture-${goalId}"]`)';
    const selectPlanTarget = 'goalCaptureRow.getByRole("button", { name: /^Use plan target/i })';
    const targetLocator = 'const targetLocator = dialog.locator(`#goal-target-${goalId}-0`)';
    const clickPlanTarget = "await usePlanTargetButton.first().click();";

    expect(content).toContain(goalCaptureScope);
    expect(content).toContain(selectPlanTarget);
    expect(content).toContain(targetLocator);
    expect(content).toContain(clickPlanTarget);
    expect(content).not.toContain("await targetLocator.waitFor({ state: \"visible\", timeout: 30_000 })");
    expect(content.indexOf(clickPlanTarget)).toBeLessThan(content.indexOf("const metricInput ="));
  });

  test("session note measurement filters the crowded schedule to its booked actor and client", () => {
    const scriptPath = path.join(repoRoot, "scripts", "playwright-session-note-measurement-roundtrip.ts");
    const content = readFileSync(scriptPath, "utf8");
    const helper = readFileSync(
      path.join(repoRoot, "scripts", "lib", "playwright-schedule-session-modal.ts"),
      "utf8",
    );

    expect(helper).toContain("page.locator(`select${selector}`).first()");
    expect(helper).toContain('selectExactScheduleFilter(page, "#therapist-filter", target.therapistId');
    expect(helper).toContain('selectExactScheduleFilter(page, "#client-filter", target.clientId)');
    expect(content).toContain("openScheduleSessionModalFromCalendar(activePage, scheduleUrl, booked,");
    expect(helper.indexOf('selectExactScheduleFilter(page, "#client-filter", target.clientId)')).toBeLessThan(
      helper.indexOf('page.locator(`[data-session-id="${target.sessionId}"]`)'),
    );
  });

  test("session note measurement opens collapsed schedule filters before selecting options", () => {
    const scriptPath = path.join(repoRoot, "scripts", "playwright-session-note-measurement-roundtrip.ts");
    const content = readFileSync(scriptPath, "utf8");
    const helper = readFileSync(
      path.join(repoRoot, "scripts", "lib", "playwright-schedule-session-modal.ts"),
      "utf8",
    );

    expect(helper).toContain('filter({ has: page.locator("#client-filter") })');
    expect(helper).toContain('locator(":scope > summary")');
    expect(helper).toContain('await openScheduleFiltersIfCollapsed(page)');
    expect(helper.indexOf("await openScheduleFiltersIfCollapsed(page)")).toBeLessThan(
      helper.indexOf('selectExactScheduleFilter(page, "#therapist-filter", target.therapistId'),
    );
    expect(content).toContain("openScheduleSessionModalFromCalendar(activePage, scheduleUrl, booked,");
  });

  test("all rendered Schedule session flows use the shared scoped modal opener", () => {
    const helperPath = path.join(repoRoot, "scripts", "lib", "playwright-schedule-session-modal.ts");
    const helper = readFileSync(helperPath, "utf8");

    expect(helper).toContain('select#client-filter');
    expect(helper).toContain('selectExactScheduleFilter(page, "#therapist-filter", target.therapistId');
    expect(helper).toContain('button[aria-label="Week view"]');
    expect(helper).toContain('filter({ has: page.locator("#client-filter") })');
    expect(helper.indexOf('select#client-filter')).toBeLessThan(
      helper.indexOf('page.locator(`[data-session-id="${target.sessionId}"]`)'),
    );

    for (const scriptName of [
      "playwright-session-lifecycle.ts",
      "playwright-session-note-measurement-roundtrip.ts",
      "playwright-session-capture-adhoc-upsert.ts",
      "playwright-schedule-blocked-close.ts",
    ]) {
      const content = readFileSync(path.join(repoRoot, "scripts", scriptName), "utf8");
      expect(content).toContain('from "./lib/playwright-schedule-session-modal"');
      expect(content).toContain("openScheduleSessionModalFromCalendar(");
      expect(content).toContain("allowLockedTherapist: !isTruthy(process.env.PW_ASSERT_ALREADY_STARTED_UI)");
      expect(content).not.toContain("const openEditSessionModalFromCalendar = async");
    }

    const blockedClose = readFileSync(path.join(repoRoot, "scripts", "playwright-schedule-blocked-close.ts"), "utf8");
    expect(blockedClose).not.toContain("scheduleModal=edit");
    expect(blockedClose).toContain('openScheduleSessionModalFromCalendar(activePage, `${base}/schedule`, booked,');
  });

  test("required Schedule session navigation does not block on global network idle", () => {
    for (const relativePath of [
      "scripts/lib/playwright-inprogress-session-setup.ts",
      "scripts/lib/playwright-schedule-session-modal.ts",
      "scripts/playwright-session-lifecycle.ts",
      "scripts/playwright-session-note-measurement-roundtrip.ts",
      "scripts/playwright-session-capture-adhoc-upsert.ts",
    ]) {
      const content = readFileSync(path.join(repoRoot, relativePath), "utf8");
      expect(content, relativePath).not.toMatch(
        /\b(?:page|activePage)\.goto\([\s\S]{0,220}?waitUntil:\s*["']networkidle["']/,
      );
    }
  });

  test("session lifecycle records a controlled Schedule state before rejecting credentials", () => {
    const lifecycle = readFileSync(
      path.join(repoRoot, "scripts", "playwright-session-lifecycle.ts"),
      "utf8",
    );

    expect(lifecycle).toContain("classifyScheduleReadinessFailure(attemptPage)");
    expect(lifecycle).toContain("scheduleState=${scheduleState}");
    expect(lifecycle.indexOf("classifyScheduleReadinessFailure(attemptPage)")).toBeLessThan(
      lifecycle.indexOf("await attemptContext.close()"),
    );
    expect(lifecycle).not.toContain("document.body.innerText");
  });

  test("synthetic BCBA provisioning keeps authenticated preflight and unconditional cleanup contracts", () => {
    const workflow = normalizeLf(readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8"));
    const provisionStep = workflow.match(/- name: Provision synthetic BCBA smoke actor[\s\S]*?run: npx tsx scripts\/provision-ci-smoke-bcba\.ts\n/)?.[0] ?? "";
    const cleanupStart = workflow.indexOf("- name: Cleanup synthetic BCBA smoke actor");
    const cleanupEnd = workflow.indexOf("- name: Cleanup auth smoke admin", cleanupStart);
    const cleanupStep = cleanupStart >= 0 && cleanupEnd > cleanupStart
      ? workflow.slice(cleanupStart, cleanupEnd)
      : "";

    expect(provisionStep).toContain("SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}");
    expect(cleanupStep).toContain("if: always()");
  });

  test("auth browser smoke uses a run-owned therapist persona with unconditional cleanup", () => {
    const workflow = normalizeLf(readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8"));
    const provisionStart = workflow.indexOf("- name: Provision synthetic therapist smoke actor");
    const provisionEnd = workflow.indexOf("- name: Provision synthetic BCBA smoke actor", provisionStart);
    const provisionStep = provisionStart >= 0 && provisionEnd > provisionStart
      ? workflow.slice(provisionStart, provisionEnd)
      : "";
    const cleanupStart = workflow.indexOf("- name: Cleanup synthetic therapist smoke actor");
    const cleanupEnd = workflow.indexOf("- name: Cleanup auth smoke admin", cleanupStart);
    const cleanupStep = cleanupStart >= 0 && cleanupEnd > cleanupStart
      ? workflow.slice(cleanupStart, cleanupEnd)
      : "";
    const sessionGateStart = workflow.indexOf("- name: Session browser smoke gate");
    const sessionGateEnd = workflow.indexOf("- name: BCBA session acceptance proof", sessionGateStart);
    const sessionGate = sessionGateStart >= 0 && sessionGateEnd > sessionGateStart
      ? workflow.slice(sessionGateStart, sessionGateEnd)
      : "";

    expect(provisionStep).toContain("SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}");
    expect(provisionStep).toContain("CI_SMOKE_THERAPIST_SCOPE_EMAIL: ${{ secrets.PW_SCHEDULE_EMAIL }}");
    expect(provisionStep).toContain("run: npx tsx scripts/provision-ci-smoke-therapist.ts");
    expect(sessionGate).not.toContain("PW_THERAPIST_EMAIL: ${{ secrets.PW_THERAPIST_EMAIL }}");
    expect(sessionGate).not.toContain("PW_THERAPIST_PASSWORD: ${{ secrets.PW_THERAPIST_PASSWORD }}");
    expect(cleanupStep).toContain("if: always()");
    expect(cleanupStep).toContain("run: npx tsx scripts/provision-ci-smoke-therapist.ts --cleanup");
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

  test("accepts workflow aggregate session smoke runner semantics", () => {
    const fixtureRoot = createFixture(
      `tsx scripts/playwright-ci-runner.ts ${runnerChildren.join(" ")}`,
      ["npm run ci:playwright:session-smoke"],
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
