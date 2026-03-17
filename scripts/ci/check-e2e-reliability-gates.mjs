import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const POLICY_PATH = path.join(ROOT, "tests", "reliability", "policy.json");
const CYPRESS_CONFIG_PATH = path.join(ROOT, "cypress.config.cjs");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const ROUTES_INTEGRITY_PATH = path.join(ROOT, "cypress", "e2e", "routes_integrity.cy.ts");
const ROLE_ACCESS_PATH = path.join(ROOT, "cypress", "e2e", "role_access.cy.ts");
const CYPRESS_COMMANDS_PATH = path.join(ROOT, "cypress", "support", "commands.ts");
const CRITICAL_PLAYWRIGHT_SCRIPTS = [
  path.join(ROOT, "scripts", "playwright-auth-smoke.ts"),
  path.join(ROOT, "scripts", "playwright-schedule-conflict.ts"),
  path.join(ROOT, "scripts", "playwright-therapist-onboarding.ts"),
  path.join(ROOT, "scripts", "playwright-therapist-authorization.ts"),
  path.join(ROOT, "scripts", "playwright-session-lifecycle.ts"),
];

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const run = async () => {
  const errors = [];
  const warnings = [];
  const policy = await readJson(POLICY_PATH);
  const packageJson = await readJson(PACKAGE_JSON_PATH);
  const cypressConfig = await readFile(CYPRESS_CONFIG_PATH, "utf8");
  const routesIntegrity = await readFile(ROUTES_INTEGRITY_PATH, "utf8");
  const roleAccess = await readFile(ROLE_ACCESS_PATH, "utf8");
  const cypressCommands = await readFile(CYPRESS_COMMANDS_PATH, "utf8");

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
  if (!ciPlaywright.includes("playwright:preflight")) {
    errors.push("package.json script ci:playwright must start with playwright:preflight.");
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

  const scheduleRoleContract = "roles: ['therapist', 'admin', 'super_admin']";
  if (!routesIntegrity.includes(scheduleRoleContract)) {
    errors.push("cypress/e2e/routes_integrity.cy.ts must align /schedule role coverage to therapist/admin/super_admin.");
  }
  if (!roleAccess.includes(scheduleRoleContract)) {
    errors.push("cypress/e2e/role_access.cy.ts must align /schedule role coverage to therapist/admin/super_admin.");
  }

  if (!roleAccess.includes("cy.intercept('GET', '**/api/runtime-config').as('runtimeConfig');")) {
    errors.push("cypress/e2e/role_access.cy.ts must alias /api/runtime-config for deterministic deep-link checks.");
  }
  if (!roleAccess.includes("cy.wait('@runtimeConfig');")) {
    errors.push("cypress/e2e/role_access.cy.ts must wait for runtime config before allowed-route assertions.");
  }
  if (!routesIntegrity.includes("cy.intercept('GET', '**/api/runtime-config').as('runtimeConfig');")) {
    errors.push("cypress/e2e/routes_integrity.cy.ts must alias /api/runtime-config for deterministic route bootstrap.");
  }
  if (!routesIntegrity.includes("cy.wait('@runtimeConfig');")) {
    errors.push("cypress/e2e/routes_integrity.cy.ts must wait for runtime config before route assertions.");
  }
  if (!cypressCommands.includes("cy.intercept('GET', '**/api/runtime-config').as('runtimeConfigBootstrap');")) {
    errors.push("cypress/support/commands.ts must alias /api/runtime-config during login bootstrap.");
  }
  if (!cypressCommands.includes("cy.wait('@runtimeConfigBootstrap');")) {
    errors.push("cypress/support/commands.ts must wait for runtime config before login form interactions.");
  }

  if (routesIntegrity.includes("interceptedRequests")) {
    errors.push("cypress/e2e/routes_integrity.cy.ts should avoid shared interceptedRequests buffers in tier-0 gate.");
  }
  if (roleAccess.includes("interceptedRequests")) {
    errors.push("cypress/e2e/role_access.cy.ts should avoid shared interceptedRequests buffers in tier-0 gate.");
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
