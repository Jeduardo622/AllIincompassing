import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "check-session-deploy-safety.mjs");

const tempDirs: string[] = [];

const write = (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
};

const ciWorkflow = ({
  mergeGroupHandling = `          elif [ "\${GITHUB_EVENT_NAME}" = "merge_group" ]; then
            base_sha="\${{ github.event.merge_group.base_sha }}"
            head_sha="\${{ github.event.merge_group.head_sha }}"`,
  policyExtra = "",
  deployRestriction = "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  deployNeeds = [
    "policy",
    "tenant_safety",
    "runtime_migration_parity",
    "start_session_runtime_contract",
    "lint_typecheck",
    "unit_tests",
    "build",
  ],
  deployRun = "npm run ci:deploy:session-edge-bundle",
  authNeeds = ["policy", "change_scope", "deploy_session_edge"],
  authIf = "always() && needs.change_scope.outputs.docs_only != 'true' && (github.event_name != 'push' || github.ref != 'refs/heads/main' || needs.deploy_session_edge.result == 'success')",
  authExtra = "",
  workflowComment = "",
  ciGateNeeds = [
    "change_scope",
    "docs_guard",
    "policy",
    "tenant_safety",
    "runtime_migration_parity",
    "start_session_runtime_contract",
    "deploy_session_edge",
    "lint_typecheck",
    "unit_tests",
    "build",
    "tier0_browser",
    "auth_browser_smoke",
    "playwright_env_readiness",
    "iehp_assessment_import_smoke",
  ],
  ciGateChecks = [
    "[ \"${TENANT_SAFETY_RESULT}\" = \"success\" ] || failed+=(\"tenant-safety=${TENANT_SAFETY_RESULT}\")",
    "[ \"${RUNTIME_PARITY_RESULT}\" = \"success\" ] || failed+=(\"runtime-migration-parity=${RUNTIME_PARITY_RESULT}\")",
    "[ \"${START_SESSION_RUNTIME_CONTRACT_RESULT}\" = \"success\" ] || failed+=(\"start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}\")",
    "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${DEPLOY_SESSION_EDGE_RESULT}\" != \"success\" ]; then",
    "failed+=(\"deploy-session-edge=${DEPLOY_SESSION_EDGE_RESULT}\")",
    "fi",
  ],
  ciGateInertText = "",
} = {}) => `name: CI

${workflowComment}

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]
  merge_group:
    branches: [main, develop]

jobs:
  change_scope:
    outputs:
      docs_only: \${{ steps.detect.outputs.docs_only }}
      base_sha: \${{ steps.detect.outputs.base_sha }}
      head_sha: \${{ steps.detect.outputs.head_sha }}
    steps:
      - id: detect
        run: |
          base_sha=""
          head_sha="\${GITHUB_SHA}"
          if [ "\${GITHUB_EVENT_NAME}" = "pull_request" ]; then
            base_sha="\${{ github.event.pull_request.base.sha }}"
            head_sha="\${{ github.event.pull_request.head.sha }}"
          elif [ "\${GITHUB_EVENT_NAME}" = "push" ]; then
            base_sha="\${{ github.event.before }}"
            head_sha="\${GITHUB_SHA}"
${mergeGroupHandling}
          fi
          echo "base_sha=\${base_sha}" >> "\${GITHUB_OUTPUT}"
          echo "head_sha=\${head_sha}" >> "\${GITHUB_OUTPUT}"
          echo "docs_only=false" >> "\${GITHUB_OUTPUT}"

  docs_guard:
    needs: change_scope
    if: needs.change_scope.outputs.docs_only == 'true'
    steps:
      - run: echo docs

  policy:
    needs: change_scope
    if: needs.change_scope.outputs.docs_only != 'true'
    steps:
      - run: npm run ci:secrets
      - run: npm run ci:check-focused
${policyExtra}

  tenant_safety:
    needs: policy
    steps:
      - run: npm run validate:tenant

  runtime_migration_parity:
    needs:
      - policy
      - change_scope
    steps:
      - env:
          MIGRATION_PARITY_BASE_SHA: \${{ needs.change_scope.outputs.base_sha }}
          MIGRATION_PARITY_HEAD_SHA: \${{ needs.change_scope.outputs.head_sha }}
          SUPABASE_DB_URL: \${{ secrets.SUPABASE_DB_URL }}
        run: node scripts/ci/check-runtime-migration-parity.mjs

  start_session_runtime_contract:
    needs: policy
    steps:
      - env:
          SUPABASE_DB_URL: \${{ secrets.SUPABASE_DB_URL }}
        run: node scripts/ci/check-session-runtime-contract.mjs

  deploy_session_edge:
    needs:
${deployNeeds.map((need) => `      - ${need}`).join("\n")}
    if: ${deployRestriction}
    steps:
      - name: Validate session edge deploy prerequisites
        run: node scripts/ci/check-session-edge-deploy-prerequisites.mjs
      - name: Deploy required session edge functions
        run: ${deployRun}

  lint_typecheck:
    needs: policy
    steps:
      - run: npm run lint
      - run: npm run typecheck

  unit_tests:
    needs: policy
    steps:
      - run: npm run test:ci

  build:
    needs:
      - lint_typecheck
      - unit_tests
    steps:
      - run: npm run build

  tier0_browser:
    needs:
      - build
      - change_scope
    steps:
      - run: npm run test:routes:tier0

  auth_browser_smoke:
    needs:
${authNeeds.map((need) => `      - ${need}`).join("\n")}
    if: ${authIf}
    steps:
      - run: npm run playwright:auth
${authExtra}

  playwright_env_readiness:
    needs:
      - policy
      - change_scope
    steps:
      - run: npm run ci:playwright:env-readiness -- --fail-on-blocking

  iehp_assessment_import_smoke:
    needs:
      - policy
      - change_scope
    steps:
      - run: npm run playwright:iehp-assessment-import-smoke

  ci_gate:
    if: always()
    needs:
${ciGateNeeds.map((need) => `      - ${need}`).join("\n")}
    steps:
      - env:
          GITHUB_EVENT_NAME: \${{ github.event_name }}
          GITHUB_REF: \${{ github.ref }}
          DOCS_ONLY: \${{ needs.change_scope.outputs.docs_only }}
          DOCS_GUARD_RESULT: \${{ needs.docs_guard.result }}
          POLICY_RESULT: \${{ needs.policy.result }}
          TENANT_SAFETY_RESULT: \${{ needs.tenant_safety.result }}
          RUNTIME_PARITY_RESULT: \${{ needs.runtime_migration_parity.result }}
          START_SESSION_RUNTIME_CONTRACT_RESULT: \${{ needs.start_session_runtime_contract.result }}
          DEPLOY_SESSION_EDGE_RESULT: \${{ needs.deploy_session_edge.result }}
          LINT_RESULT: \${{ needs.lint_typecheck.result }}
          UNIT_RESULT: \${{ needs.unit_tests.result }}
          BUILD_RESULT: \${{ needs.build.result }}
          TIER0_RESULT: \${{ needs.tier0_browser.result }}
          AUTH_SMOKE_RESULT: \${{ needs.auth_browser_smoke.result }}
          PLAYWRIGHT_ENV_RESULT: \${{ needs.playwright_env_readiness.result }}
          IEHP_IMPORT_SMOKE_RESULT: \${{ needs.iehp_assessment_import_smoke.result }}
        run: |
          failed=()
${ciGateChecks.map((line) => `          ${line}`).join("\n")}
${ciGateInertText}
          [ "\${AUTH_SMOKE_RESULT}" = "success" ] || failed+=("auth-browser-smoke=\${AUTH_SMOKE_RESULT}")
          [ "\${PLAYWRIGHT_ENV_RESULT}" = "success" ] || failed+=("playwright-env-readiness=\${PLAYWRIGHT_ENV_RESULT}")
          [ "\${IEHP_IMPORT_SMOKE_RESULT}" = "success" ] || failed+=("iehp-assessment-import-smoke=\${IEHP_IMPORT_SMOKE_RESULT}")
          if [ "\${#failed[@]}" -gt 0 ]; then
            exit 1
          fi
`;

const tenantSafetyWorkflow = ({
  testRun = "npm test",
  testContinueOnError = false,
  includeTestEnvironment = true,
} = {}) => `name: tenant-safety

on:
  pull_request:
    paths:
      - 'scripts/ci/**'
      - '.github/workflows/**'
  push:
    branches: [main]
    paths:
      - 'scripts/ci/**'
      - '.github/workflows/**'

jobs:
  tenant-safety:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm run validate:tenant
      - run: npm run lint
      - run: npm run typecheck
      - run: ${testRun}
${includeTestEnvironment ? `        env:
          VITE_SUPABASE_URL: test-url
          SUPABASE_URL: test-url
          VITE_SUPABASE_ANON_KEY: test-anon
          SUPABASE_ANON_KEY: test-anon
          SUPABASE_SERVICE_ROLE_KEY: test-service
` : ""}
${testContinueOnError ? "        continue-on-error: true" : ""}
`;

const makeFixture = (options?: {
  ci?: Parameters<typeof ciWorkflow>[0];
  tenant?: Parameters<typeof tenantSafetyWorkflow>[0];
}) => {
  const root = mkdtempSync(path.join(tmpdir(), "session-deploy-safety-"));
  tempDirs.push(root);
  write(root, ".github/workflows/ci.yml", ciWorkflow(options?.ci));
  write(root, ".github/workflows/tenant-safety.yml", tenantSafetyWorkflow(options?.tenant));
  return root;
};

const runCheck = (cwd: string) =>
  spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });

describe("check-session-deploy-safety", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("accepts the dedicated main-push deploy DAG with read-only PR jobs", () => {
    const fixtureRoot = makeFixture();
    const result = runCheck(fixtureRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Session deploy safety check passed.");
  });

  test("requires merge_group change-scope outputs to use nonempty event SHAs", () => {
    const fixtureRoot = makeFixture({
      ci: {
        mergeGroupHandling: "",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("change_scope must map merge_group base_sha and head_sha from the merge-group event");
  });

  test("ignores comments and inert run-block text when counting real deploy steps", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment: "# run: npm run ci:deploy:session-edge-bundle",
        authExtra: `      - run: |
          printf '%s\\n' 'run: npm run ci:deploy:session-edge-bundle'`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status, result.stderr).toBe(0);
  });

  test("does not accept a comment or inert run-block string as the deploy step", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployRun: "echo deploy intentionally omitted",
        workflowComment: "# run: npm run ci:deploy:session-edge-bundle",
        authExtra: `      - run: |
          echo 'npm run ci:deploy:session-edge-bundle'`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exactly one real session edge deploy run step");
  });

  test("rejects deploy run steps with trailing shell commands", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployRun: `|
          npm run ci:deploy:session-edge-bundle
          true`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exactly one real session edge deploy run step");
  });

  test("rejects deploy commands outside deploy_session_edge", () => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: "      - run: npm run ci:deploy:session-edge-bundle",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must contain exactly one session edge deploy command");
  });

  test("rejects direct node deploy script invocations outside deploy_session_edge", () => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: "      - run: node scripts/ci/deploy-session-edge-bundle.mjs",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must contain exactly one session edge deploy command");
  });

  test("rejects raw supabase functions deploy invocations outside deploy_session_edge", () => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: "      - run: supabase functions deploy sessions-book --project-ref wnnjeqheqxxyrgsjmygy",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must contain exactly one session edge deploy command");
  });

  test("rejects deploy_session_edge when it is not restricted to pushes on refs/heads/main", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployRestriction: "github.event_name == 'push'",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_session_edge must be restricted to push on refs/heads/main");
  });

  test("rejects deploy_session_edge when its prerequisite set contains extra jobs", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployNeeds: [
          "policy",
          "tenant_safety",
          "runtime_migration_parity",
          "start_session_runtime_contract",
          "lint_typecheck",
          "unit_tests",
          "build",
          "change_scope",
        ],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_session_edge needs must exactly equal");
  });

  test.each([
    "policy",
    "tenant_safety",
    "runtime_migration_parity",
    "start_session_runtime_contract",
    "lint_typecheck",
    "unit_tests",
    "build",
  ])("rejects deploy_session_edge when prerequisite %s is removed", (missingNeed) => {
    const fixtureRoot = makeFixture({
      ci: {
        deployNeeds: [
          "policy",
          "tenant_safety",
          "runtime_migration_parity",
          "start_session_runtime_contract",
          "lint_typecheck",
          "unit_tests",
          "build",
        ].filter((need) => need !== missingNeed),
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_session_edge needs must exactly equal");
  });

  test("rejects auth_browser_smoke when it does not depend on deploy_session_edge for main pushes", () => {
    const fixtureRoot = makeFixture({
      ci: {
        authNeeds: ["policy", "change_scope"],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("auth_browser_smoke must need deploy_session_edge");
  });

  test("rejects auth_browser_smoke when its main-push deploy-success guard is weakened", () => {
    const fixtureRoot = makeFixture({
      ci: {
        authIf: "needs.change_scope.outputs.docs_only != 'true' && github.event_name != 'push'",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("auth_browser_smoke must use the exact read-only/non-main and successful-main-deploy condition");
  });

  test("rejects ci-gate when deploy and tenant results are not part of required semantics", () => {
    const fixtureRoot = makeFixture({
      ci: {
        ciGateNeeds: [
          "change_scope",
          "docs_guard",
          "policy",
          "lint_typecheck",
          "unit_tests",
          "build",
          "tier0_browser",
          "auth_browser_smoke",
          "playwright_env_readiness",
          "iehp_assessment_import_smoke",
        ],
        ciGateChecks: [],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ci_gate must include tenant_safety, runtime_migration_parity, start_session_runtime_contract, and deploy_session_edge");
  });

  test("does not accept commented or echoed ci-gate result checks", () => {
    const fixtureRoot = makeFixture({
      ci: {
        ciGateChecks: [],
        ciGateInertText: `          # [ "\${TENANT_SAFETY_RESULT}" = "success" ] || failed+=("tenant-safety=\${TENANT_SAFETY_RESULT}")
          echo '[ "\${RUNTIME_PARITY_RESULT}" = "success" ] || failed+=("runtime-migration-parity=\${RUNTIME_PARITY_RESULT}")'
          echo '[ "\${START_SESSION_RUNTIME_CONTRACT_RESULT}" = "success" ] || failed+=("start-session-runtime-contract=\${START_SESSION_RUNTIME_CONTRACT_RESULT}")'
          echo 'deploy-session-edge=\${DEPLOY_SESSION_EDGE_RESULT}'`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ci_gate must enforce tenant_safety result failure");
  });

  test("rejects masked tenant-safety test failures", () => {
    const fixtureRoot = makeFixture({
      tenant: {
        testRun: "npm test || echo \"tests skipped\"",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tenant-safety workflow must run `npm test` without masking failures");
  });

  test("rejects tenant-safety npm test steps with continue-on-error enabled", () => {
    const fixtureRoot = makeFixture({
      tenant: {
        testContinueOnError: true,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tenant-safety workflow must run `npm test` without masking failures");
  });

  test("rejects tenant-safety npm test steps without the required Supabase test environment", () => {
    const root = makeFixture({
      tenant: {
        includeTestEnvironment: false,
      },
    });

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "tenant-safety workflow must map the required Supabase test environment",
    );
  });
});
