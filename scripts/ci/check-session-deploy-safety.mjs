import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEPLOY_COMMAND = "npm run ci:deploy:session-edge-bundle";
const MAIN_PUSH_IF = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const AUTH_DEPLOY_GUARD =
  "github.event_name != 'push' || github.ref != 'refs/heads/main' || needs.deploy_session_edge.result == 'success'";

const getWorkflowPaths = (cwd = process.cwd()) => ({
  ciWorkflowPath: path.join(cwd, ".github", "workflows", "ci.yml"),
  tenantWorkflowPath: path.join(cwd, ".github", "workflows", "tenant-safety.yml"),
});

const readWorkflow = (filePath) => readFileSync(filePath, "utf8");

const extractJobBlock = (content, jobName) => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === `  ${jobName}:`);
  if (start === -1) {
    return "";
  }

  const block = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > start && /^  [A-Za-z0-9_]+:\s*$/.test(line)) {
      break;
    }
    block.push(line);
  }

  return block.join("\n");
};

const countOccurrences = (content, needle) => {
  const matches = content.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
  return matches ? matches.length : 0;
};

const blockHasNeeds = (block, needs) => needs.every((need) => new RegExp(`^\\s*-\\s+${need}\\s*$`, "m").test(block));

const normalizeGrantSet = (values) => [...new Set(values.map((value) => value.toUpperCase()))].sort();

export const evaluateSessionDeploySafety = ({ ciWorkflow, tenantWorkflow }) => {
  const violations = [];

  const policyBlock = extractJobBlock(ciWorkflow, "policy");
  const runtimeParityBlock = extractJobBlock(ciWorkflow, "runtime_migration_parity");
  const runtimeContractBlock = extractJobBlock(ciWorkflow, "start_session_runtime_contract");
  const deployBlock = extractJobBlock(ciWorkflow, "deploy_session_edge");
  const authBlock = extractJobBlock(ciWorkflow, "auth_browser_smoke");
  const ciGateBlock = extractJobBlock(ciWorkflow, "ci_gate");

  const deployCount = countOccurrences(ciWorkflow, DEPLOY_COMMAND);
  if (deployCount !== 1) {
    violations.push("CI workflow must contain exactly one session edge deploy command");
  }

  if (!policyBlock) {
    violations.push("policy job is missing from .github/workflows/ci.yml");
  } else {
    for (const forbidden of [
      DEPLOY_COMMAND,
      "npm run validate:tenant",
      "check-runtime-migration-parity.mjs",
      "check-start-session-runtime-contract.mjs",
      "Validate session edge deploy prerequisites",
    ]) {
      if (policyBlock.includes(forbidden)) {
        violations.push(`policy job must stay read-only and may not include \`${forbidden}\``);
      }
    }
  }

  if (!runtimeParityBlock) {
    violations.push("runtime_migration_parity job is missing");
  } else {
    for (const required of [
      "node scripts/ci/check-runtime-migration-parity.mjs",
      "MIGRATION_PARITY_BASE_SHA",
      "MIGRATION_PARITY_HEAD_SHA",
      "SUPABASE_DB_URL",
    ]) {
      if (!runtimeParityBlock.includes(required)) {
        violations.push(`runtime_migration_parity job must include \`${required}\``);
      }
    }
  }

  if (!runtimeContractBlock) {
    violations.push("start_session_runtime_contract job is missing");
  } else {
    for (const required of [
      "node scripts/ci/check-start-session-runtime-contract.mjs",
      "SUPABASE_DB_URL",
    ]) {
      if (!runtimeContractBlock.includes(required)) {
        violations.push(`start_session_runtime_contract job must include \`${required}\``);
      }
    }
  }

  if (!deployBlock) {
    violations.push("deploy_session_edge job is missing");
  } else {
    if (!deployBlock.includes(`if: ${MAIN_PUSH_IF}`)) {
      violations.push("deploy_session_edge must be restricted to push on refs/heads/main");
    }
    if (!blockHasNeeds(deployBlock, ["policy", "tenant_safety", "runtime_migration_parity", "start_session_runtime_contract"])) {
      violations.push(
        "deploy_session_edge must need policy, tenant_safety, runtime_migration_parity, and start_session_runtime_contract",
      );
    }
    const prereqIndex = deployBlock.indexOf("Validate session edge deploy prerequisites");
    const deployIndex = deployBlock.indexOf(DEPLOY_COMMAND);
    if (prereqIndex === -1 || deployIndex === -1 || prereqIndex > deployIndex) {
      violations.push("deploy_session_edge must validate deploy prerequisites before deploying");
    }
  }

  if (!authBlock) {
    violations.push("auth_browser_smoke job is missing");
  } else {
    if (authBlock.includes(DEPLOY_COMMAND)) {
      violations.push("auth_browser_smoke must not deploy session edge functions");
    }
    if (!blockHasNeeds(authBlock, ["deploy_session_edge"])) {
      violations.push("auth_browser_smoke must need deploy_session_edge");
    }
    if (!authBlock.includes(AUTH_DEPLOY_GUARD)) {
      violations.push(
        "auth_browser_smoke must allow PR/merge_group runs while requiring successful deploy_session_edge on main pushes",
      );
    }
  }

  if (!ciGateBlock) {
    violations.push("ci_gate job is missing");
  } else {
    if (!blockHasNeeds(ciGateBlock, ["tenant_safety", "runtime_migration_parity", "start_session_runtime_contract", "deploy_session_edge"])) {
      violations.push(
        "ci_gate must include tenant_safety, runtime_migration_parity, start_session_runtime_contract, and deploy_session_edge",
      );
    }

    for (const required of [
      "TENANT_SAFETY_RESULT",
      "RUNTIME_PARITY_RESULT",
      "START_SESSION_RUNTIME_CONTRACT_RESULT",
      "DEPLOY_SESSION_EDGE_RESULT",
      "GITHUB_EVENT_NAME",
      "GITHUB_REF",
      "tenant-safety=${TENANT_SAFETY_RESULT}",
      "runtime-migration-parity=${RUNTIME_PARITY_RESULT}",
      "start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}",
      "deploy-session-edge=${DEPLOY_SESSION_EDGE_RESULT}",
    ]) {
      if (!ciGateBlock.includes(required)) {
        violations.push(`ci_gate must enforce \`${required}\` semantics`);
      }
    }
  }

  if (!tenantWorkflow.includes("run: npm test")) {
    violations.push("tenant-safety workflow must run `npm test` without masking failures");
  }
  if (/npm test\s*(\|\||\|)/.test(tenantWorkflow)) {
    violations.push("tenant-safety workflow must run `npm test` without masking failures");
  }

  return { violations };
};

const run = () => {
  const { ciWorkflowPath, tenantWorkflowPath } = getWorkflowPaths();
  const result = evaluateSessionDeploySafety({
    ciWorkflow: readWorkflow(ciWorkflowPath),
    tenantWorkflow: readWorkflow(tenantWorkflowPath),
  });

  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.error(`❌ ${violation}`);
    }
    process.exit(1);
  }

  console.log("Session deploy safety check passed.");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
