import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { isAiAgentBundlePath } from "../../scripts/ci/check-session-deploy-safety.mjs";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "check-session-deploy-safety.mjs");
const checkedInCiWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "ci.yml"),
  "utf8",
);

const tempDirs: string[] = [];
const AI_AGENT_PATH_PATTERN =
  "^supabase/functions/(ai-agent-optimized/|_shared/(database|auth|org|logging|cors|supabaseEnv|requestAuthHeaders)\\.ts$|lib/http/error\\.ts$)";
const DEPLOYED_FUNCTION_SCOPE =
  "sessions-book,sessions-hold,sessions-confirm,sessions-start,sessions-cancel,generate-session-notes-pdf,session-notes-pdf-status,session-notes-pdf-download,programs,goals,goal-targets,program-notes";
const PENDING_PAYROLL_FUNCTION_SCOPE =
  "payroll-timesheets,payroll-administration,payroll-approvals,payroll-export";
const MAIN_PUSH_IF = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const PAYROLL_APPROVAL_ACKNOWLEDGEMENT = "I_APPROVE_WIN_219_PAYROLL_ACTIVATION";
const PAYROLL_OWNER_DISPATCH_GUARD =
  "github.actor == github.repository_owner && github.actor_id == '129695080' && github.event.repository.owner.type == 'User' && github.event.repository.owner.login == github.repository_owner && github.event.repository.owner.id == 129695080";
const PAYROLL_DEPLOY_NEEDS = [
  "policy",
  "tenant_safety",
  "runtime_migration_parity",
  "lint_typecheck",
  "unit_tests",
  "build",
  "auth_browser_smoke",
];
const payrollApprovalsAttestation = (name: string) => `      - name: ${name}
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_WORKFLOW_SHA: \${{ github.sha }}
          GH_REPOSITORY: \${{ github.repository }}
        run: |
          set -euo pipefail
          main_ref_record="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '[.ref, .object.sha] | @tsv')"
          IFS=$'\\t' read -r live_main_ref live_main_sha <<< "\${main_ref_record}"
          if [ "\${live_main_ref}" != "refs/heads/main" ] || [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then
            echo "::error::Refusing payroll-approvals deployment because workflow SHA is not immutable current main." >&2
            exit 1
          fi`;
const PAYROLL_APPROVALS_FIRST_ATTESTATION = payrollApprovalsAttestation(
  "Attest payroll-approvals current main before credentials",
);
const PAYROLL_APPROVALS_FINAL_ATTESTATION = payrollApprovalsAttestation(
  "Re-attest payroll-approvals current main immediately before deploy",
);
const payrollAdministrationAttestation = (name: string) => `      - name: ${name}
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_WORKFLOW_SHA: \${{ github.sha }}
          GH_REPOSITORY: \${{ github.repository }}
        run: |
          set -euo pipefail
          main_ref_record="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '[.ref, .object.sha] | @tsv')"
          IFS=$'\\t' read -r live_main_ref live_main_sha <<< "\${main_ref_record}"
          if [ "\${live_main_ref}" != "refs/heads/main" ] || [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then
            echo "::error::Refusing payroll-administration deployment because workflow SHA is not immutable current main." >&2
            exit 1
          fi`;
const PAYROLL_ADMINISTRATION_FIRST_ATTESTATION = payrollAdministrationAttestation(
  "Attest payroll-administration current main before credentials",
);
const PAYROLL_ADMINISTRATION_SECRET_MUTATION_ATTESTATION = payrollAdministrationAttestation(
  "Re-attest payroll-administration current main immediately before remote secret sync",
);
const PAYROLL_ADMINISTRATION_FINAL_ATTESTATION = payrollAdministrationAttestation(
  "Re-attest payroll-administration current main immediately before deploy",
);
const PAYROLL_ADMINISTRATION_SECRET_SYNC = `      - name: Sync payroll-administration Upstash Edge secrets
        env:
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
          UPSTASH_REDIS_REST_URL: \${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: \${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
        run: |
          set -euo pipefail
          : "\${SUPABASE_PROJECT_REF:?Missing SUPABASE_PROJECT_REF}"
          : "\${SUPABASE_ACCESS_TOKEN:?Missing SUPABASE_ACCESS_TOKEN}"
          : "\${UPSTASH_REDIS_REST_URL:?Missing UPSTASH_REDIS_REST_URL}"
          : "\${UPSTASH_REDIS_REST_TOKEN:?Missing UPSTASH_REDIS_REST_TOKEN}"
          supabase secrets set \\
            "UPSTASH_REDIS_REST_URL=\${UPSTASH_REDIS_REST_URL}" \\
            "UPSTASH_REDIS_REST_TOKEN=\${UPSTASH_REDIS_REST_TOKEN}" \\
            --project-ref "\${SUPABASE_PROJECT_REF}"`;
const PAYROLL_ADMINISTRATION_SECRET_VERIFY = `      - name: Verify payroll-administration remote Edge secret names
        env:
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: node scripts/ci/deploy-payroll-administration-function.mjs --verify-edge-secrets`;
const PAYROLL_APPROVALS_INPUT = `      activate_payroll_approvals:
        description: Explicitly activate the reviewed payroll-approvals Edge function
        required: true
        type: boolean
        default: false`;
const payrollExportAttestation = (name: string) => `      - name: ${name}
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_WORKFLOW_SHA: \${{ github.sha }}
          GH_REPOSITORY: \${{ github.repository }}
        run: |
          set -euo pipefail
          main_ref_record="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '[.ref, .object.sha] | @tsv')"
          IFS=$'\\t' read -r live_main_ref live_main_sha <<< "\${main_ref_record}"
          if [ "\${live_main_ref}" != "refs/heads/main" ] || [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then
            echo "::error::Refusing payroll-export deployment because workflow SHA is not immutable current main." >&2
            exit 1
          fi`;
const PAYROLL_EXPORT_FIRST_ATTESTATION = payrollExportAttestation(
  "Attest payroll-export current main before credentials",
);
const PAYROLL_EXPORT_FINAL_ATTESTATION = payrollExportAttestation(
  "Re-attest payroll-export current main immediately before deploy",
);
const payrollTimesheetsAttestation = (name: string) => `      - name: ${name}
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_WORKFLOW_SHA: \${{ github.sha }}
          GH_REPOSITORY: \${{ github.repository }}
        run: |
          set -euo pipefail
          main_ref_record="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '[.ref, .object.sha] | @tsv')"
          IFS=$'\\t' read -r live_main_ref live_main_sha <<< "\${main_ref_record}"
          if [ "\${live_main_ref}" != "refs/heads/main" ] || [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then
            echo "::error::Refusing payroll-timesheets deployment because workflow SHA is not immutable current main." >&2
            exit 1
          fi`;
const PAYROLL_TIMESHEETS_FIRST_ATTESTATION = payrollTimesheetsAttestation(
  "Attest payroll-timesheets current main before credentials",
);
const PAYROLL_TIMESHEETS_FINAL_ATTESTATION = payrollTimesheetsAttestation(
  "Re-attest payroll-timesheets current main immediately before deploy",
);
const PAYROLL_EXPORT_INPUT = `      activate_payroll_export:
        description: Explicitly activate the reviewed payroll-export Edge function
        required: true
        type: boolean
        default: false`;
const PAYROLL_APPROVAL_ACKNOWLEDGEMENT_INPUT = `      approval_acknowledgement:
        description: Exact owner approval acknowledgement
        required: true
        type: string`;

const write = (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
};

const ciWorkflow = ({
  payrollExportInput = PAYROLL_EXPORT_INPUT,
  payrollApprovalsInput = PAYROLL_APPROVALS_INPUT,
  payrollAdministrationInput = `      activate_payroll_administration:
        description: Explicitly activate the reviewed payroll-administration Edge function
        required: true
        type: boolean
        default: false`,
  payrollApprovalAcknowledgementInput = PAYROLL_APPROVAL_ACKNOWLEDGEMENT_INPUT,
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
  parityScope = DEPLOYED_FUNCTION_SCOPE,
  pendingParityScope = PENDING_PAYROLL_FUNCTION_SCOPE,
  runtimeParityRestriction = `(${MAIN_PUSH_IF}) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true || inputs.activate_payroll_approvals == true || inputs.activate_payroll_export == true))`,
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
  deployPayrollRestriction = `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_timesheets == true`,
  deployPayrollNeeds = PAYROLL_DEPLOY_NEEDS,
  deployPayrollBeforeFirstAttestation = "",
  deployPayrollFirstAttestation = PAYROLL_TIMESHEETS_FIRST_ATTESTATION,
  deployPayrollAfterFirstAttestation = "",
  deployPayrollPrereqRun = "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-timesheets",
  deployPayrollFinalAttestation = PAYROLL_TIMESHEETS_FINAL_ATTESTATION,
  deployPayrollBeforeDeploy = "",
  deployPayrollRun = "node scripts/ci/deploy-payroll-timesheets-function.mjs",
  deployPayrollExportRestriction = `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_export == true`,
  deployPayrollExportNeeds = PAYROLL_DEPLOY_NEEDS,
  deployPayrollExportBeforeFirstAttestation = "",
  deployPayrollExportFirstAttestation = PAYROLL_EXPORT_FIRST_ATTESTATION,
  deployPayrollExportAfterFirstAttestation = "",
  deployPayrollExportPrereqRun = "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-export",
  deployPayrollExportFinalAttestation = PAYROLL_EXPORT_FINAL_ATTESTATION,
  deployPayrollExportBeforeDeploy = "",
  deployPayrollExportRun = "node scripts/ci/deploy-payroll-export-function.mjs",
  deployPayrollApprovalsRestriction = `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_approvals == true`,
  deployPayrollApprovalsNeeds = PAYROLL_DEPLOY_NEEDS,
  deployPayrollAdministrationNeeds = PAYROLL_DEPLOY_NEEDS,
  deployPayrollApprovalsBeforeFirstAttestation = "",
  deployPayrollApprovalsFirstAttestation = PAYROLL_APPROVALS_FIRST_ATTESTATION,
  deployPayrollApprovalsAfterFirstAttestation = "",
  deployPayrollApprovalsPrereqRun = "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-approvals",
  deployPayrollApprovalsFinalAttestation = PAYROLL_APPROVALS_FINAL_ATTESTATION,
  deployPayrollApprovalsBeforeDeploy = "",
  deployPayrollApprovalsRun = "node scripts/ci/deploy-payroll-approvals-function.mjs",
  deployPayrollAdministrationRestriction = `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_administration == true`,
  deployPayrollAdministrationBeforeFirstAttestation = "",
  deployPayrollAdministrationFirstAttestation = PAYROLL_ADMINISTRATION_FIRST_ATTESTATION,
  deployPayrollAdministrationAfterFirstAttestation = "",
  deployPayrollAdministrationSecretMutationAttestation = PAYROLL_ADMINISTRATION_SECRET_MUTATION_ATTESTATION,
  deployPayrollAdministrationSecretSync = PAYROLL_ADMINISTRATION_SECRET_SYNC,
  deployPayrollAdministrationPrereqRun = "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-administration",
  deployPayrollAdministrationSecretVerify = PAYROLL_ADMINISTRATION_SECRET_VERIFY,
  deployPayrollAdministrationFinalAttestation = PAYROLL_ADMINISTRATION_FINAL_ATTESTATION,
  deployPayrollAdministrationBeforeDeploy = "",
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
    "deploy_payroll_export",
    "deploy_payroll_approvals",
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
    "if { [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ]; } || { [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && { [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ] || [ \"${ACTIVATE_PAYROLL_ADMINISTRATION}\" = \"true\" ] || [ \"${ACTIVATE_PAYROLL_APPROVALS}\" = \"true\" ] || [ \"${ACTIVATE_PAYROLL_EXPORT}\" = \"true\" ]; }; }; then",
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
    "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_EXPORT}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_EXPORT_RESULT}\" != \"success\" ]; then",
    "failed+=(\"deploy-payroll-export=${DEPLOY_PAYROLL_EXPORT_RESULT}\")",
    "fi",
    "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_APPROVALS}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_APPROVALS_RESULT}\" != \"success\" ]; then",
    "failed+=(\"deploy-payroll-approvals=${DEPLOY_PAYROLL_APPROVALS_RESULT}\")",
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
${payrollExportInput}
${payrollApprovalsInput}
${payrollAdministrationInput}
${payrollApprovalAcknowledgementInput}
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
          SUPABASE_PENDING_FUNCTION_PARITY_SCOPE: "${pendingParityScope}"
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
          MIGRATION_PARITY_REQUIRED_MIGRATIONS: "20260811214856|payroll_timekeeping_capture_read_model,20260812060529|payroll_timesheet_snapshots,20260812103000|payroll_session_lifecycle_context,20260812113000|payroll_session_lifecycle_context_disabled_state,20260812122436|payroll_approval_workflow,20260812141324|payroll_review_read_models,20260812153628|payroll_administration,20260812185531|payroll_approval_workflow_repair,20260812212854|payroll_timesheet_period_contract_repair,20260812230837|payroll_export_ledger,20260813013000|payroll_approval_codex_review_fixes,20260813103000|payroll_security_repair,20260814172117|payroll_manager_assignment_advisor_remediation,20260814183500|payroll_session_context_disabled_precedence,20260814191200|payroll_session_context_enabled_authority_repair,20260814205000|profile_insert_sync_bypass,20260814213754|session_audit_created_by_typo_repair,20260815002241|payroll_mutation_receipts_initplan,20260815191838|payroll_mutation_receipts_actor_user_id_index,20260816014726|payroll_employee_time_events_fk_indexes,20260816033808|payroll_employee_rate_versions_fk_indexes,20260816063149|payroll_pay_cycle_fk_indexes,20260816153226|payroll_admin_helper_authenticated_execute,20260816201115|payroll_export_fk_indexes"
          ACTIVATE_PAYROLL_TIMESHEETS: \${{ inputs.activate_payroll_timesheets || false }}
          ACTIVATE_PAYROLL_EXPORT: \${{ inputs.activate_payroll_export || false }}
          ACTIVATE_PAYROLL_APPROVALS: \${{ inputs.activate_payroll_approvals || false }}
          ACTIVATE_PAYROLL_ADMINISTRATION: \${{ inputs.activate_payroll_administration || false }}
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
${deployPayrollBeforeFirstAttestation}
${deployPayrollFirstAttestation}
${deployPayrollAfterFirstAttestation}
      - name: Validate payroll-timesheets deploy prerequisites
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: ${deployPayrollPrereqRun}
${deployPayrollFinalAttestation}
${deployPayrollBeforeDeploy}
      - name: Deploy payroll-timesheets edge function
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: ${deployPayrollRun}

  deploy_payroll_export:
    needs:
${deployPayrollExportNeeds.map((need) => `      - ${need}`).join("\n")}
    if: ${deployPayrollExportRestriction}
    steps:
${deployPayrollExportBeforeFirstAttestation}
${deployPayrollExportFirstAttestation}
${deployPayrollExportAfterFirstAttestation}
      - name: Validate payroll-export deploy prerequisites
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: ${deployPayrollExportPrereqRun}
${deployPayrollExportFinalAttestation}
${deployPayrollExportBeforeDeploy}
      - name: Deploy payroll-export edge function
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: ${deployPayrollExportRun}

  deploy_payroll_approvals:
    needs:
${deployPayrollApprovalsNeeds.map((need) => `      - ${need}`).join("\n")}
    if: ${deployPayrollApprovalsRestriction}
    steps:
${deployPayrollApprovalsBeforeFirstAttestation}
${deployPayrollApprovalsFirstAttestation}
${deployPayrollApprovalsAfterFirstAttestation}
      - name: Validate payroll-approvals deploy prerequisites
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: ${deployPayrollApprovalsPrereqRun}
${deployPayrollApprovalsFinalAttestation}
${deployPayrollApprovalsBeforeDeploy}
      - name: Deploy payroll-approvals edge function
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: ${deployPayrollApprovalsRun}

  deploy_payroll_administration:
    needs:
${deployPayrollAdministrationNeeds.map((need) => `      - ${need}`).join("\n")}
    if: ${deployPayrollAdministrationRestriction}
    steps:
${deployPayrollAdministrationBeforeFirstAttestation}
${deployPayrollAdministrationFirstAttestation}
${deployPayrollAdministrationAfterFirstAttestation}
      - name: Validate payroll-administration deploy prerequisites
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: ${deployPayrollAdministrationPrereqRun}
${deployPayrollAdministrationSecretMutationAttestation}
${deployPayrollAdministrationSecretSync}
${deployPayrollAdministrationSecretVerify}
${deployPayrollAdministrationFinalAttestation}
${deployPayrollAdministrationBeforeDeploy}
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
      - name: Auth browser smoke gate
        run: npm run playwright:auth
      - name: Session browser smoke gate
        env:
          PW_BASE_URL: \${{ github.event_name == 'pull_request' && format('https://deploy-preview-{0}--velvety-cendol-dae4d6.netlify.app', github.event.pull_request.number) || secrets.PW_BASE_URL }}
          PW_ADMIN_EMAIL: \${{ secrets.PW_ADMIN_EMAIL }}
          PW_ADMIN_PASSWORD: \${{ secrets.PW_ADMIN_PASSWORD }}
          PW_THERAPIST_EMAIL: \${{ secrets.PW_THERAPIST_EMAIL }}
          PW_THERAPIST_PASSWORD: \${{ secrets.PW_THERAPIST_PASSWORD }}
          PW_SCHEDULE_EMAIL: \${{ secrets.PW_SCHEDULE_EMAIL }}
          PW_SCHEDULE_PASSWORD: \${{ secrets.PW_SCHEDULE_PASSWORD }}
          PW_FOREIGN_CLIENT_ID: \${{ secrets.PW_FOREIGN_CLIENT_ID }}
          PW_FOREIGN_THERAPIST_ID: \${{ secrets.PW_FOREIGN_THERAPIST_ID }}
          VITE_SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_PUBLISHABLE_KEY: \${{ secrets.SUPABASE_PUBLISHABLE_KEY }}
          VITE_SUPABASE_PUBLISHABLE_KEY: \${{ secrets.SUPABASE_PUBLISHABLE_KEY }}
          VITE_SUPABASE_ANON_KEY: \${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SECRET_KEY: \${{ secrets.SUPABASE_SECRET_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.SUPABASE_SECRET_KEY || secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          required=(
            PW_BASE_URL
            PW_ADMIN_EMAIL
            PW_ADMIN_PASSWORD
            PW_THERAPIST_EMAIL
            PW_THERAPIST_PASSWORD
            PW_SCHEDULE_EMAIL
            PW_SCHEDULE_PASSWORD
            PW_FOREIGN_CLIENT_ID
            PW_FOREIGN_THERAPIST_ID
            VITE_SUPABASE_URL
            VITE_SUPABASE_ANON_KEY
            SUPABASE_SERVICE_ROLE_KEY
          )
          missing=()
          for key in "\${required[@]}"; do
            if [ -z "\${!key}" ]; then
              missing+=("$key")
            fi
          done
          if [ "\${#missing[@]}" -gt 0 ]; then
            exit 1
          fi
          npm run ci:playwright
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
          ACTIVATE_PAYROLL_EXPORT: \${{ inputs.activate_payroll_export || false }}
          ACTIVATE_PAYROLL_APPROVALS: \${{ inputs.activate_payroll_approvals || false }}
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
          DEPLOY_PAYROLL_EXPORT_RESULT: \${{ needs.deploy_payroll_export.result }}
          DEPLOY_PAYROLL_APPROVALS_RESULT: \${{ needs.deploy_payroll_approvals.result }}
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
    expect(result.stderr).toContain("ci_gate must include tenant_safety, runtime_migration_parity, start_session_runtime_contract, deploy_session_edge, deploy_ai_agent_edge, deploy_payroll_timesheets, deploy_payroll_export, deploy_payroll_approvals, and deploy_payroll_administration");
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

  test("rejects policy parity scopes when payroll-timesheets is missing", () => {
    const fixtureRoot = makeFixture({
      ci: {
        pendingParityScope:
          "payroll-administration,payroll-approvals,payroll-export",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Supabase function parity scopes must include payroll-timesheets");
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

  test.each([
    `github.event_name == 'workflow_dispatch' && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_timesheets == true`,
    `github.event_name == 'workflow_dispatch' && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_timesheets == true && github.ref != 'refs/heads/main'`,
  ])("rejects payroll-timesheets activation from a branch or tag dispatch", (deployPayrollRestriction) => {
    const fixtureRoot = makeFixture({ ci: { deployPayrollRestriction } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_timesheets must require immutable current-main manual activation");
  });

  test("rejects payroll-timesheets activation without the exact protected approval acknowledgement", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollRestriction:
          `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.activate_payroll_timesheets == true`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_payroll_timesheets must require the exact protected payroll approval acknowledgement",
    );
  });

  test.each([
    `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor_id == '129695080' && github.event.repository.owner.type == 'User' && github.event.repository.owner.login == github.repository_owner && github.event.repository.owner.id == 129695080 && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_timesheets == true`,
    `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor == github.repository_owner && github.event.repository.owner.type == 'User' && github.event.repository.owner.login == github.repository_owner && github.event.repository.owner.id == 129695080 && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_timesheets == true`,
    `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor == github.repository_owner && github.actor_id == '129695080' && github.event.repository.owner.login == github.repository_owner && github.event.repository.owner.id == 129695080 && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_timesheets == true`,
  ])(
    "rejects payroll-timesheets activation without the exact owner-dispatch guard",
    (deployPayrollRestriction) => {
      const fixtureRoot = makeFixture({ ci: { deployPayrollRestriction } });
      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "deploy_payroll_timesheets must require immutable current-main manual activation",
      );
    },
  );

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

  test.each([
    ["deployPayrollNeeds", "deploy_payroll_timesheets needs must exactly equal"],
    ["deployPayrollExportNeeds", "deploy_payroll_export needs must exactly equal"],
    ["deployPayrollApprovalsNeeds", "deploy_payroll_approvals needs must exactly equal"],
    ["deployPayrollAdministrationNeeds", "deploy_payroll_administration needs must exactly equal"],
  ] as const)(
    "rejects manual payroll deploy jobs when auth_browser_smoke is missing from needs",
    (needsKey, expectedMessage) => {
      const fixtureRoot = makeFixture({
        ci: {
          [needsKey]: PAYROLL_DEPLOY_NEEDS.filter((need) => need !== "auth_browser_smoke"),
        },
      });
      const result = runCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(expectedMessage);
      expect(result.stderr).toContain("auth_browser_smoke");
    },
  );

  test("rejects payroll-timesheets credentials before the first current-main attestation", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollBeforeFirstAttestation: `      - name: Premature credential use
        env:
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: echo blocked`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_payroll_timesheets must attest current main before every deploy credential binding",
    );
  });

  test("rejects payroll-timesheets main lookup failure fallbacks", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollFinalAttestation: `      - name: Re-attest payroll-timesheets current main immediately before deploy
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
    expect(result.stderr).toContain(
      "deploy_payroll_timesheets must verify github.sha equals live origin/main immediately before deploy",
    );
  });

  test("rejects any step between payroll-timesheets final current-main attestation and deploy", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollBeforeDeploy: `      - name: Break immediate attestation
        run: echo blocked`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_payroll_timesheets must verify github.sha equals live origin/main immediately before deploy",
    );
  });

  test("keeps the checked-in deploy_payroll_timesheets job locked to immutable current-main manual activation", () => {
    const deployPayrollTimesheetsJob =
      checkedInCiWorkflow.match(
        /deploy_payroll_timesheets:[\s\S]*?(?=\n  deploy_payroll_export:)/,
      )?.[0] ?? "";

    expect(deployPayrollTimesheetsJob).toContain(
      `if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_timesheets == true`,
    );
    expect(deployPayrollTimesheetsJob).toContain(
      "Attest payroll-timesheets current main before credentials",
    );
    expect(deployPayrollTimesheetsJob).toContain(
      "Re-attest payroll-timesheets current main immediately before deploy",
    );
    expect(deployPayrollTimesheetsJob).toContain(
      "Refusing payroll-timesheets deployment because workflow SHA is not immutable current main.",
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

  test("rejects policy parity scopes when payroll-administration is missing", () => {
    const fixtureRoot = makeFixture({
      ci: {
        pendingParityScope:
          "payroll-timesheets,payroll-approvals,payroll-export",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Supabase function parity scopes must include payroll-administration");
  });

  test("rejects policy parity scopes when payroll-approvals is missing", () => {
    const fixtureRoot = makeFixture({
      ci: {
        pendingParityScope:
          "payroll-timesheets,payroll-administration,payroll-export",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Supabase function parity scopes must include payroll-approvals");
  });

  test("rejects policy parity scopes when payroll-export is missing", () => {
    const fixtureRoot = makeFixture({
      ci: {
        pendingParityScope:
          "payroll-timesheets,payroll-administration,payroll-approvals",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Supabase function parity scopes must include payroll-export");
  });

  test("rejects a payroll function listed in both deployed and pending parity scopes", () => {
    const fixtureRoot = makeFixture({
      ci: {
        parityScope: `${DEPLOYED_FUNCTION_SCOPE},payroll-timesheets`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "payroll-timesheets must not appear in both deployed and pending Supabase function parity scopes",
    );
  });

  test("rejects unrelated functions in the pending payroll parity scope", () => {
    const fixtureRoot = makeFixture({
      ci: {
        pendingParityScope: `${PENDING_PAYROLL_FUNCTION_SCOPE},sessions-book`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "SUPABASE_PENDING_FUNCTION_PARITY_SCOPE may contain only protected payroll bootstrap functions",
    );
  });

  test("rejects a missing default-false payroll-approvals workflow dispatch input", () => {
    const fixtureRoot = makeFixture({ ci: { payrollApprovalsInput: "" } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("workflow_dispatch must define a required default-false boolean activate_payroll_approvals input");
  });

  test("rejects a missing default-false payroll-export workflow dispatch input", () => {
    const fixtureRoot = makeFixture({ ci: { payrollExportInput: "" } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("workflow_dispatch must define a required default-false boolean activate_payroll_export input");
  });

  test("rejects a missing default-false payroll-administration workflow dispatch input", () => {
    const fixtureRoot = makeFixture({ ci: { payrollAdministrationInput: "" } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("workflow_dispatch must define a required default-false boolean activate_payroll_administration input");
  });

  test("rejects a missing payroll approval acknowledgement workflow dispatch input", () => {
    const fixtureRoot = makeFixture({ ci: { payrollApprovalAcknowledgementInput: "" } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "workflow_dispatch must define a required string approval_acknowledgement input for protected payroll activation",
    );
  });

  test("rejects deploy_payroll_administration when it can run automatically on pushes", () => {
    const fixtureRoot = makeFixture({
      ci: { deployPayrollAdministrationRestriction: "github.event_name == 'push' && github.ref == 'refs/heads/main'" },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must require explicit manual activation");
  });

  test("rejects deploy_payroll_approvals when it can run automatically on pushes", () => {
    const fixtureRoot = makeFixture({
      ci: { deployPayrollApprovalsRestriction: "github.event_name == 'push' && github.ref == 'refs/heads/main'" },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_approvals must require explicit manual activation");
  });

  test("rejects deploy_payroll_export when it can run automatically on pushes", () => {
    const fixtureRoot = makeFixture({
      ci: { deployPayrollExportRestriction: "github.event_name == 'push' && github.ref == 'refs/heads/main'" },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_export must require explicit manual activation");
  });

  test("rejects deploy_payroll_export when the prereq helper is not the shared fail-closed target validator", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollExportPrereqRun: "echo checked env vars only",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_payroll_export must run the shared edge deploy prerequisite helper",
    );
  });

  test.each([
    `github.event_name == 'workflow_dispatch' && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_export == true`,
    `github.event_name == 'workflow_dispatch' && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_export == true && github.ref != 'refs/heads/main'`,
  ])("rejects payroll-export activation from a branch or tag dispatch", (deployPayrollExportRestriction) => {
    const fixtureRoot = makeFixture({ ci: { deployPayrollExportRestriction } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_export must require immutable current-main manual activation");
  });

  test("rejects payroll-export deployment without a live main SHA comparison", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollExportFinalAttestation: `      - name: Re-attest payroll-export current main immediately before deploy
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
    expect(result.stderr).toContain("deploy_payroll_export must verify github.sha equals live origin/main immediately before deploy");
  });

  test("rejects payroll-export main lookup failure fallbacks", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollExportFinalAttestation: `      - name: Re-attest payroll-export current main immediately before deploy
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
    expect(result.stderr).toContain("deploy_payroll_export must verify github.sha equals live origin/main immediately before deploy");
  });

  test("rejects payroll-export credentials before the first current-main attestation", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollExportBeforeFirstAttestation: `      - name: Premature credential use
        env:
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: echo blocked`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_export must attest current main before every deploy credential binding");
  });

  test("rejects any step between payroll-export final current-main attestation and deploy", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollExportBeforeDeploy: `      - name: Break immediate attestation
        run: echo blocked`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_export must verify github.sha equals live origin/main immediately before deploy");
  });

  test("rejects deploy_payroll_approvals when the prereq helper is not the shared fail-closed target validator", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollApprovalsPrereqRun: "echo checked env vars only",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "deploy_payroll_approvals must run the shared edge deploy prerequisite helper",
    );
  });

  test.each([
    `github.event_name == 'workflow_dispatch' && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_approvals == true`,
    `github.event_name == 'workflow_dispatch' && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_approvals == true && github.ref != 'refs/heads/main'`,
  ])("rejects payroll-approvals activation from a branch or tag dispatch", (deployPayrollApprovalsRestriction) => {
    const fixtureRoot = makeFixture({ ci: { deployPayrollApprovalsRestriction } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_approvals must require immutable current-main manual activation");
  });

  test("rejects payroll-approvals deployment without a live main SHA comparison", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollApprovalsFinalAttestation: `      - name: Re-attest payroll-approvals current main immediately before deploy
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
    expect(result.stderr).toContain("deploy_payroll_approvals must verify github.sha equals live origin/main immediately before deploy");
  });

  test("rejects payroll-approvals main lookup failure fallbacks", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollApprovalsFinalAttestation: `      - name: Re-attest payroll-approvals current main immediately before deploy
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
    expect(result.stderr).toContain("deploy_payroll_approvals must verify github.sha equals live origin/main immediately before deploy");
  });

  test("rejects payroll-approvals credentials before the first current-main attestation", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollApprovalsBeforeFirstAttestation: `      - name: Premature credential use
        env:
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: echo blocked`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_approvals must attest current main before every deploy credential binding");
  });

  test("rejects any step between payroll-approvals final current-main attestation and deploy", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollApprovalsBeforeDeploy: `      - name: Break immediate attestation
        run: echo blocked`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_approvals must verify github.sha equals live origin/main immediately before deploy");
  });

  test.each([
    `github.event_name == 'workflow_dispatch' && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_administration == true`,
    `github.event_name == 'workflow_dispatch' && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_administration == true && github.ref != 'refs/heads/main'`,
  ])("rejects payroll-administration activation from a branch or tag dispatch", (deployPayrollAdministrationRestriction) => {
    const fixtureRoot = makeFixture({ ci: { deployPayrollAdministrationRestriction } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must require immutable current-main manual activation");
  });

  test("rejects runtime_migration_parity when payroll-approvals activation is omitted", () => {
    const fixtureRoot = makeFixture({
      ci: {
        runtimeParityRestriction:
          "(github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true))",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must be restricted to main pushes or explicit payroll activation",
    );
  });

  test("rejects runtime_migration_parity when payroll-export activation is omitted", () => {
    const fixtureRoot = makeFixture({
      ci: {
        runtimeParityRestriction:
          "(github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true || inputs.activate_payroll_approvals == true))",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must be restricted to main pushes or explicit payroll activation",
    );
  });

  test.each([
    `(${MAIN_PUSH_IF}) || (github.event_name == 'workflow_dispatch' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true || inputs.activate_payroll_approvals == true || inputs.activate_payroll_export == true))`,
    `(${MAIN_PUSH_IF}) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor_id == '129695080' && github.event.repository.owner.type == 'User' && github.event.repository.owner.login == github.repository_owner && github.event.repository.owner.id == 129695080 && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true || inputs.activate_payroll_approvals == true || inputs.activate_payroll_export == true))`,
    `(${MAIN_PUSH_IF}) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor == github.repository_owner && github.event.repository.owner.type == 'User' && github.event.repository.owner.login == github.repository_owner && github.event.repository.owner.id == 129695080 && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true || inputs.activate_payroll_approvals == true || inputs.activate_payroll_export == true))`,
    `(${MAIN_PUSH_IF}) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor == github.repository_owner && github.actor_id == '129695080' && github.event.repository.owner.login == github.repository_owner && github.event.repository.owner.id == 129695080 && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true || inputs.activate_payroll_approvals == true || inputs.activate_payroll_export == true))`,
  ])("rejects runtime_migration_parity without the exact protected manual-dispatch guard", (runtimeParityRestriction) => {
    const fixtureRoot = makeFixture({ ci: { runtimeParityRestriction } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must be restricted to main pushes or explicit payroll activation",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits payroll_session_context_enabled_authority_repair", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# runtime parity contract regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260814191200|payroll_session_context_enabled_authority_repair",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits profile_insert_sync_bypass", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# profile insert sync bypass parity regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260814205000|profile_insert_sync_bypass",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits session_audit_created_by_typo_repair", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# session audit created-by typo repair parity regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260814213754|session_audit_created_by_typo_repair",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits payroll_mutation_receipts_initplan", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# payroll mutation receipts initplan parity regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260815002241|payroll_mutation_receipts_initplan",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits payroll_mutation_receipts_actor_user_id_index", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# payroll mutation receipts actor user id index parity regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260815191838|payroll_mutation_receipts_actor_user_id_index",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits payroll_employee_time_events_fk_indexes", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# payroll employee time events fk indexes parity regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260816014726|payroll_employee_time_events_fk_indexes",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits payroll_pay_cycle_fk_indexes", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# payroll employee rate versions fk indexes parity regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260816063149|payroll_pay_cycle_fk_indexes",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits payroll_admin_helper_authenticated_execute", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# payroll admin helper authenticated execute parity regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260816153226|payroll_admin_helper_authenticated_execute",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects runtime_migration_parity when the explicit contract omits payroll_export_fk_indexes", () => {
    const fixtureRoot = makeFixture({
      ci: {
        workflowComment:
          "# payroll export fk indexes parity regression fixture",
      },
    });
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace(
        ",20260816201115|payroll_export_fk_indexes",
        "",
      ),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL",
    );
  });

  test("rejects payroll-administration deployment without a live main SHA comparison", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollAdministrationFinalAttestation: `      - name: Re-attest payroll-administration current main immediately before deploy
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
        deployPayrollAdministrationFinalAttestation: `      - name: Re-attest payroll-administration current main immediately before deploy
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
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ])("rejects payroll-administration secret sync missing %s", (missingName) => {
    const deployPayrollAdministrationSecretSync = PAYROLL_ADMINISTRATION_SECRET_SYNC
      .split("\n")
      .filter((line) => !line.includes(`${missingName}: \${{ secrets.${missingName} }}`))
      .join("\n");
    const fixtureRoot = makeFixture({ ci: { deployPayrollAdministrationSecretSync } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Upstash GitHub secrets may be referenced only by the exact approved payroll-administration sync bindings");
  });

  test("rejects payroll-administration Upstash secrets outside the approved sync step", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: echo policy
        env:
          UPSTASH_REDIS_REST_URL: \${{ secrets.UPSTASH_REDIS_REST_URL }}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Upstash GitHub secrets may be referenced only by the exact approved payroll-administration sync bindings");
  });

  test("rejects payroll-administration credentials before the first current-main attestation", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollAdministrationBeforeFirstAttestation: `      - name: Premature credential use
        env:
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: echo blocked`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must attest current main before every deploy credential binding");
  });

  test("rejects any step between final current-main attestation and deploy", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollAdministrationBeforeDeploy: `      - name: Break immediate attestation
        run: echo blocked`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must verify github.sha equals live origin/main immediately before deploy");
  });

  test.each([
    `      - run: echo "\${{ secrets.UPSTASH_REDIS_REST_URL }}"`,
    `      - run: curl -d "\${{ secrets.UPSTASH_REDIS_REST_TOKEN }}" https://example.invalid`,
    `      - uses: example/action@immutable
        with:
          token: \${{ secrets.UPSTASH_REDIS_REST_TOKEN }}`,
    `      - run: echo blocked
        if: secrets.UPSTASH_REDIS_REST_URL != ''`,
  ])("rejects direct Upstash secret interpolation", (policyExtra) => {
    const fixtureRoot = makeFixture({ ci: { policyExtra } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Upstash GitHub secrets may be referenced only by the exact approved payroll-administration sync bindings");
  });

  test.each([
    `      - run: echo "\${{ secrets }}"`,
    `      - run: echo "\${{ toJSON(secrets) }}"`,
    `      - run: echo "\${{ toJson(secrets) }}"`,
    `      - run: echo "\${{ fromJSON(toJSON(secrets)) }}"`,
    `      - run: echo "\${{ secrets['UPSTASH_REDIS_REST_TOKEN'] }}"`,
    `      - run: echo "\${{ secrets.* }}"`,
    `      - run: echo blocked
        if: secrets != ''`,
  ])("rejects whole GitHub secrets context access patterns", (policyExtra) => {
    const fixtureRoot = makeFixture({ ci: { policyExtra } });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must not reference the whole GitHub secrets context");
  });

  test("rejects folded multiline toJSON(secrets) access", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: >-
          echo "\${{ toJSON(
            secrets
          ) }}"`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must not reference the whole GitHub secrets context");
  });

  test("rejects whole-secrets access after a hash inside a folded block scalar", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: >-
          echo prefix
          # \${{ toJSON(secrets) }}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must not reference the whole GitHub secrets context");
  });

  test("rejects literal multiline fromJSON(toJSON(secrets)) access", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: |-
          echo "\${{ fromJSON(
            toJSON(
              secrets
            )
          ) }}"`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must not reference the whole GitHub secrets context");
  });

  test("rejects bracket-index secrets access split across lines", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: >-
          echo "\${{ secrets[
            'UPSTASH_REDIS_REST_TOKEN'
          ] }}"`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must not reference the whole GitHub secrets context");
  });

  test("rejects wildcard secrets access split across lines", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: >-
          echo "\${{ secrets.
            * }}"`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI workflow must not reference the whole GitHub secrets context");
  });

  test("allows the approved payroll-administration Upstash sync env bindings", () => {
    const fixtureRoot = makeFixture();
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("rejects duplicate Upstash secret bindings", () => {
    const fixtureRoot = makeFixture({
      ci: {
        policyExtra: `      - run: echo duplicate
        env:
          UPSTASH_REDIS_REST_URL: \${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: \${{ secrets.UPSTASH_REDIS_REST_TOKEN }}`,
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Upstash GitHub secrets may be referenced only by the exact approved payroll-administration sync bindings");
  });

  test("rejects payroll-administration workflows without exact remote secret sync and list verification", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollAdministrationSecretSync: "",
        deployPayrollAdministrationSecretVerify: "",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must validate target consistency before remote secret sync, then sync and verify the two required remote Edge secrets before deploy");
  });

  test("rejects payroll-administration remote secret sync before target validation", () => {
    const fixtureRoot = makeFixture({
      ci: {
        deployPayrollAdministrationAfterFirstAttestation: `${PAYROLL_ADMINISTRATION_SECRET_SYNC}
`,
        deployPayrollAdministrationSecretSync: "",
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must validate target consistency before remote secret sync, then sync and verify the two required remote Edge secrets before deploy");
  });

  test("rejects payroll-administration remote secret sync without a fresh current-main re-attestation immediately before mutation", () => {
    const fixtureRoot = makeFixture();
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    const withoutImmediateReattestation = current.replace(
      `${PAYROLL_ADMINISTRATION_SECRET_MUTATION_ATTESTATION}
${PAYROLL_ADMINISTRATION_SECRET_SYNC}
${PAYROLL_ADMINISTRATION_SECRET_VERIFY}
${PAYROLL_ADMINISTRATION_FINAL_ATTESTATION}`,
      `${PAYROLL_ADMINISTRATION_SECRET_SYNC}
${PAYROLL_ADMINISTRATION_SECRET_VERIFY}
${PAYROLL_ADMINISTRATION_FINAL_ATTESTATION}`,
    );
    writeFileSync(workflowPath, withoutImmediateReattestation, "utf8");

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must re-attest immutable current main immediately before remote secret mutation");
  });

  test("rejects any step between payroll-administration remote secret re-attestation and mutation", () => {
    const fixtureRoot = makeFixture();
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    const withBrokenAdjacency = current.replace(
      `${PAYROLL_ADMINISTRATION_SECRET_MUTATION_ATTESTATION}
${PAYROLL_ADMINISTRATION_SECRET_SYNC}`,
      `${PAYROLL_ADMINISTRATION_SECRET_MUTATION_ATTESTATION}
      - name: Break secret-sync adjacency
        run: echo blocked
${PAYROLL_ADMINISTRATION_SECRET_SYNC}`,
    );
    writeFileSync(workflowPath, withBrokenAdjacency, "utf8");

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deploy_payroll_administration must re-attest immutable current main immediately before remote secret mutation");
  });

  test("rejects auth_browser_smoke when the required exact-head Playwright gate remains the narrower session smoke suite", () => {
    const fixtureRoot = makeFixture();
    const workflowPath = path.join(fixtureRoot, ".github", "workflows", "ci.yml");
    const current = readFileSync(workflowPath, "utf8");
    writeFileSync(
      workflowPath,
      current.replace("npm run ci:playwright", "npm run ci:playwright:session-smoke"),
      "utf8",
    );

    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "auth_browser_smoke must run npm run ci:playwright with the complete required auth/session secret contract",
    );
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

  test("rejects ci_gate when payroll-export deploy success is not aggregated", () => {
    const fixtureRoot = makeFixture({
      ci: {
        ciGateChecks: [
          "[ \"${TENANT_SAFETY_RESULT}\" = \"success\" ] || failed+=(\"tenant-safety=${TENANT_SAFETY_RESULT}\")",
          "if { [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ]; } || { [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && { [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ] || [ \"${ACTIVATE_PAYROLL_ADMINISTRATION}\" = \"true\" ] || [ \"${ACTIVATE_PAYROLL_APPROVALS}\" = \"true\" ] || [ \"${ACTIVATE_PAYROLL_EXPORT}\" = \"true\" ]; }; }; then",
          "[ \"${RUNTIME_PARITY_RESULT}\" = \"success\" ] || failed+=(\"runtime-migration-parity=${RUNTIME_PARITY_RESULT}\")",
          "fi",
          "[ \"${START_SESSION_RUNTIME_CONTRACT_RESULT}\" = \"success\" ] || failed+=(\"start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}\")",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_TIMESHEETS_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-payroll-timesheets=${DEPLOY_PAYROLL_TIMESHEETS_RESULT}\")",
          "fi",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_APPROVALS}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_APPROVALS_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-payroll-approvals=${DEPLOY_PAYROLL_APPROVALS_RESULT}\")",
          "fi",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_ADMINISTRATION}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_ADMINISTRATION_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-payroll-administration=${DEPLOY_PAYROLL_ADMINISTRATION_RESULT}\")",
          "fi",
        ],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ci_gate must enforce deploy_payroll_export success for explicit manual activation");
  });

  test("rejects ci_gate when payroll-approvals deploy success is not aggregated", () => {
    const fixtureRoot = makeFixture({
      ci: {
        ciGateChecks: [
          "[ \"${TENANT_SAFETY_RESULT}\" = \"success\" ] || failed+=(\"tenant-safety=${TENANT_SAFETY_RESULT}\")",
          "if { [ \"${GITHUB_EVENT_NAME}\" = \"push\" ] && [ \"${GITHUB_REF}\" = \"refs/heads/main\" ]; } || { [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && { [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ] || [ \"${ACTIVATE_PAYROLL_ADMINISTRATION}\" = \"true\" ]; }; }; then",
          "[ \"${RUNTIME_PARITY_RESULT}\" = \"success\" ] || failed+=(\"runtime-migration-parity=${RUNTIME_PARITY_RESULT}\")",
          "fi",
          "[ \"${START_SESSION_RUNTIME_CONTRACT_RESULT}\" = \"success\" ] || failed+=(\"start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}\")",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_TIMESHEETS}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_TIMESHEETS_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-payroll-timesheets=${DEPLOY_PAYROLL_TIMESHEETS_RESULT}\")",
          "fi",
          "if [ \"${GITHUB_EVENT_NAME}\" = \"workflow_dispatch\" ] && [ \"${ACTIVATE_PAYROLL_ADMINISTRATION}\" = \"true\" ] && [ \"${DEPLOY_PAYROLL_ADMINISTRATION_RESULT}\" != \"success\" ]; then",
          "failed+=(\"deploy-payroll-administration=${DEPLOY_PAYROLL_ADMINISTRATION_RESULT}\")",
          "fi",
        ],
      },
    });
    const result = runCheck(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ci_gate must enforce deploy_payroll_approvals success for explicit manual activation");
  });
});
