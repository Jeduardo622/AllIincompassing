import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const POLICY_PATH = path.join(ROOT, "tests", "reliability", "policy.json");
const CYPRESS_CONFIG_PATH = path.join(ROOT, "cypress.config.cjs");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const ROUTE_SCENARIOS_PATH = path.join(ROOT, "cypress", "support", "routeScenarios.ts");
const ROUTE_SPEC_PATHS = [
  path.join(ROOT, "cypress", "e2e", "routes_public.cy.ts"),
  path.join(ROOT, "cypress", "e2e", "routes_client.cy.ts"),
  path.join(ROOT, "cypress", "e2e", "routes_schedule.cy.ts"),
  path.join(ROOT, "cypress", "e2e", "routes_admin.cy.ts"),
  path.join(ROOT, "cypress", "e2e", "routes_auth.cy.ts"),
];
const CYPRESS_COMMANDS_PATH = path.join(ROOT, "cypress", "support", "commands.ts");
const CI_WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "ci.yml");
const SUPABASE_PREVIEW_WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "supabase-preview.yml");
const ROLLBACK_DRILL_WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "rollback-drill.yml");
const CRITICAL_PLAYWRIGHT_SCRIPTS = [
  path.join(ROOT, "scripts", "playwright-auth-smoke.ts"),
  path.join(ROOT, "scripts", "playwright-schedule-conflict.ts"),
  path.join(ROOT, "scripts", "playwright-therapist-onboarding.ts"),
  path.join(ROOT, "scripts", "playwright-therapist-authorization.ts"),
  path.join(ROOT, "scripts", "playwright-session-lifecycle.ts"),
  path.join(ROOT, "scripts", "playwright-session-no-show.ts"),
  path.join(ROOT, "scripts", "playwright-session-complete.ts"),
  path.join(ROOT, "scripts", "playwright-schedule-blocked-close.ts"),
  path.join(ROOT, "scripts", "playwright-session-note-measurement-roundtrip.ts"),
  path.join(ROOT, "scripts", "playwright-iehp-assessment-import-smoke.ts"),
];

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const parseCiPlaywrightRunner = (script) => {
  const tokens = script.trim().split(/\s+/).filter(Boolean);
  const runnerIndex = tokens.findIndex((token) => token === "scripts/playwright-ci-runner.ts");
  return {
    tokens,
    runnerIndex,
    runnerCommand: runnerIndex > 0 ? tokens[runnerIndex - 1] : "",
    children: runnerIndex >= 0 ? tokens.slice(runnerIndex + 1) : [],
  };
};

const childIndex = (children, scriptName) => children.indexOf(scriptName);

const ciPlaywrightRunnerHasChild = (runner, scriptName) => childIndex(runner.children, scriptName) !== -1;

const ciWorkflowRunsPlaywrightScript = (workflow, scriptName) =>
  workflow.includes(`npm run ${scriptName}`) || workflow.includes("npm run ci:playwright");

const extractWorkflowJob = (workflow, jobName) => {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) {
    return "";
  }

  const nextJob = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, nextJob === -1 ? lines.length : nextJob).join("\n");
};

const run = async () => {
  const errors = [];
  const warnings = [];
  const policy = await readJson(POLICY_PATH);
  const packageJson = await readJson(PACKAGE_JSON_PATH);
  const cypressConfig = await readFile(CYPRESS_CONFIG_PATH, "utf8");
  const routeScenarios = await readFile(ROUTE_SCENARIOS_PATH, "utf8");
  const routeSpecs = await Promise.all(ROUTE_SPEC_PATHS.map((specPath) => readFile(specPath, "utf8")));
  const combinedRouteSpecs = routeSpecs.join("\n");
  const cypressCommands = await readFile(CYPRESS_COMMANDS_PATH, "utf8");
  const ciWorkflow = await readFile(CI_WORKFLOW_PATH, "utf8");
  const authBrowserSmokeJob = extractWorkflowJob(ciWorkflow, "auth_browser_smoke");
  const supabasePreviewWorkflow = await readFile(SUPABASE_PREVIEW_WORKFLOW_PATH, "utf8");
  const rollbackDrillWorkflow = await readFile(ROLLBACK_DRILL_WORKFLOW_PATH, "utf8");

  if (!policy?.e2e) {
    errors.push("tests/reliability/policy.json is missing required e2e contract section.");
  } else {
    if (policy.e2e.maxSkippedCriticalFlows !== 0) {
      errors.push("e2e.maxSkippedCriticalFlows must remain 0.");
    }
    if (policy.e2e.retryBudget?.cypressRunMode !== 0 || policy.e2e.retryBudget?.playwright !== 0) {
      errors.push("e2e retry budgets must remain 0 for deterministic critical-path runs.");
    }
    if (typeof policy.e2e.tier0PassRatePctFloor !== "number" || policy.e2e.tier0PassRatePctFloor < 99) {
      errors.push("e2e.tier0PassRatePctFloor must be set to at least 99.");
    }
  }

  if (/retries\s*:\s*[1-9]/.test(cypressConfig)) {
    errors.push("cypress.config.cjs configures retries > 0 which violates retry budget.");
  }

  const scripts = packageJson?.scripts ?? {};
  const ciPlaywright = String(scripts["ci:playwright"] ?? "");
  const ciPlaywrightRunner = parseCiPlaywrightRunner(ciPlaywright);
  if (ciPlaywrightRunner.runnerIndex < 0 || ciPlaywrightRunner.runnerCommand !== "tsx") {
    errors.push("package.json script ci:playwright must invoke scripts/playwright-ci-runner.ts through tsx.");
  }
  if (ciPlaywrightRunner.tokens.includes("&&") || ciPlaywrightRunner.tokens.includes("npm")) {
    errors.push("package.json script ci:playwright must use the attributed runner, not an npm shell chain.");
  }
  if (ciPlaywrightRunner.runnerIndex !== 1 || ciPlaywrightRunner.tokens[0] !== "tsx") {
    errors.push("package.json script ci:playwright must start with tsx scripts/playwright-ci-runner.ts.");
  }
  if (ciPlaywrightRunner.children[0] !== "playwright:preflight") {
    errors.push("package.json script ci:playwright runner arguments must start with playwright:preflight.");
  }
  if (childIndex(ciPlaywrightRunner.children, "playwright:session-no-show") === -1) {
    errors.push("package.json script ci:playwright runner arguments must include playwright:session-no-show for explicit no-show terminal coverage.");
  }
  if (childIndex(ciPlaywrightRunner.children, "playwright:session-complete") === -1) {
    errors.push("package.json script ci:playwright runner arguments must include playwright:session-complete for completed terminal coverage.");
  }
  if (
    childIndex(ciPlaywrightRunner.children, "playwright:session-no-show") !== -1 &&
    childIndex(ciPlaywrightRunner.children, "playwright:session-complete") !== -1 &&
    childIndex(ciPlaywrightRunner.children, "playwright:session-complete") < childIndex(ciPlaywrightRunner.children, "playwright:session-no-show")
  ) {
    errors.push("package.json script ci:playwright runner arguments must run playwright:session-no-show before playwright:session-complete.");
  }
  if (childIndex(ciPlaywrightRunner.children, "playwright:session-note-measurement-roundtrip") === -1) {
    errors.push("package.json script ci:playwright runner arguments must include playwright:session-note-measurement-roundtrip.");
  }
  if (
    childIndex(ciPlaywrightRunner.children, "playwright:session-complete") !== -1 &&
    childIndex(ciPlaywrightRunner.children, "playwright:session-note-measurement-roundtrip") !== -1 &&
    childIndex(ciPlaywrightRunner.children, "playwright:session-note-measurement-roundtrip") < childIndex(ciPlaywrightRunner.children, "playwright:session-complete")
  ) {
    errors.push("package.json script ci:playwright runner arguments must run playwright:session-complete before playwright:session-note-measurement-roundtrip.");
  }
  if (
    childIndex(ciPlaywrightRunner.children, "playwright:schedule-blocked-close") !== -1 &&
    childIndex(ciPlaywrightRunner.children, "playwright:session-note-measurement-roundtrip") !== -1 &&
    childIndex(ciPlaywrightRunner.children, "playwright:session-note-measurement-roundtrip") < childIndex(ciPlaywrightRunner.children, "playwright:schedule-blocked-close")
  ) {
    errors.push("package.json script ci:playwright runner arguments must run playwright:schedule-blocked-close before playwright:session-note-measurement-roundtrip.");
  }
  if (!scripts["playwright:preflight"]) {
    errors.push("package.json is missing playwright:preflight script.");
  }

  for (const scriptPath of CRITICAL_PLAYWRIGHT_SCRIPTS) {
    const content = await readFile(scriptPath, "utf8");
    if (/skip(ped|s)?/i.test(content) && /playwright/i.test(content)) {
      warnings.push(`Potential skip language found in ${path.relative(ROOT, scriptPath)}. Verify intent is not soft-skipping.`);
    }
    if (/smoke skipped/i.test(content)) {
      errors.push(`${path.relative(ROOT, scriptPath)} contains "smoke skipped" fallback text.`);
    }
  }

  const scheduleRoleContract = 'roles: ["therapist", "admin", "super_admin"]';
  if (!routeScenarios.includes(scheduleRoleContract)) {
    errors.push("cypress/support/routeScenarios.ts must align /schedule role coverage to therapist/admin/super_admin.");
  }
  if (!combinedRouteSpecs.includes("runRoleMatrix")) {
    errors.push("split Cypress route specs must use runRoleMatrix for deterministic role coverage.");
  }

  if (!routeScenarios.includes('cy.intercept("GET", "**/api/runtime-config").as("runtimeConfig");')) {
    errors.push("cypress/support/routeScenarios.ts must alias /api/runtime-config for deterministic route checks.");
  }
  if (!routeScenarios.includes('cy.wait("@runtimeConfig");')) {
    errors.push("cypress/support/routeScenarios.ts must wait for runtime config before route assertions.");
  }
  if (!cypressCommands.includes("cy.intercept('GET', '**/api/runtime-config').as('runtimeConfigBootstrap');")) {
    errors.push("cypress/support/commands.ts must alias /api/runtime-config during login bootstrap.");
  }
  if (!cypressCommands.includes("cy.wait('@runtimeConfigBootstrap');")) {
    errors.push("cypress/support/commands.ts must wait for runtime config before login form interactions.");
  }

  if (!ciWorkflow.includes("Record tier-0 evidence")) {
    errors.push(".github/workflows/ci.yml must record tier-0 evidence artifacts for success/failure runs.");
  }
  if (!ciWorkflow.includes("Record auth smoke evidence")) {
    errors.push(".github/workflows/ci.yml must record auth smoke evidence artifacts for success/failure runs.");
  }
  if (!ciWorkflow.includes("iehp-assessment-import-smoke")) {
    errors.push(".github/workflows/ci.yml must include the IEHP assessment import smoke gate.");
  }
  if (!ciWorkflow.includes("npm run playwright:iehp-assessment-import-smoke")) {
    errors.push(".github/workflows/ci.yml IEHP assessment import smoke gate must run playwright:iehp-assessment-import-smoke.");
  }
  if (!ciWorkflow.includes("Record IEHP import smoke evidence")) {
    errors.push(".github/workflows/ci.yml must record IEHP import smoke evidence artifacts for success/failure runs.");
  }
  if (!ciWorkflow.includes("needs.iehp_assessment_import_smoke.result")) {
    errors.push(".github/workflows/ci.yml ci-gate must depend on the IEHP assessment import smoke result.");
  }
  if (!ciWorkflowRunsPlaywrightScript(authBrowserSmokeJob, "playwright:session-no-show")) {
    errors.push(".github/workflows/ci.yml auth-browser-smoke gate must run playwright:session-no-show directly or via ci:playwright.");
  }
  if (!ciWorkflowRunsPlaywrightScript(authBrowserSmokeJob, "playwright:session-complete")) {
    errors.push(".github/workflows/ci.yml auth-browser-smoke gate must run playwright:session-complete directly or via ci:playwright.");
  }
  if (!ciWorkflowRunsPlaywrightScript(authBrowserSmokeJob, "playwright:session-note-measurement-roundtrip")) {
    errors.push(
      ".github/workflows/ci.yml auth-browser-smoke gate must run playwright:session-note-measurement-roundtrip directly or via ci:playwright.",
    );
  }
  if (
    authBrowserSmokeJob.includes("npm run playwright:session-no-show") &&
    authBrowserSmokeJob.includes("npm run playwright:session-complete") &&
    authBrowserSmokeJob.indexOf("npm run playwright:session-complete") < authBrowserSmokeJob.indexOf("npm run playwright:session-no-show")
  ) {
    errors.push(".github/workflows/ci.yml must run playwright:session-no-show before playwright:session-complete.");
  }
  if (
    authBrowserSmokeJob.includes("npm run playwright:schedule-blocked-close") &&
    authBrowserSmokeJob.includes("npm run playwright:session-note-measurement-roundtrip") &&
    authBrowserSmokeJob.indexOf("npm run playwright:session-note-measurement-roundtrip") < authBrowserSmokeJob.indexOf("npm run playwright:schedule-blocked-close")
  ) {
    errors.push(".github/workflows/ci.yml must run playwright:schedule-blocked-close before playwright:session-note-measurement-roundtrip.");
  }
  if (
    authBrowserSmokeJob.includes("npm run ci:playwright") &&
    !ciPlaywrightRunnerHasChild(ciPlaywrightRunner, "playwright:schedule-blocked-close")
  ) {
    errors.push(
      ".github/workflows/ci.yml auth-browser-smoke aggregate ci:playwright gate requires playwright:schedule-blocked-close in the runner arguments.",
    );
  }
  if (!ciWorkflow.includes("if: always()")) {
    errors.push(".github/workflows/ci.yml must retain artifacts with if: always() for deterministic evidence collection.");
  }
  if (!supabasePreviewWorkflow.includes("Run preview smoke suite")) {
    errors.push(".github/workflows/supabase-preview.yml must run preview smoke suite for staged deploy validation.");
  }
  if (!rollbackDrillWorkflow.includes("Run rollback drill contract checks")) {
    errors.push(".github/workflows/rollback-drill.yml must execute rollback drill checks and publish evidence.");
  }

  if (routeScenarios.includes("interceptedRequests") || combinedRouteSpecs.includes("interceptedRequests")) {
    errors.push("split Cypress route specs should avoid shared interceptedRequests buffers in tier-0 gate.");
  }

  if (warnings.length > 0) {
    console.warn("E2E reliability gate warnings:");
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.error("E2E reliability gate check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("E2E reliability gate check passed.");
};

run().catch((error) => {
  console.error("E2E reliability gate check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
