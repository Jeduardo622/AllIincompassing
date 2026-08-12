import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { isAiAgentBundlePath } from "../../scripts/ci/check-session-deploy-safety.mjs";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "check-session-deploy-safety.mjs");

const tempDirs: string[] = [];
const AI_AGENT_PATH_PATTERN =
  "^supabase/functions/(ai-agent-optimized/|_shared/(database|auth|org|logging|cors|supabaseEnv|requestAuthHeaders)\\.ts$|lib/http/error\\.ts$)";
const PAYROLL_FUNCTION_SCOPE =
  "sessions-book,sessions-hold,sessions-confirm,sessions-start,sessions-cancel,generate-session-notes-pdf,session-notes-pdf-status,session-notes-pdf-download,programs,goals,goal-targets,program-notes,payroll-timesheets,payroll-administration";
const PAYROLL_ADMINISTRATION_UPSTASH_ENV = `        env:
          UPSTASH_REDIS_REST_URL: \${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: \${{ secrets.UPSTASH_REDIS_REST_TOKEN }}`;
const PAYROLL_ADMINISTRATION_PREREQ_RUN = `|
          set -euo pipefail
          missing=()
          for key in UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN; do
            if [ -z "\${!key:-}" ]; then
              missing+=("\${key}")
            fi
          done
          if [ "\${#missing[@]}" -gt 0 ]; then
            echo "::error::Missing required payroll-administration deploy configuration: \${missing[*]}" >&2
            exit 1
          fi
          node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-administration`;
const PAYROLL_ADMINISTRATION_MAIN_VERIFICATION = `      - name: Verify payroll-administration immutable current main
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_WORKFLOW_SHA: \${{ github.sha }}
          GH_REPOSITORY: \${{ github.repository }}
        run: |
          set -euo pipefail
          live_main_sha="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '.object.sha')"
          if [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then
            echo "::error::Refusing payroll-administration deployment because workflow SHA is not current origin/main." >&2
            exit 1
          fi`;

const write = (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
};

const ciWorkflow = ({
  payrollAdministrationInput = `      activate_payroll_administration:
        description: Explicitly activate the reviewed payroll-administration Edge function
        required: true
        type: boolean
        default: false`,
  mergeGroupHandling = `          elif [ "\${GITHUB_EVENT_NAME}" = "merge_group" ]; then
            base_sha="\${{ github.event.merge_group.base_sha }}"
            head_sha="\${{ github.event.merge_group.head_sha }}"
          elif [ "\${GITHUB_EVENT_NAME}" = "workflow_dispatch" ]; then
            base_sha="\${GITHUB_SHA}^"
            head_sha="\${GITHUB_SHA}"`,
  aiAgentPathPattern = AI_AGENT_PATH_PATTERN,
  unavailableAiAgentChanged = "true",
  aiAgentDiffHandling = `          if [ -z "\${base_sha}" ] || [ "\${base_sha}" = "0000000000000000000000000000000000000000" ]; then
            echo "docs_only=false" >> "\${GITHUB_OUTPUT}"
            echo "ai_agent_changed=${unavailableAiAgentChanged}" >> "\${GITHUB_OUTPUT}"
            exit 0
          fi
          changed_files="$(git diff --name-only "\${base_sha}" "\${head_sha}")"
          if [ -z "\${changed_files}" ]; then
            echo "docs_only=false" >> "\${GITHUB_OUTPUT}"
            echo "ai_agent_changed=false" >> "\${GITHUB_OUTPUT}"
            exit 0
          fi
          ai_agent_changed=false
          while IFS= read -r file; do
            if printf '%s\\n' "\${file}" | grep -Eq '${aiAgentPathPattern}'; then
              ai_agent_changed=true
            fi
          done <<< "\${changed_files}"
          echo "ai_agent_changed=\${ai_agent_changed}" >> "\${GITHUB_OUTPUT}"`,
  policyExtra = "",
  parityScope = PAYROLL_FUNCTION_SCOPE,
  runtimeParityRestriction = "(github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true))",
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
  deployPrereqRun = "node scripts/ci/check-edge-deploy-prerequisites.mjs session-edge",
  deployRun = "npm run ci:deploy:session-edge-bundle",
  fillDocsDeployRun = "npm run ci:deploy:fill-docs-function",
  fillDocsBeforeSessionDeploy = false,
  deployAiAgentRestriction = "github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.change_scope.outputs.ai_agent_changed == 'true'",
  deployAiAgentNeeds = ["deploy_session_edge", "change_scope"],
  deployAiAgentPrereqRun = "node scripts/ci/check-edge-deploy-prerequisites.mjs ai-agent-optimized",
  deployAiAgentRun = "npm run ci:deploy:ai-agent-function",
  deployPayrollRestriction = "github.event_name == 'workflow_dispatch' && inputs.activate_payroll_timesheets == true",
  deployPayrollNeeds = [
    "policy",
    "tenant_safety",
    "runtime_migration_parity",
    "lint_typecheck",
    "unit_tests",
    "build",
  ],
  deployPayrollPrereqRun = "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-timesheets",
  deployPayrollRun = "node scripts/ci/deploy-payroll-timesheets-function.mjs",
  deployPayrollAdministrationRestriction = "github.event_name == 'workflow_dispatch' && inputs.activate_payroll_administration == true && github.ref == 'refs/heads/main'",
  deployPayrollAdministrationUpstashEnv = PAYROLL_ADMINISTRATION_UPSTASH_ENV,
  deployPayrollAdministrationPrereqRun = PAYROLL_ADMINISTRATION_PREREQ_RUN,
  deployPayrollAdministrationMainVerification = PAYROLL_ADMINISTRATION_MAIN_VERIFICATION,
  deployPayrollAdministrationRun = "node scripts/ci/deploy-payroll-administration-function.mjs",
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
    "deploy_ai_agent_edge",
    "deploy_payroll_timesheets",
    "deploy_payroll_administration",
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
    "if { [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ]; } || { [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && { [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ] || [ \"${ACTIVATE_PAYROLL_ADMINISTRATION}\" = \"true\" ]; }; }; then",
    "[ \"${RUNTIME_PARITY_RESULT}\" = \"success\" ] || failed+=(\"runtime-migration-parity=${RUNTIME_PARITY_RESULT}\")",
    "fi",
    "[ \"${START_SESSION_RUNTIME_CONTRACT_RESULT}\" = \"success\" ] || failed+=(\"start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}\")",
    "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${DEPLOY_SESSION_EDGE_RESULT}\" != \"success\" ]; then",
    "failed+=(\"deploy-session-edge=${DEPLOY_SESSION_EDGE_RESULT}\")",
    "fi",
    "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${AI_AGENT_CHANGED}\" = \"true\" ] && [ \"${DEPLOY_AI_AGENT_EDGE_RESULT}\" != \"success\" ]; then",
    "failed+=(\"deploy-ai-agent-edge=${DEPLOY_AI_AGENT_EDGE_RESULT}\")",
    "fi",
    "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_TIMESHEETS_RESULT}\" != \"success\" ]; then",
    "failed+=(\"deploy-payroll-timesheets=${DEPLOY_PAYROLL_TIMESHEETS_RESULT}\")",
    "fi",
    "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_ADMINISTRATION}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_ADMINISTRATION_RESULT}\" != \"success\" ]; then",
    "failed+=(\"deploy-payroll-administration=${DEPLOY_PAYROLL_ADMINISTRATION_RESULT}\")",
    "fi",
  ],
  ciGateInertText = "",
} = {}) => `name: CI

${workflowComment}

on:
  workflow_dispatch:
    inputs:
      activate_payroll_timesheets:
        description: Explicitly activate the reviewed payroll-timesheets Edge function
        required: true
        type: boolean
        default: false
${payrollAdministrationInput}
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
      ai_agent_changed: \${{ steps.detect.outputs.ai_agent_changed }}
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
${aiAgentDiffHandling}
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
        env:
          SUPABASE_FUNCTION_PARITY_SCOPE: "${parityScope}"
${policyExtra}

  tenant_safety:
    needs: policy
    steps:
      - run: npm run validate:tenant

  runtime_migration_parity:
    needs:
      - policy
      - change_scope
${runtimeParityRestriction ? `    if: ${runtimeParityRestriction}
` : ""}\
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
        run: ${deployPrereqRun}
${fillDocsBeforeSessionDeploy ? `      - name: Deploy fill-docs with static templates
        run: ${fillDocsDeployRun}
` : ""}      - name: Deploy required session edge functions
        run: ${deployRun}
${fillDocsBeforeSessionDeploy ? "" : `      - name: Deploy fill-docs with static templates
        run: ${fillDocsDeployRun}
`}
  deploy_ai_agent_edge:
    needs:
${deployAiAgentNeeds.map((need) => `      - ${need}`).join("\n")}
    if: ${deployAiAgentRestriction}
    steps:
      - name: Validate AI agent edge deploy prerequisites
        run: ${deployAiAgentPrereqRun}
      - name: Deploy ai-agent-optimized edge function
        run: ${deployAiAgentRun}

  deploy_payroll_timesheets:
    needs:
${deployPayrollNeeds.map((need) => `      - ${need}`).join("\n")}
    if: ${deployPayrollRestriction}
    steps:
      - name: Validate payroll-timesheets deploy prerequisites
        run: ${deployPayrollPrereqRun}
      - name: Deploy payroll-timesheets edge function
        run: ${deployPayrollRun}

  deploy_payroll_administration:
    needs:
      - policy
      - tenant_safety
      - runtime_migration_parity
      - lint_typecheck
      - unit_tests
      - build
    if: ${deployPayrollAdministrationRestriction}
    steps:
      - name: Validate payroll-administration deploy prerequisites
${deployPayrollAdministrationUpstashEnv}
        run: ${deployPayrollAdministrationPrereqRun}
${deployPayrollAdministrationMainVerification}
      - name: Deploy payroll-administration edge function
        run: ${deployPayrollAdministrationRun}

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
          ACTIVATE_PAYROLL_TIMESHEETS: \${{ inputs.activate_payroll_timesheets || false }}
          ACTIVATE_PAYROLL_ADMINISTRATION: \${{ inputs.activate_payroll_administration || false }}
          DOCS_ONLY: \${{ needs.change_scope.outputs.docs_only }}
          AI_AGENT_CHANGED: \${{ needs.change_scope.outputs.ai_agent_changed }}
          DOCS_GUARD_RESULT: \${{ needs.docs_guard.result }}
          POLICY_RESULT: \${{ needs.policy.result }}
          TENANT_SAFETY_RESULT: \${{ needs.tenant_safety.result }}
          RUNTIME_PARITY_RESULT: \${{ needs.runtime_migration_parity.result }}
          START_SESSION_RUNTIME_CONTRACT_RESULT: \${{ needs.start_session_runtime_contract.result }}
          DEPLOY_SESSION_EDGE_RESULT: \${{ needs.deploy_session_edge.result }}
          DEPLOY_AI_AGENT_EDGE_RESULT: \${{ needs.deploy_ai_agent_edge.result }}
          DEPLOY_PAYROLL_TIMESHEETS_RESULT: \${{ needs.deploy_payroll_timesheets.result }}
          DEPLOY_PAYROLL_ADMINISTRATION_RESULT: \${{ needs.deploy_payroll_administration.result }}
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

  test("rejects workflows that do not expose ai_agent_changed from change_scope", () => {
    const fixtureRoot = makeFixture({
      ci: {
        aiAgentDiffHandling: "",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("change_scope must expose ai_agent_changed output");
  });

  test.each([
    "supabase/functions/ai-agent-optimized/index.ts",
    "supabase/functions/ai-agent-optimized/nested/prompt.ts",
    "supabase/functions/_shared/database.ts",
    "supabase/functions/_shared/auth.ts",
    "supabase/functions/_shared/org.ts",
    "supabase/functions/_shared/logging.ts",
    "supabase/functions/_shared/cors.ts",
    "supabase/functions/_shared/supabaseEnv.ts",
    "supabase/functions/_shared/requestAuthHeaders.ts",
    "supabase/functions/lib/http/error.ts",
  ])("classifies %s as an ai-agent bundle change", (changedPath) => {
    expect(isAiAgentBundlePath(changedPath)).toBe(true);
  });

  test.each([
    "supabase/functions/other-function/index.ts",
    "supabase/functions/_shared/other.ts",
    "supabase/functions/lib/http/success.ts",
    "src/lib/ai-agent-optimized.ts",
    "docs/ai-agent-optimized.md",
  ])("does not classify unrelated path %s as an ai-agent bundle change", (changedPath) => {
    expect(isAiAgentBundlePath(changedPath)).toBe(false);
  });

  test.each([
    ["function-local directory", "ai-agent-optimized/"],
    ["database dependency", "database"],
    ["auth dependency", "auth"],
    ["org dependency", "org"],
    ["logging dependency", "logging"],
    ["CORS dependency", "cors"],
    ["Supabase environment dependency", "supabaseEnv"],
    ["request auth headers dependency", "requestAuthHeaders"],
    ["HTTP error dependency", "lib/http/error"],
  ])("rejects change_scope patterns missing the %s", (_dependencyClass, omittedToken) => {
    const weakenedPattern = AI_AGENT_PATH_PATTERN.replace(String(omittedToken), "omitted");
    const fixtureRoot = makeFixture({
      ci: {
        aiAgentPathPattern: weakenedPattern,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("actual ai-agent-optimized bundle manifest");
  });

  test("rejects a broadened ai-agent change pattern that includes unrelated functions", () => {
    const fixtureRoot = makeFixture({
      ci: {
        aiAgentPathPattern: "^supabase/functions/",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("actual ai-agent-optimized bundle manifest");
  });

  test("requires unavailable diff metadata to set ai_agent_changed true", () => {
    const fixtureRoot = makeFixture({
      ci: {
        unavailableAiAgentChanged: "false",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("safe fallback true when diff metadata is unavailable");
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

  test("rejects a missing fill-docs deploy step", () => {
    const fixtureRoot = makeFixture({
      ci: {
        fillDocsDeployRun: "echo fill-docs deploy intentionally omitted",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exactly one fill-docs deploy command");
  });

  test("rejects fill-docs deploy commands outside deploy_session_edge", () => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: "      - run: npm run ci:deploy:fill-docs-function",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exactly one fill-docs deploy command");
  });

  test("rejects fill-docs deployment before the session edge bundle", () => {
    const fixtureRoot = makeFixture({
      ci: {
        fillDocsBeforeSessionDeploy: true,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_session_edge must validate deploy prerequisites before deploying",
    );
  });

  test("rejects deploy_session_edge when the prereq helper is not the shared fail-closed target validator", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPrereqRun: "echo checked env vars only",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_session_edge must run the shared edge deploy prerequisite helper",
    );
  });

  test("rejects runtime migration parity outside main pushes and explicit payroll activation", () => {
    const fixtureRoot = makeFixture({
      ci: {
        runtimeParityRestriction: "",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must be restricted to main pushes or explicit payroll activation",
    );
  });

  test("rejects unconditional runtime migration parity enforcement in ci_gate", () => {
    const fixtureRoot = makeFixture({
      ci: {
        ciGateChecks: [
          "[ \"${TENANT_SAFETY_RESULT}\" = \"success\" ] || failed+=(\"tenant-safety=${TENANT_SAFETY_RESULT}\")",
          "[ \"${RUNTIME_PARITY_RESULT}\" = \"success\" ] || failed+=(\"runtime-migration-parity=${RUNTIME_PARITY_RESULT}\")",
          "[ \"${START_SESSION_RUNTIME_CONTRACT_RESULT}\" = \"success\" ] || failed+=(\"start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}\")",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${DEPLOY_SESSION_EDGE_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-session-edge=${DEPLOY_SESSION_EDGE_RESULT}\")",
          "fi",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${AI_AGENT_CHANGED}\" = \"true\" ] && [ \"${DEPLOY_AI_AGENT_EDGE_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-ai-agent-edge=${DEPLOY_AI_AGENT_EDGE_RESULT}\")",
          "fi",
        ],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "ci_gate must enforce runtime_migration_parity success on main pushes and explicit payroll activation",
    );
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

  test.each([
    "SUPABASE_ACCESS_TOKEN=fake npm run ci:deploy:session-edge-bundle",
    "env SUPABASE_ACCESS_TOKEN=fake npm run ci:deploy:session-edge-bundle",
    "npm --silent run ci:deploy:session-edge-bundle",
    "npm -s run ci:deploy:session-edge-bundle",
    "npm --prefix . run ci:deploy:session-edge-bundle",
    "SUPABASE_ACCESS_TOKEN=fake supabase functions deploy sessions-book",
    "env SUPABASE_ACCESS_TOKEN=fake supabase functions deploy sessions-book",
    "npx supabase functions deploy sessions-book",
    "pnpm exec supabase functions deploy sessions-book",
    "npm exec -- supabase functions deploy sessions-book",
    "yarn exec supabase functions deploy sessions-book",
    "./node_modules/.bin/supabase functions deploy sessions-book",
    "/usr/local/bin/supabase functions deploy sessions-book",
    String.raw`C:\tools\supabase.exe functions deploy sessions-book`,
  ])("rejects raw session deploy spelling: %s", (deployCommand) => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: `      - run: ${deployCommand}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must contain exactly one session edge deploy command");
  });

  test.each([
    "bash -lc 'npm run ci:deploy:session-edge-bundle'",
    "bash -lc 'supabase functions deploy sessions-book'",
    "/bin/sh -c 'npx supabase functions deploy sessions-book'",
    "dash -ec 'pnpm exec supabase functions deploy sessions-book'",
    "zsh -lc 'npm exec -- supabase functions deploy sessions-book'",
    "pwsh -Command 'yarn exec supabase functions deploy sessions-book'",
    "powershell.exe -c './node_modules/.bin/supabase functions deploy sessions-book'",
    "cmd.exe /c \"C:\\tools\\supabase.exe functions deploy sessions-book\"",
    "bash --noprofile -lc -- 'supabase functions deploy sessions-book'",
    "pwsh -NoProfile -NonInteractive -Command 'supabase functions deploy sessions-book'",
    "cmd.exe /d /s /c \"supabase functions deploy sessions-book\"",
    "bash -lc 'node scripts/ci/deploy-session-edge-bundle.mjs'",
  ])("rejects interpreter-wrapped raw session deploy spelling: %s", (deployCommand) => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: `      - run: ${deployCommand}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must contain exactly one session edge deploy command");
  });

  test("rejects deploy_ai_agent_edge when it is not restricted to main pushes with ai_agent_changed true", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployAiAgentRestriction: "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_ai_agent_edge must be restricted to push on refs/heads/main with ai_agent_changed == 'true'");
  });

  test("rejects deploy_ai_agent_edge when the prereq helper is not the shared fail-closed target validator", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployAiAgentPrereqRun: "echo checked env vars only",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_ai_agent_edge must run the shared edge deploy prerequisite helper",
    );
  });

  test("rejects raw ai-agent deploy commands outside deploy_ai_agent_edge", () => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: "      - run: supabase functions deploy ai-agent-optimized --project-ref wnnjeqheqxxyrgsjmygy",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must contain exactly one ai-agent deploy command");
  });

  test.each([
    "SUPABASE_ACCESS_TOKEN=fake npm run ci:deploy:ai-agent-function",
    "env SUPABASE_ACCESS_TOKEN=fake npm run ci:deploy:ai-agent-function",
    "npm --silent run ci:deploy:ai-agent-function",
    "npm -s run ci:deploy:ai-agent-function",
    "npm --prefix . run ci:deploy:ai-agent-function",
    "SUPABASE_ACCESS_TOKEN=fake supabase functions deploy ai-agent-optimized",
    "env SUPABASE_ACCESS_TOKEN=fake supabase functions deploy ai-agent-optimized",
    "npx supabase functions deploy ai-agent-optimized",
    "pnpm exec supabase functions deploy ai-agent-optimized",
    "npm exec -- supabase functions deploy ai-agent-optimized",
    "yarn exec supabase functions deploy ai-agent-optimized",
    "./node_modules/.bin/supabase functions deploy ai-agent-optimized",
    "/usr/local/bin/supabase functions deploy ai-agent-optimized",
    String.raw`C:\tools\supabase.exe functions deploy ai-agent-optimized`,
  ])("rejects raw ai-agent deploy spelling: %s", (deployCommand) => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: `      - run: ${deployCommand}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must contain exactly one ai-agent deploy command");
  });

  test.each([
    "bash -lc 'npm run ci:deploy:ai-agent-function'",
    "bash -lc 'supabase functions deploy ai-agent-optimized'",
    "/bin/sh -c 'npx supabase functions deploy ai-agent-optimized'",
    "dash -ec 'pnpm exec supabase functions deploy ai-agent-optimized'",
    "zsh -lc 'npm exec -- supabase functions deploy ai-agent-optimized'",
    "pwsh -Command 'yarn exec supabase functions deploy ai-agent-optimized'",
    "powershell.exe -c './node_modules/.bin/supabase functions deploy ai-agent-optimized'",
    "cmd.exe /c \"C:\\tools\\supabase.exe functions deploy ai-agent-optimized\"",
    "bash --noprofile -lc -- 'supabase functions deploy ai-agent-optimized'",
    "pwsh -NoProfile -NonInteractive -Command 'supabase functions deploy ai-agent-optimized'",
    "cmd.exe /d /s /c \"supabase functions deploy ai-agent-optimized\"",
    "bash -lc \"sh -c 'supabase functions deploy ai-agent-optimized'\"",
    "bash -lc 'node scripts/ci/deploy-ai-agent-function.mjs'",
  ])("rejects interpreter-wrapped raw ai-agent deploy spelling: %s", (deployCommand) => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: `      - run: ${deployCommand}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must contain exactly one ai-agent deploy command");
  });

  test.each([
    "# SUPABASE_ACCESS_TOKEN=fake supabase functions deploy ai-agent-optimized",
    "echo 'npx supabase functions deploy ai-agent-optimized'",
    "printf '%s\\n' 'pnpm exec supabase functions deploy ai-agent-optimized'",
    "echo \"npm exec -- supabase functions deploy sessions-book\"",
    "printf '%s\\n' '/usr/local/bin/supabase functions deploy sessions-book'",
    "bash -lc \"echo 'supabase functions deploy ai-agent-optimized'\"",
    "sh -c \"printf '%s\\n' 'node scripts/ci/deploy-session-edge-bundle.mjs'\"",
  ])("ignores inert deploy text: %s", (inertText) => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: `      - run: |\n          ${inertText}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status, result.stderr).toBe(0);
  });

  test.each([
    "SUPABASE_ACCESS_TOKEN=fake npm run ci:deploy:fill-docs-function",
    "env SUPABASE_ACCESS_TOKEN=fake npm run ci:deploy:fill-docs-function",
    "bash -lc 'npm run ci:deploy:fill-docs-function'",
    "npm --silent run ci:deploy:fill-docs-function",
    "npm -s run ci:deploy:fill-docs-function",
    "npm --prefix . run ci:deploy:fill-docs-function",
    "bash -lc 'npm --silent run ci:deploy:fill-docs-function'",
    "bash -lc 'npm -s run ci:deploy:fill-docs-function'",
  ])("rejects raw fill-docs deploy spelling: %s", (deployCommand) => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: `      - run: ${deployCommand}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exactly one fill-docs deploy command");
  });

  test.each([
    "bash -lc 'SUPABASE_ACCESS_TOKEN=fake npm run ci:deploy:fill-docs-function'",
    "env CI=true npm run ci:deploy:fill-docs-function",
    "bash -lc 'node scripts/ci/deploy-fill-docs-function.mjs'",
    "pwsh -Command 'npm run ci:deploy:fill-docs-function'",
    "cmd.exe /c \"node scripts/ci/deploy-fill-docs-function.mjs\"",
  ])("rejects wrapped fill-docs deploy spelling: %s", (deployCommand) => {
    const fixtureRoot = makeFixture({
      ci: {
        authExtra: `      - run: ${deployCommand}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exactly one fill-docs deploy command");
  });

  test("rejects ci_gate when ai-agent deploy success is not conditionally enforced on main", () => {
    const fixtureRoot = makeFixture({
      ci: {
        ciGateChecks: [
          "[ \"${TENANT_SAFETY_RESULT}\" = \"success\" ] || failed+=(\"tenant-safety=${TENANT_SAFETY_RESULT}\")",
          "[ \"${RUNTIME_PARITY_RESULT}\" = \"success\" ] || failed+=(\"runtime-migration-parity=${RUNTIME_PARITY_RESULT}\")",
          "[ \"${START_SESSION_RUNTIME_CONTRACT_RESULT}\" = \"success\" ] || failed+=(\"start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}\")",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${DEPLOY_SESSION_EDGE_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-session-edge=${DEPLOY_SESSION_EDGE_RESULT}\")",
          "fi",
        ],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ci_gate must enforce deploy_ai_agent_edge success when ai_agent_changed is true on main pushes");
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
    expect(result.stderr).toContain("ci_gate must include tenant_safety, runtime_migration_parity, start_session_runtime_contract, deploy_session_edge, deploy_ai_agent_edge, deploy_payroll_timesheets, and deploy_payroll_administration");
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

  test("rejects policy parity scope when payroll-timesheets is missing", () => {
    const fixtureRoot = makeFixture({
      ci: {
        parityScope:
          "sessions-book,sessions-hold,sessions-confirm,sessions-start,sessions-cancel,generate-session-notes-pdf,session-notes-pdf-status,session-notes-pdf-download,programs,goals,goal-targets,program-notes",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SUPABASE_FUNCTION_PARITY_SCOPE must include payroll-timesheets");
  });

  test("rejects deploy_payroll_timesheets when it can run automatically on pushes to refs/heads/main", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollRestriction: "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_timesheets must require explicit manual activation");
  });

  test("rejects deploy_payroll_timesheets when the prereq helper is not the shared fail-closed target validator", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollPrereqRun: "echo checked env vars only",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_payroll_timesheets must run the shared edge deploy prerequisite helper",
    );
  });

  test("rejects ci_gate when payroll deploy success is not enforced for explicit manual activation", () => {
    const fixtureRoot = makeFixture({
      ci: {
        ciGateChecks: [
          "[ \"${TENANT_SAFETY_RESULT}\" = \"success\" ] || failed+=(\"tenant-safety=${TENANT_SAFETY_RESULT}\")",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${RUNTIME_PARITY_RESULT}\" != \"success\" ]; then",
          "failed+=(\"runtime-migration-parity=${RUNTIME_PARITY_RESULT}\")",
          "fi",
          "[ \"${START_SESSION_RUNTIME_CONTRACT_RESULT}\" = \"success\" ] || failed+=(\"start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}\")",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${DEPLOY_SESSION_EDGE_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-session-edge=${DEPLOY_SESSION_EDGE_RESULT}\")",
          "fi",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ] && [ \"${AI_AGENT_CHANGED}\" = \"true\" ] && [ \"${DEPLOY_AI_AGENT_EDGE_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-ai-agent-edge=${DEPLOY_AI_AGENT_EDGE_RESULT}\")",
          "fi",
        ],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "ci_gate must enforce deploy_payroll_timesheets success for explicit manual activation",
    );
  });

  test("rejects policy parity scope when payroll-administration is missing", () => {
    const fixtureRoot = makeFixture({
      ci: {
        parityScope:
          "sessions-book,sessions-hold,sessions-confirm,sessions-start,sessions-cancel,generate-session-notes-pdf,session-notes-pdf-status,session-notes-pdf-download,programs,goals,goal-targets,program-notes,payroll-timesheets",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SUPABASE_FUNCTION_PARITY_SCOPE must include payroll-administration");
  });

  test("rejects a missing default-false payroll-administration workflow dispatch input", () => {
    const fixtureRoot = makeFixture({ ci: { payrollAdministrationInput: "" } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("workflow_dispatch must define a required default-false boolean activate_payroll_administration input");
  });

  test("rejects deploy_payroll_administration when it can run automatically on pushes", () => {
    const fixtureRoot = makeFixture({
      ci: { deployPayrollAdministrationRestriction: "github.event_name == 'push' && github.ref == 'refs/heads/main'" },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must require explicit manual activation");
  });

  test.each([
    "github.event_name == 'workflow_dispatch' && inputs.activate_payroll_administration == true",
    "github.event_name == 'workflow_dispatch' && inputs.activate_payroll_administration == true && github.ref != 'refs/heads/main'",
  ])("rejects payroll-administration activation from a branch or tag dispatch", (deployPayrollAdministrationRestriction) => {
    const fixtureRoot = makeFixture({ ci: { deployPayrollAdministrationRestriction } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must require immutable current-main manual activation");
  });

  test("rejects payroll-administration deployment without a live main SHA comparison", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollAdministrationMainVerification: `      - name: Verify immutable current main
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_WORKFLOW_SHA: \${{ github.sha }}
          GH_REPOSITORY: \${{ github.repository }}
        run: |
          set -euo pipefail
          live_main_sha="\${EXPECTED_WORKFLOW_SHA}"
          test -n "\${live_main_sha}"`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must verify github.sha equals live origin/main immediately before deploy");
  });

  test("rejects payroll-administration main lookup failure fallbacks", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollAdministrationMainVerification: `      - name: Verify payroll-administration immutable current main
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_WORKFLOW_SHA: \${{ github.sha }}
          GH_REPOSITORY: \${{ github.repository }}
        run: |
          set -euo pipefail
          live_main_sha="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '.object.sha' || printf '%s' "\${EXPECTED_WORKFLOW_SHA}")"
          test "\${live_main_sha}" = "\${EXPECTED_WORKFLOW_SHA}"`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must verify github.sha equals live origin/main immediately before deploy");
  });

  test.each([
    ["UPSTASH_REDIS_REST_URL", `        env:
          UPSTASH_REDIS_REST_TOKEN: \${{ secrets.UPSTASH_REDIS_REST_TOKEN }}`],
    ["UPSTASH_REDIS_REST_TOKEN", `        env:
          UPSTASH_REDIS_REST_URL: \${{ secrets.UPSTASH_REDIS_REST_URL }}`],
  ])("rejects payroll-administration deploy prerequisites missing %s", (_missingName, deployPayrollAdministrationUpstashEnv) => {
    const fixtureRoot = makeFixture({ ci: { deployPayrollAdministrationUpstashEnv } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration prerequisites must require both Upstash REST secrets");
  });

  test("rejects payroll-administration Upstash secrets outside the deploy prerequisite step", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: echo policy
        env:
          UPSTASH_REDIS_REST_URL: \${{ secrets.UPSTASH_REDIS_REST_URL }}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration prerequisites must require both Upstash REST secrets");
  });

  test("rejects extra payroll-administration deploy and prerequisite commands", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-administration
      - run: node scripts/ci/deploy-payroll-administration-function.mjs`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must contain exactly one payroll-administration deploy prerequisite command");
    expect(result.stderr).toContain("CI workflow must contain exactly one payroll-administration deploy command");
  });

  test("rejects ci_gate when payroll-administration deploy success is not aggregated", () => {
    const fixtureRoot = makeFixture({
      ci: {
        ciGateChecks: [
          "[ \"${TENANT_SAFETY_RESULT}\" = \"success\" ] || failed+=(\"tenant-safety=${TENANT_SAFETY_RESULT}\")",
          "if { [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ]; } || { [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ]; }; then",
          "[ \"${RUNTIME_PARITY_RESULT}\" = \"success\" ] || failed+=(\"runtime-migration-parity=${RUNTIME_PARITY_RESULT}\")",
          "fi",
          "[ \"${START_SESSION_RUNTIME_CONTRACT_RESULT}\" = \"success\" ] || failed+=(\"start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}\")",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_TIMESHEETS_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-payroll-timesheets=${DEPLOY_PAYROLL_TIMESHEETS_RESULT}\")",
          "fi",
        ],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ci_gate must enforce deploy_payroll_administration success for explicit manual activation");
  });
});
