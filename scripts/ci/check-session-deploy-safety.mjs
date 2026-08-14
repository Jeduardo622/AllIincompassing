import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEPLOY_COMMAND = "npm run ci:deploy:session-edge-bundle";
const FILL_DOCS_DEPLOY_COMMAND = "npm run ci:deploy:fill-docs-function";
const AI_DEPLOY_COMMAND = "npm run ci:deploy:ai-agent-function";
const PAYROLL_DEPLOY_COMMAND = "node scripts/ci/deploy-payroll-timesheets-function.mjs";
const PAYROLL_EXPORT_DEPLOY_COMMAND = "node scripts/ci/deploy-payroll-export-function.mjs";
const PAYROLL_APPROVALS_DEPLOY_COMMAND = "node scripts/ci/deploy-payroll-approvals-function.mjs";
const PAYROLL_ADMINISTRATION_DEPLOY_COMMAND = "node scripts/ci/deploy-payroll-administration-function.mjs";
const PAYROLL_ADMINISTRATION_SECRET_VERIFY_COMMAND = "node scripts/ci/deploy-payroll-administration-function.mjs --verify-edge-secrets";
const SESSION_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs session-edge";
const AI_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs ai-agent-optimized";
const PAYROLL_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-timesheets";
const PAYROLL_EXPORT_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-export";
const PAYROLL_APPROVALS_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-approvals";
const PAYROLL_ADMINISTRATION_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-administration";
const MAIN_PUSH_IF = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const PAYROLL_APPROVAL_ACKNOWLEDGEMENT = "I_APPROVE_WIN_219_PAYROLL_ACTIVATION";
const PAYROLL_OWNER_DISPATCH_GUARD =
  "github.actor == github.repository_owner && github.actor_id == '129695080' && github.event.repository.owner.type == 'User' && github.event.repository.owner.login == github.repository_owner && github.event.repository.owner.id == 129695080";
const PAYROLL_ACTIVATION_IF =
  `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_timesheets == true`;
const PAYROLL_EXPORT_ACTIVATION_IF =
  `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_export == true`;
const PAYROLL_APPROVALS_ACTIVATION_IF =
  `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_approvals == true`;
const PAYROLL_ADMINISTRATION_ACTIVATION_IF = `github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && inputs.activate_payroll_administration == true`;
const PAYROLL_EXPORT_FIRST_ATTESTATION_STEP = "Attest payroll-export current main before credentials";
const PAYROLL_EXPORT_FINAL_ATTESTATION_STEP = "Re-attest payroll-export current main immediately before deploy";
const PAYROLL_EXPORT_ATTESTATION_LINES = [
  "set -euo pipefail",
  `main_ref_record="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '[.ref, .object.sha] | @tsv')"`,
  `IFS=$'\\t' read -r live_main_ref live_main_sha <<< "\${main_ref_record}"`,
  `if [ "\${live_main_ref}" != "refs/heads/main" ] || [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then`,
  `echo "::error::Refusing payroll-export deployment because workflow SHA is not immutable current main." >&2`,
  "exit 1",
  "fi",
];
const PAYROLL_EXPORT_ATTESTATION_ENV = {
  GH_TOKEN: "${{ github.token }}",
  EXPECTED_WORKFLOW_SHA: "${{ github.sha }}",
  GH_REPOSITORY: "${{ github.repository }}",
};
const PAYROLL_EXPORT_DEPLOY_CREDENTIAL_NAMES = new Set([
  "SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_ACCESS_TOKEN",
]);
const PAYROLL_TIMESHEETS_FIRST_ATTESTATION_STEP = "Attest payroll-timesheets current main before credentials";
const PAYROLL_TIMESHEETS_FINAL_ATTESTATION_STEP = "Re-attest payroll-timesheets current main immediately before deploy";
const PAYROLL_TIMESHEETS_ATTESTATION_LINES = [
  "set -euo pipefail",
  `main_ref_record="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '[.ref, .object.sha] | @tsv')"`,
  `IFS=$'\\t' read -r live_main_ref live_main_sha <<< "\${main_ref_record}"`,
  `if [ "\${live_main_ref}" != "refs/heads/main" ] || [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then`,
  `echo "::error::Refusing payroll-timesheets deployment because workflow SHA is not immutable current main." >&2`,
  "exit 1",
  "fi",
];
const PAYROLL_TIMESHEETS_ATTESTATION_ENV = {
  GH_TOKEN: "${{ github.token }}",
  EXPECTED_WORKFLOW_SHA: "${{ github.sha }}",
  GH_REPOSITORY: "${{ github.repository }}",
};
const PAYROLL_TIMESHEETS_DEPLOY_CREDENTIAL_NAMES = new Set([
  "SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_ACCESS_TOKEN",
]);
const PAYROLL_APPROVALS_FIRST_ATTESTATION_STEP = "Attest payroll-approvals current main before credentials";
const PAYROLL_APPROVALS_FINAL_ATTESTATION_STEP = "Re-attest payroll-approvals current main immediately before deploy";
const PAYROLL_APPROVALS_ATTESTATION_LINES = [
  "set -euo pipefail",
  `main_ref_record="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '[.ref, .object.sha] | @tsv')"`,
  `IFS=$'\\t' read -r live_main_ref live_main_sha <<< "\${main_ref_record}"`,
  `if [ "\${live_main_ref}" != "refs/heads/main" ] || [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then`,
  `echo "::error::Refusing payroll-approvals deployment because workflow SHA is not immutable current main." >&2`,
  "exit 1",
  "fi",
];
const PAYROLL_APPROVALS_ATTESTATION_ENV = {
  GH_TOKEN: "${{ github.token }}",
  EXPECTED_WORKFLOW_SHA: "${{ github.sha }}",
  GH_REPOSITORY: "${{ github.repository }}",
};
const PAYROLL_APPROVALS_DEPLOY_CREDENTIAL_NAMES = new Set([
  "SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_ACCESS_TOKEN",
]);
const PAYROLL_ADMINISTRATION_FIRST_ATTESTATION_STEP = "Attest payroll-administration current main before credentials";
const PAYROLL_ADMINISTRATION_SECRET_MUTATION_ATTESTATION_STEP =
  "Re-attest payroll-administration current main immediately before remote secret sync";
const PAYROLL_ADMINISTRATION_FINAL_ATTESTATION_STEP = "Re-attest payroll-administration current main immediately before deploy";
const PAYROLL_ADMINISTRATION_ATTESTATION_LINES = [
  "set -euo pipefail",
  `main_ref_record="$(gh api --method GET "repos/\${GH_REPOSITORY}/git/ref/heads/main" --jq '[.ref, .object.sha] | @tsv')"`,
  `IFS=$'\\t' read -r live_main_ref live_main_sha <<< "\${main_ref_record}"`,
  `if [ "\${live_main_ref}" != "refs/heads/main" ] || [ -z "\${live_main_sha}" ] || [ "\${live_main_sha}" != "\${EXPECTED_WORKFLOW_SHA}" ]; then`,
  `echo "::error::Refusing payroll-administration deployment because workflow SHA is not immutable current main." >&2`,
  "exit 1",
  "fi",
];
const PAYROLL_ADMINISTRATION_ATTESTATION_ENV = {
  GH_TOKEN: "${{ github.token }}",
  EXPECTED_WORKFLOW_SHA: "${{ github.sha }}",
  GH_REPOSITORY: "${{ github.repository }}",
};
const PAYROLL_ADMINISTRATION_SECRET_SYNC_STEP = "Sync payroll-administration Upstash Edge secrets";
const PAYROLL_ADMINISTRATION_SECRET_SYNC_LINES = [
  "set -euo pipefail",
  `: "\${SUPABASE_PROJECT_REF:?Missing SUPABASE_PROJECT_REF}"`,
  `: "\${SUPABASE_ACCESS_TOKEN:?Missing SUPABASE_ACCESS_TOKEN}"`,
  `: "\${UPSTASH_REDIS_REST_URL:?Missing UPSTASH_REDIS_REST_URL}"`,
  `: "\${UPSTASH_REDIS_REST_TOKEN:?Missing UPSTASH_REDIS_REST_TOKEN}"`,
  "supabase secrets set \\",
  `"UPSTASH_REDIS_REST_URL=\${UPSTASH_REDIS_REST_URL}" \\`,
  `"UPSTASH_REDIS_REST_TOKEN=\${UPSTASH_REDIS_REST_TOKEN}" \\`,
  `--project-ref "\${SUPABASE_PROJECT_REF}"`,
];
const PAYROLL_ADMINISTRATION_SECRET_SYNC_ENV = {
  SUPABASE_PROJECT_REF: "${{ secrets.SUPABASE_PROJECT_REF }}",
  SUPABASE_ACCESS_TOKEN: "${{ secrets.SUPABASE_ACCESS_TOKEN }}",
  UPSTASH_REDIS_REST_URL: "${{ secrets.UPSTASH_REDIS_REST_URL }}",
  UPSTASH_REDIS_REST_TOKEN: "${{ secrets.UPSTASH_REDIS_REST_TOKEN }}",
};
const PAYROLL_ADMINISTRATION_DEPLOY_CREDENTIAL_NAMES = new Set([
  "SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_ACCESS_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
]);
const WIN_219_PAYROLL_MIGRATION_CONTRACT =
  "20260811214856|payroll_timekeeping_capture_read_model,20260812060529|payroll_timesheet_snapshots,20260812103000|payroll_session_lifecycle_context,20260812113000|payroll_session_lifecycle_context_disabled_state,20260812122436|payroll_approval_workflow,20260812141324|payroll_review_read_models,20260812153628|payroll_administration,20260812185531|payroll_approval_workflow_repair,20260812212854|payroll_timesheet_period_contract_repair,20260812230837|payroll_export_ledger,20260813013000|payroll_approval_codex_review_fixes,20260813103000|payroll_security_repair,20260814172117|payroll_manager_assignment_advisor_remediation,20260814183500|payroll_session_context_disabled_precedence,20260814191200|payroll_session_context_enabled_authority_repair";
const RUNTIME_PARITY_IF = `(${MAIN_PUSH_IF}) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && ${PAYROLL_OWNER_DISPATCH_GUARD} && inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}' && (inputs.activate_payroll_timesheets == true || inputs.activate_payroll_administration == true || inputs.activate_payroll_approvals == true || inputs.activate_payroll_export == true))`;
const AI_DEPLOY_IF =
  "github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.change_scope.outputs.ai_agent_changed == 'true'";
const AUTH_SMOKE_IF =
  "always() && needs.change_scope.outputs.docs_only != 'true' && (github.event_name != 'push' || github.ref != 'refs/heads/main' || needs.deploy_session_edge.result == 'success')";
const DEPLOY_NEEDS = [
  "policy",
  "tenant_safety",
  "runtime_migration_parity",
  "start_session_runtime_contract",
  "lint_typecheck",
  "unit_tests",
  "build",
];
const AI_DEPLOY_NEEDS = ["deploy_session_edge", "change_scope"];
const PAYROLL_DEPLOY_NEEDS = [
  "policy",
  "tenant_safety",
  "runtime_migration_parity",
  "lint_typecheck",
  "unit_tests",
  "build",
  "auth_browser_smoke",
];
const AUTH_SMOKE_NEEDS = ["policy", "change_scope", "deploy_session_edge"];
const PROTECTED_PAYROLL_FUNCTION_PARITY_ENTRIES = [
  "payroll-timesheets",
  "payroll-administration",
  "payroll-approvals",
  "payroll-export",
];
const PROTECTED_PAYROLL_FUNCTION_PARITY_ENTRY_SET = new Set(
  PROTECTED_PAYROLL_FUNCTION_PARITY_ENTRIES,
);
export const AI_AGENT_BUNDLE_PATH_PATTERN =
  "^supabase/functions/(ai-agent-optimized/|_shared/(database|auth|org|logging|cors|supabaseEnv|requestAuthHeaders)\\.ts$|lib/http/error\\.ts$)";
const AI_AGENT_BUNDLE_PATH_REGEX = new RegExp(AI_AGENT_BUNDLE_PATH_PATTERN);

export const isAiAgentBundlePath = (changedPath) =>
  AI_AGENT_BUNDLE_PATH_REGEX.test(changedPath);

const getWorkflowPaths = (cwd = process.cwd()) => ({
  ciWorkflowPath: path.join(cwd, ".github", "workflows", "ci.yml"),
  tenantWorkflowPath: path.join(cwd, ".github", "workflows", "tenant-safety.yml"),
});

const readWorkflow = (filePath) => readFileSync(filePath, "utf8");
const indentation = (line) => line.match(/^ */)?.[0].length ?? 0;

const stripComment = (line, marker = "#") => {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
    } else if (character === '"' && !singleQuoted && line[index - 1] !== "\\") {
      doubleQuoted = !doubleQuoted;
    } else if (character === marker && !singleQuoted && !doubleQuoted) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
};

const unquote = (value) => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseKeyValue = (text) => {
  const match = text.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
  return match ? { key: match[1], value: match[2] ?? "" } : null;
};

const parseList = (value) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => unquote(item))
      .filter(Boolean);
  }
  return [unquote(trimmed)];
};

const readBlockScalar = (lines, startIndex, parentIndent) => {
  const body = [];
  let index = startIndex + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() && indentation(line) <= parentIndent) {
      break;
    }
    body.push(line.length > parentIndent + 2 ? line.slice(parentIndent + 2) : "");
    index += 1;
  }
  return { value: body.join("\n"), nextIndex: index };
};

const parseStep = (lines) => {
  const step = { env: {} };
  for (let index = 0; index < lines.length; index += 1) {
    const raw = stripComment(lines[index]);
    if (!raw.trim()) {
      continue;
    }

    const lineIndent = indentation(raw);
    const content = raw.trimStart();
    const fieldText = index === 0 && content.startsWith("- ") ? content.slice(2) : content;
    const field = parseKeyValue(fieldText);
    if (!field || (index > 0 && lineIndent !== 8) || (index === 0 && lineIndent !== 6)) {
      continue;
    }

    if (field.key === "env" && !field.value) {
      const envParentIndent = index === 0 ? lineIndent + 2 : lineIndent;
      for (let envIndex = index + 1; envIndex < lines.length; envIndex += 1) {
        const envRaw = stripComment(lines[envIndex]);
        if (!envRaw.trim()) {
          continue;
        }
        if (indentation(envRaw) <= envParentIndent) {
          break;
        }
        if (indentation(envRaw) === envParentIndent + 2) {
          const envField = parseKeyValue(envRaw.trim());
          if (envField) {
            step.env[envField.key] = unquote(envField.value);
          }
        }
      }
      continue;
    }

    if (field.key === "run" && /^[|>][-+]?\s*$/.test(field.value)) {
      const block = readBlockScalar(lines, index, lineIndent);
      step.run = block.value;
      index = block.nextIndex - 1;
      continue;
    }

    step[field.key] = unquote(field.value);
  }
  return step;
};

const parseSteps = (jobLines) => {
  const stepsIndex = jobLines.findIndex((line) => stripComment(line).trimEnd() === "    steps:");
  if (stepsIndex === -1) {
    return [];
  }

  const steps = [];
  for (let index = stepsIndex + 1; index < jobLines.length; ) {
    const line = stripComment(jobLines[index]);
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (indentation(line) <= 4) {
      break;
    }
    if (indentation(line) !== 6 || !line.trimStart().startsWith("- ")) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < jobLines.length) {
      const candidate = stripComment(jobLines[end]);
      if (candidate.trim() && indentation(candidate) <= 6) {
        break;
      }
      end += 1;
    }
    steps.push(parseStep(jobLines.slice(index, end)));
    index = end;
  }
  return steps;
};

const parseJob = (jobLines) => {
  const job = { needs: [], steps: parseSteps(jobLines) };
  for (let index = 1; index < jobLines.length; index += 1) {
    const raw = stripComment(jobLines[index]);
    if (!raw.trim() || indentation(raw) !== 4) {
      continue;
    }
    const field = parseKeyValue(raw.trim());
    if (!field) {
      continue;
    }
    if (field.key === "needs") {
      job.needs.push(...parseList(field.value));
      if (!field.value.trim()) {
        for (let needIndex = index + 1; needIndex < jobLines.length; needIndex += 1) {
          const needLine = stripComment(jobLines[needIndex]);
          if (!needLine.trim()) {
            continue;
          }
          if (indentation(needLine) <= 4) {
            break;
          }
          if (indentation(needLine) === 6 && needLine.trimStart().startsWith("- ")) {
            job.needs.push(unquote(needLine.trimStart().slice(2)));
          }
        }
      }
    } else if (field.key !== "steps") {
      job[field.key] = unquote(field.value);
    }
  }
  return job;
};

const parseWorkflowJobs = (content) => {
  const lines = content.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => stripComment(line).trimEnd() === "jobs:");
  if (jobsIndex === -1) {
    return {};
  }

  const jobs = {};
  for (let index = jobsIndex + 1; index < lines.length; ) {
    const line = stripComment(lines[index]);
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (indentation(line) === 0) {
      break;
    }
    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (!match) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < lines.length) {
      const candidate = stripComment(lines[end]);
      if (candidate.trim() && indentation(candidate) <= 2) {
        break;
      }
      end += 1;
    }
    jobs[match[1]] = parseJob(lines.slice(index, end));
    index = end;
  }
  return jobs;
};

const executableLines = (run = "") =>
  String(run)
    .split(/\r?\n/)
    .map((line) => stripComment(line).trim())
    .filter(Boolean);

const runText = (job) => job.steps.flatMap((step) => executableLines(step.run)).join("\n");
const stepHasExactCommand = (step, command) => executableLines(step.run).includes(command);
const stepIsExactCommand = (step, command) => {
  const lines = executableLines(step.run);
  return lines.length === 1 && lines[0] === command;
};
const stripCommandEnvironment = (line) => {
  let command = line.trim();
  if (/^env\s+/i.test(command)) {
    command = command.replace(/^env\s+/i, "");
  }
  const assignment =
    /^[A-Za-z_][A-Za-z0-9_]*=(?:"(?:\\.|[^"])*"|'[^']*'|\$\{\{[^}]*\}\}|\S+)\s+/;
  while (assignment.test(command)) {
    command = command.replace(assignment, "");
  }
  return command;
};
const unwrapPackageExec = (line) =>
  stripCommandEnvironment(line).replace(
    /^(?:npx(?:\s+--(?:yes|no-install))?|pnpm\s+exec|npm\s+exec\s+--|yarn\s+exec)\s+/i,
    "",
  );
const splitExecutable = (line) => {
  const match = line.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }
  return {
    executable: match[1] ?? match[2] ?? match[3],
    argumentsText: match[4] ?? "",
  };
};
const normalizeScriptCommand = (line) => {
  const command = splitExecutable(stripCommandEnvironment(unwrapInterpreterCommands(line)));
  if (!command) {
    return null;
  }
  const executableName = command.executable.replaceAll("\\", "/").split("/").at(-1);
  if (!/^(?:npm|npm\.cmd|npm\.exe)$/i.test(executableName ?? "")) {
    return null;
  }
  let argumentsText = command.argumentsText.trim();
  for (let depth = 0; depth < 8; depth += 1) {
    const next = argumentsText
      .replace(/^--silent(?:=true)?\s+/i, "")
      .replace(/^-s\s+/i, "")
      .replace(/^--prefix(?:=\S+|\s+\S+)\s+/i, "");
    if (next === argumentsText) {
      break;
    }
    argumentsText = next;
  }
  const match = argumentsText.match(
    /^run(?:-script)?\s+(?:--\s+)?([A-Za-z0-9:_-]+)(?:\s+[\s\S]*)?$/i,
  );
  return match ? `npm run ${match[1]}` : null;
};
const unwrapQuotedCommand = (value) => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};
const unwrapInterpreterCommands = (line) => {
  let commandText = line;
  for (let depth = 0; depth < 4; depth += 1) {
    const command = splitExecutable(stripCommandEnvironment(commandText));
    if (!command) {
      return commandText;
    }
    const executableName = command.executable.replaceAll("\\", "/").split("/").at(-1);
    let wrappedCommand = null;

    if (/^(?:ba|z|da|a|k)?sh$/i.test(executableName ?? "")) {
      wrappedCommand =
        command.argumentsText.match(
          /^(?:--[A-Za-z0-9-]+\s+)*-[A-Za-z]*c[A-Za-z]*\s+(?:--\s+)?([\s\S]+)$/,
        )?.[1] ?? null;
    } else if (/^(?:pwsh|powershell)(?:\.exe)?$/i.test(executableName ?? "")) {
      wrappedCommand =
        command.argumentsText.match(
          /^(?:-(?:NoProfile|NonInteractive|NoLogo)\s+)*(?:-ExecutionPolicy\s+\S+\s+)?-(?:Command|c)\s+([\s\S]+)$/i,
        )?.[1] ?? null;
    } else if (/^cmd(?:\.exe)?$/i.test(executableName ?? "")) {
      wrappedCommand =
        command.argumentsText.match(/^(?:\/[dqs]\s+)*\/c\s+([\s\S]+)$/i)?.[1] ??
        null;
    }

    if (!wrappedCommand) {
      return commandText;
    }
    commandText = unwrapQuotedCommand(wrappedCommand);
  }
  return commandText;
};
const isSupabaseDeployInvocation = (line) => {
  const command = splitExecutable(unwrapPackageExec(unwrapInterpreterCommands(line)));
  if (!command) {
    return false;
  }
  const executableName = command.executable.replaceAll("\\", "/").split("/").at(-1);
  return (
    /^supabase(?:\.exe|\.cmd)?$/i.test(executableName ?? "") &&
    /^functions\s+deploy\b/i.test(command.argumentsText)
  );
};
const isDirectNodeDeployScript = (line, scriptPath) => {
  const command = splitExecutable(
    stripCommandEnvironment(unwrapInterpreterCommands(line)),
  );
  if (!command) {
    return false;
  }
  const executableName = command.executable.replaceAll("\\", "/").split("/").at(-1);
  return (
    /^node(?:\.exe)?$/i.test(executableName ?? "") &&
    new RegExp(`^${scriptPath.replaceAll("/", "\\/")}(?:\\s|$)`, "i").test(
      command.argumentsText,
    )
  );
};
const isRawSessionDeployInvocation = (line) =>
  isDirectNodeDeployScript(line, "scripts/ci/deploy-session-edge-bundle.mjs") ||
  normalizeScriptCommand(line) === DEPLOY_COMMAND ||
  (isSupabaseDeployInvocation(line) && !/\bai-agent-optimized\b/i.test(line));
const isRawAiDeployInvocation = (line) =>
  isDirectNodeDeployScript(line, "scripts/ci/deploy-ai-agent-function.mjs") ||
  normalizeScriptCommand(line) === AI_DEPLOY_COMMAND ||
  (isSupabaseDeployInvocation(line) && /\bai-agent-optimized\b/i.test(line));
const isRawPayrollDeployInvocation = (line) =>
  isDirectNodeDeployScript(line, "scripts/ci/deploy-payroll-timesheets-function.mjs") ||
  line === PAYROLL_DEPLOY_COMMAND ||
  (isSupabaseDeployInvocation(line) && /\bpayroll-timesheets\b/i.test(line));
const isRawPayrollExportDeployInvocation = (line) =>
  isDirectNodeDeployScript(line, "scripts/ci/deploy-payroll-export-function.mjs") ||
  line === PAYROLL_EXPORT_DEPLOY_COMMAND ||
  (isSupabaseDeployInvocation(line) && /\bpayroll-export\b/i.test(line));
const isRawPayrollApprovalsDeployInvocation = (line) =>
  isDirectNodeDeployScript(line, "scripts/ci/deploy-payroll-approvals-function.mjs") ||
  line === PAYROLL_APPROVALS_DEPLOY_COMMAND ||
  (isSupabaseDeployInvocation(line) && /\bpayroll-approvals\b/i.test(line));
const isRawPayrollAdministrationDeployInvocation = (line) =>
  (line !== PAYROLL_ADMINISTRATION_SECRET_VERIFY_COMMAND &&
    isDirectNodeDeployScript(line, "scripts/ci/deploy-payroll-administration-function.mjs")) ||
  line === PAYROLL_ADMINISTRATION_DEPLOY_COMMAND ||
  (isSupabaseDeployInvocation(line) && /\bpayroll-administration\b/i.test(line));
const isRawFillDocsDeployInvocation = (line) =>
  isDirectNodeDeployScript(line, "scripts/ci/deploy-fill-docs-function.mjs") ||
  normalizeScriptCommand(line) === FILL_DOCS_DEPLOY_COMMAND;
const sameSet = (actual, expected) => {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.length === sortedExpected.length && sortedActual.every((value, index) => value === sortedExpected[index]);
};
const sameSequence = (actual, expected) =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index]);
const sameRecord = (actual, expected) =>
  sameSet(Object.keys(actual ?? {}), Object.keys(expected)) &&
  Object.entries(expected).every(([name, value]) => actual?.[name] === value);
const hasSequence = (lines, sequence) =>
  lines.some((_, index) => sequence.every((value, offset) => lines[index + offset] === value));
const hasOrderedSequence = (lines, sequence) => {
  let cursor = 0;
  for (const line of lines) {
    if (line === sequence[cursor]) {
      cursor += 1;
      if (cursor === sequence.length) {
        return true;
      }
    }
  }
  return false;
};

const requireJob = (jobs, name, violations) => {
  const job = jobs[name];
  if (!job) {
    violations.push(`${name} job is missing`);
  }
  return job;
};

const APPROVED_UPSTASH_SECRET_REFERENCE_LINES = [
  "UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}",
  "UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}",
];

const isBlockScalarIndicator = (value) => /^[|>][-+]?\s*$/.test(value);

const readInlineScalar = (lines, startIndex, parentIndent, initialValue) => {
  const body = [initialValue];
  let index = startIndex + 1;
  while (index < lines.length) {
    const raw = stripComment(lines[index]);
    if (!raw.trim()) {
      body.push("");
      index += 1;
      continue;
    }

    const lineIndent = indentation(raw);
    if (lineIndent <= parentIndent) {
      break;
    }

    const trimmed = raw.trimStart();
    if (trimmed.startsWith("- ") || parseKeyValue(trimmed)) {
      break;
    }

    body.push(raw.slice(Math.min(lineIndent, parentIndent + 2)));
    index += 1;
  }

  return {
    value: body.length === 1 ? unquote(initialValue) : body.join("\n").trim(),
    nextIndex: index,
  };
};

const extractWorkflowScalarValues = (workflowContent) => {
  const lines = workflowContent.split(/\r?\n/);
  const values = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = stripComment(lines[index]);
    if (!raw.trim()) {
      continue;
    }

    const lineIndent = indentation(raw);
    const trimmed = raw.trimStart();
    const fieldText = trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed;
    const field = parseKeyValue(fieldText);

    if (field) {
      if (!field.value) {
        continue;
      }
      if (isBlockScalarIndicator(field.value)) {
        const block = readBlockScalar(lines, index, lineIndent);
        values.push({ key: field.key, value: block.value });
        index = block.nextIndex - 1;
        continue;
      }
      const scalar = readInlineScalar(lines, index, lineIndent, field.value);
      values.push({ key: field.key, value: scalar.value });
      index = scalar.nextIndex - 1;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const listValue = trimmed.slice(2).trim();
      if (!listValue) {
        continue;
      }
      if (isBlockScalarIndicator(listValue)) {
        const block = readBlockScalar(lines, index, lineIndent);
        values.push({ key: null, value: block.value });
        index = block.nextIndex - 1;
        continue;
      }
      const scalar = readInlineScalar(lines, index, lineIndent, listValue);
      values.push({ key: null, value: scalar.value });
      index = scalar.nextIndex - 1;
    }
  }

  return values;
};

const expressionContainsWholeSecretsContext = (expression) => {
  const normalized = expression.trim();
  if (!normalized) {
    return false;
  }

  if (/\bfromjson\s*\(\s*tojson\s*\(\s*secrets\s*\)\s*\)/i.test(normalized)) {
    return true;
  }
  if (/\btojson\s*\(\s*secrets\s*\)/i.test(normalized)) {
    return true;
  }

  for (const match of normalized.matchAll(/\bsecrets\b/gi)) {
    const suffix = normalized.slice(match.index + "secrets".length);
    const next = suffix.match(/^\s*(.)/)?.[1] ?? "";
    if (next !== ".") {
      return true;
    }

    const property = suffix.slice(suffix.indexOf(".") + 1).trimStart();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*/.test(property)) {
      return true;
    }
  }

  return false;
};

const scalarContainsWholeSecretsContext = ({ key, value }) => {
  const normalized = String(value).trim();
  if (!normalized) {
    return false;
  }

  for (const expression of normalized.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    if (expressionContainsWholeSecretsContext(expression[1] ?? "")) {
      return true;
    }
  }

  return key === "if" && expressionContainsWholeSecretsContext(normalized);
};

const workflowUsesWholeSecretsContext = (workflowContent) => {
  for (const scalar of extractWorkflowScalarValues(workflowContent)) {
    if (scalarContainsWholeSecretsContext(scalar)) {
      return true;
    }
  }

  const normalizedRaw = workflowContent
    .split(/\r?\n/)
    .map((line) => stripComment(line))
    .join("\n");
  for (const expression of normalizedRaw.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    if (expressionContainsWholeSecretsContext(expression[1] ?? "")) {
      return true;
    }
  }

  return false;
};

export const evaluateSessionDeploySafety = ({ ciWorkflow, tenantWorkflow }) => {
  const violations = [];
  if (!/workflow_dispatch:\s*\n\s+inputs:\s*\n\s+activate_payroll_timesheets:\s*\n\s+description:[^\n]+\n\s+required:\s*true\s*\n\s+type:\s*boolean\s*\n\s+default:\s*false/.test(ciWorkflow)) {
    violations.push("workflow_dispatch must define a required default-false boolean activate_payroll_timesheets input");
  }
  if (!/activate_payroll_approvals:\s*\n\s+description:[^\n]+\n\s+required:\s*true\s*\n\s+type:\s*boolean\s*\n\s+default:\s*false/.test(ciWorkflow)) {
    violations.push("workflow_dispatch must define a required default-false boolean activate_payroll_approvals input");
  }
  if (!/activate_payroll_export:\s*\n\s+description:[^\n]+\n\s+required:\s*true\s*\n\s+type:\s*boolean\s*\n\s+default:\s*false/.test(ciWorkflow)) {
    violations.push("workflow_dispatch must define a required default-false boolean activate_payroll_export input");
  }
  if (!/activate_payroll_administration:\s*\n\s+description:[^\n]+\n\s+required:\s*true\s*\n\s+type:\s*boolean\s*\n\s+default:\s*false/.test(ciWorkflow)) {
    violations.push("workflow_dispatch must define a required default-false boolean activate_payroll_administration input");
  }
  if (!/approval_acknowledgement:\s*\n\s+description:\s*Exact owner approval acknowledgement\s*\n\s+required:\s*true\s*\n\s+type:\s*string/.test(ciWorkflow)) {
    violations.push("workflow_dispatch must define a required string approval_acknowledgement input for protected payroll activation");
  }
  const jobs = parseWorkflowJobs(ciWorkflow);
  const tenantJobs = parseWorkflowJobs(tenantWorkflow);

  const changeScope = requireJob(jobs, "change_scope", violations);
  const policy = requireJob(jobs, "policy", violations);
  const runtimeParity = requireJob(jobs, "runtime_migration_parity", violations);
  const runtimeContract = requireJob(jobs, "start_session_runtime_contract", violations);
  const deploy = requireJob(jobs, "deploy_session_edge", violations);
  const deployAiAgent = requireJob(jobs, "deploy_ai_agent_edge", violations);
  const deployPayroll = requireJob(jobs, "deploy_payroll_timesheets", violations);
  const deployPayrollExport = requireJob(jobs, "deploy_payroll_export", violations);
  const deployPayrollApprovals = requireJob(jobs, "deploy_payroll_approvals", violations);
  const deployPayrollAdministration = requireJob(jobs, "deploy_payroll_administration", violations);
  const authSmoke = requireJob(jobs, "auth_browser_smoke", violations);
  const ciGate = requireJob(jobs, "ci_gate", violations);

  if (changeScope) {
    const detectRun = changeScope.steps.find((step) => step.id === "detect")?.run ?? "";
    if (!String(changeScope.outputs?.ai_agent_changed ?? "").trim() && !/\bai_agent_changed\b/.test(detectRun)) {
      violations.push("change_scope must expose ai_agent_changed output");
    }
    const mergeGroupContract = /elif\s+\[\s*"\$\{GITHUB_EVENT_NAME\}"\s*=\s*"merge_group"\s*\]\s*;\s*then[\s\S]*?base_sha="\$\{\{\s*github\.event\.merge_group\.base_sha\s*\}\}"[\s\S]*?head_sha="\$\{\{\s*github\.event\.merge_group\.head_sha\s*\}\}"/;
    if (!mergeGroupContract.test(executableLines(detectRun).join("\n"))) {
      violations.push("change_scope must map merge_group base_sha and head_sha from the merge-group event");
    }
    if (!/elif\s+\[\s*"\$\{GITHUB_EVENT_NAME\}"\s*=\s*"workflow_dispatch"\s*\]\s*;\s*then[\s\S]*?base_sha="\$\{GITHUB_SHA\}\^"[\s\S]*?head_sha="\$\{GITHUB_SHA\}"/.test(detectRun)) {
      violations.push("change_scope must map workflow_dispatch to the selected commit and its first parent");
    }
    if (!detectRun.includes(`grep -Eq '${AI_AGENT_BUNDLE_PATH_PATTERN}'`)) {
      violations.push(
        "change_scope ai_agent_changed must match the actual ai-agent-optimized bundle manifest exactly",
      );
    }
    if (!/echo\s+"ai_agent_changed=true"\s*>>\s*"\$\{GITHUB_OUTPUT\}"/.test(detectRun)) {
      violations.push(
        "change_scope must use safe fallback true when diff metadata is unavailable",
      );
    }
    if (
      !/ai_agent_changed=false/.test(detectRun) ||
      !/echo\s+"ai_agent_changed=\$\{ai_agent_changed\}"\s*>>\s*"\$\{GITHUB_OUTPUT\}"/.test(
        detectRun,
      )
    ) {
      violations.push(
        "change_scope must initialize ai_agent_changed false and expose the detected result",
      );
    }
  }

  const deploySteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepIsExactCommand(step, DEPLOY_COMMAND)).map((step) => ({ jobName, step })),
  );
  const aiDeploySteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepIsExactCommand(step, AI_DEPLOY_COMMAND)).map((step) => ({ jobName, step })),
  );
  const payrollDeploySteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepIsExactCommand(step, PAYROLL_DEPLOY_COMMAND)).map((step) => ({ jobName, step })),
  );
  const payrollExportDeploySteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepIsExactCommand(step, PAYROLL_EXPORT_DEPLOY_COMMAND)).map((step) => ({ jobName, step })),
  );
  const payrollApprovalsDeploySteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepIsExactCommand(step, PAYROLL_APPROVALS_DEPLOY_COMMAND)).map((step) => ({ jobName, step })),
  );
  const payrollAdministrationDeploySteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepIsExactCommand(step, PAYROLL_ADMINISTRATION_DEPLOY_COMMAND)).map((step) => ({ jobName, step })),
  );
  const payrollExportPrereqSteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepHasExactCommand(step, PAYROLL_EXPORT_DEPLOY_PREREQ_COMMAND)).map((step) => ({ jobName, step })),
  );
  const payrollApprovalsPrereqSteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepHasExactCommand(step, PAYROLL_APPROVALS_DEPLOY_PREREQ_COMMAND)).map((step) => ({ jobName, step })),
  );
  const payrollAdministrationPrereqSteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepHasExactCommand(step, PAYROLL_ADMINISTRATION_DEPLOY_PREREQ_COMMAND)).map((step) => ({ jobName, step })),
  );
  const fillDocsDeploySteps = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.filter((step) => stepIsExactCommand(step, FILL_DOCS_DEPLOY_COMMAND)).map((step) => ({ jobName, step })),
  );
  const deployInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === DEPLOY_COMMAND || isRawSessionDeployInvocation(line))
        .map((line) => ({ jobName, line })),
    ),
  );
  const aiDeployInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === AI_DEPLOY_COMMAND || isRawAiDeployInvocation(line))
        .map((line) => ({ jobName, line })),
    ),
  );
  const payrollDeployInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === PAYROLL_DEPLOY_COMMAND || isRawPayrollDeployInvocation(line))
        .map((line) => ({ jobName, line })),
    ),
  );
  const payrollExportDeployInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === PAYROLL_EXPORT_DEPLOY_COMMAND || isRawPayrollExportDeployInvocation(line))
        .map((line) => ({ jobName, line })),
    ),
  );
  const payrollApprovalsDeployInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === PAYROLL_APPROVALS_DEPLOY_COMMAND || isRawPayrollApprovalsDeployInvocation(line))
        .map((line) => ({ jobName, line })),
    ),
  );
  const payrollAdministrationDeployInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === PAYROLL_ADMINISTRATION_DEPLOY_COMMAND || isRawPayrollAdministrationDeployInvocation(line))
        .map((line) => ({ jobName, line })),
    ),
  );
  const payrollApprovalsPrereqInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === PAYROLL_APPROVALS_DEPLOY_PREREQ_COMMAND)
        .map((line) => ({ jobName, line })),
    ),
  );
  const payrollAdministrationPrereqInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === PAYROLL_ADMINISTRATION_DEPLOY_PREREQ_COMMAND)
        .map((line) => ({ jobName, line })),
    ),
  );
  const payrollExportPrereqInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === PAYROLL_EXPORT_DEPLOY_PREREQ_COMMAND)
        .map((line) => ({ jobName, line })),
    ),
  );
  const fillDocsDeployInvocations = Object.entries(jobs).flatMap(([jobName, job]) =>
    job.steps.flatMap((step) =>
      executableLines(step.run)
        .filter((line) => line === FILL_DOCS_DEPLOY_COMMAND || isRawFillDocsDeployInvocation(line))
        .map((line) => ({ jobName, line })),
    ),
  );
  if (deploySteps.length !== 1 || deploySteps[0]?.jobName !== "deploy_session_edge") {
    violations.push("CI workflow must contain exactly one session edge deploy command");
    violations.push("CI workflow must contain exactly one real session edge deploy run step in deploy_session_edge");
  }
  if (
    deployInvocations.some(
      ({ jobName, line }) => jobName !== "deploy_session_edge" || line !== DEPLOY_COMMAND,
    )
  ) {
    violations.push("CI workflow must contain exactly one session edge deploy command");
  }
  if (fillDocsDeploySteps.length !== 1 || fillDocsDeploySteps[0]?.jobName !== "deploy_session_edge") {
    violations.push("CI workflow must contain exactly one fill-docs deploy command in deploy_session_edge");
  }
  if (
    fillDocsDeployInvocations.some(
      ({ jobName, line }) => jobName !== "deploy_session_edge" || line !== FILL_DOCS_DEPLOY_COMMAND,
    )
  ) {
    violations.push("CI workflow must contain exactly one fill-docs deploy command");
  }
  if (aiDeploySteps.length !== 1 || aiDeploySteps[0]?.jobName !== "deploy_ai_agent_edge") {
    violations.push("CI workflow must contain exactly one ai-agent deploy command");
    violations.push("CI workflow must contain exactly one real ai-agent deploy run step in deploy_ai_agent_edge");
  }
  if (
    aiDeployInvocations.some(
      ({ jobName, line }) => jobName !== "deploy_ai_agent_edge" || line !== AI_DEPLOY_COMMAND,
    )
  ) {
    violations.push("CI workflow must contain exactly one ai-agent deploy command");
  }
  if (payrollDeploySteps.length !== 1 || payrollDeploySteps[0]?.jobName !== "deploy_payroll_timesheets") {
    violations.push("CI workflow must contain exactly one payroll-timesheets deploy command");
  }
  if (
    payrollDeployInvocations.some(
      ({ jobName, line }) => jobName !== "deploy_payroll_timesheets" || line !== PAYROLL_DEPLOY_COMMAND,
    )
  ) {
    violations.push("CI workflow must contain exactly one payroll-timesheets deploy command");
  }
  if (
    payrollExportDeploySteps.length !== 1 ||
    payrollExportDeploySteps[0]?.jobName !== "deploy_payroll_export" ||
    payrollExportDeployInvocations.length !== 1 ||
    payrollExportDeployInvocations[0]?.jobName !== "deploy_payroll_export" ||
    payrollExportDeployInvocations[0]?.line !== PAYROLL_EXPORT_DEPLOY_COMMAND
  ) {
    violations.push("CI workflow must contain exactly one payroll-export deploy command");
  }
  if (
    payrollExportPrereqSteps.length !== 1 ||
    payrollExportPrereqSteps[0]?.jobName !== "deploy_payroll_export" ||
    payrollExportPrereqInvocations.length !== 1 ||
    payrollExportPrereqInvocations[0]?.jobName !== "deploy_payroll_export" ||
    payrollExportPrereqInvocations[0]?.line !== PAYROLL_EXPORT_DEPLOY_PREREQ_COMMAND
  ) {
    violations.push("CI workflow must contain exactly one payroll-export deploy prerequisite command");
  }
  if (
    payrollApprovalsDeploySteps.length !== 1 ||
    payrollApprovalsDeploySteps[0]?.jobName !== "deploy_payroll_approvals" ||
    payrollApprovalsDeployInvocations.length !== 1 ||
    payrollApprovalsDeployInvocations[0]?.jobName !== "deploy_payroll_approvals" ||
    payrollApprovalsDeployInvocations[0]?.line !== PAYROLL_APPROVALS_DEPLOY_COMMAND
  ) {
    violations.push("CI workflow must contain exactly one payroll-approvals deploy command");
  }
  if (
    payrollApprovalsPrereqSteps.length !== 1 ||
    payrollApprovalsPrereqSteps[0]?.jobName !== "deploy_payroll_approvals" ||
    payrollApprovalsPrereqInvocations.length !== 1 ||
    payrollApprovalsPrereqInvocations[0]?.jobName !== "deploy_payroll_approvals" ||
    payrollApprovalsPrereqInvocations[0]?.line !== PAYROLL_APPROVALS_DEPLOY_PREREQ_COMMAND
  ) {
    violations.push("CI workflow must contain exactly one payroll-approvals deploy prerequisite command");
  }
  if (
    payrollAdministrationDeploySteps.length !== 1 ||
    payrollAdministrationDeploySteps[0]?.jobName !== "deploy_payroll_administration" ||
    payrollAdministrationDeployInvocations.length !== 1 ||
    payrollAdministrationDeployInvocations[0]?.jobName !== "deploy_payroll_administration" ||
    payrollAdministrationDeployInvocations[0]?.line !== PAYROLL_ADMINISTRATION_DEPLOY_COMMAND
  ) {
    violations.push("CI workflow must contain exactly one payroll-administration deploy command");
  }
  if (
    payrollAdministrationPrereqSteps.length !== 1 ||
    payrollAdministrationPrereqSteps[0]?.jobName !== "deploy_payroll_administration" ||
    payrollAdministrationPrereqInvocations.length !== 1 ||
    payrollAdministrationPrereqInvocations[0]?.jobName !== "deploy_payroll_administration" ||
    payrollAdministrationPrereqInvocations[0]?.line !== PAYROLL_ADMINISTRATION_DEPLOY_PREREQ_COMMAND
  ) {
    violations.push("CI workflow must contain exactly one payroll-administration deploy prerequisite command");
  }

  if (policy) {
    const policyRuns = runText(policy);
    for (const forbidden of [DEPLOY_COMMAND, FILL_DOCS_DEPLOY_COMMAND, AI_DEPLOY_COMMAND, PAYROLL_DEPLOY_COMMAND, PAYROLL_EXPORT_DEPLOY_COMMAND, PAYROLL_APPROVALS_DEPLOY_COMMAND, PAYROLL_ADMINISTRATION_DEPLOY_COMMAND, "npm run validate:tenant", "check-runtime-migration-parity.mjs", "check-session-runtime-contract.mjs"]) {
      if (policyRuns.includes(forbidden)) {
        violations.push("policy job must stay read-only and may not run `" + forbidden + "`");
      }
    }
    const parityStep = policy.steps.find((step) => stepHasExactCommand(step, "npm run ci:check-focused"));
    const parityScope = parityStep?.env?.SUPABASE_FUNCTION_PARITY_SCOPE ?? "";
    const scopeEntries = parityScope
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const pendingScope = parityStep?.env?.SUPABASE_PENDING_FUNCTION_PARITY_SCOPE ?? "";
    const pendingEntries = pendingScope
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const unsupportedPendingEntries = pendingEntries.filter(
      (entry) => !PROTECTED_PAYROLL_FUNCTION_PARITY_ENTRY_SET.has(entry),
    );
    if (unsupportedPendingEntries.length > 0) {
      violations.push(
        "SUPABASE_PENDING_FUNCTION_PARITY_SCOPE may contain only protected payroll bootstrap functions",
      );
    }
    for (const functionName of PROTECTED_PAYROLL_FUNCTION_PARITY_ENTRIES) {
      const isDeployed = scopeEntries.includes(functionName);
      const isPending = pendingEntries.includes(functionName);
      if (!isDeployed && !isPending) {
        violations.push(`Supabase function parity scopes must include ${functionName}`);
      }
      if (isDeployed && isPending) {
        violations.push(
          `${functionName} must not appear in both deployed and pending Supabase function parity scopes`,
        );
      }
    }
  }

  if (runtimeParity) {
    if (runtimeParity.if !== RUNTIME_PARITY_IF) {
      violations.push(
        "runtime_migration_parity must be restricted to main pushes or explicit payroll activation",
      );
    }
    const parityStep = runtimeParity.steps.find((step) => stepHasExactCommand(step, "node scripts/ci/check-runtime-migration-parity.mjs"));
    if (
      !parityStep ||
      parityStep.env.MIGRATION_PARITY_BASE_SHA !== "${{ needs.change_scope.outputs.base_sha }}" ||
      parityStep.env.MIGRATION_PARITY_HEAD_SHA !== "${{ needs.change_scope.outputs.head_sha }}" ||
      parityStep.env.MIGRATION_PARITY_REQUIRED_MIGRATIONS !== WIN_219_PAYROLL_MIGRATION_CONTRACT ||
      parityStep.env.ACTIVATE_PAYROLL_TIMESHEETS !== "${{ inputs.activate_payroll_timesheets || false }}" ||
      parityStep.env.ACTIVATE_PAYROLL_EXPORT !== "${{ inputs.activate_payroll_export || false }}" ||
      parityStep.env.ACTIVATE_PAYROLL_APPROVALS !== "${{ inputs.activate_payroll_approvals || false }}" ||
      parityStep.env.ACTIVATE_PAYROLL_ADMINISTRATION !== "${{ inputs.activate_payroll_administration || false }}" ||
      parityStep.env.SUPABASE_DB_URL !== "${{ secrets.SUPABASE_DB_URL }}"
    ) {
      violations.push("runtime_migration_parity must run the merge-range checker with change_scope SHAs, the explicit WIN-219 payroll migration contract, activation flags, and SUPABASE_DB_URL");
    }
  }

  if (runtimeContract) {
    const contractStep = runtimeContract.steps.find((step) => stepHasExactCommand(step, "node scripts/ci/check-session-runtime-contract.mjs"));
    if (!contractStep || contractStep.env.SUPABASE_DB_URL !== "${{ secrets.SUPABASE_DB_URL }}") {
      violations.push("start_session_runtime_contract must run check-session-runtime-contract.mjs with SUPABASE_DB_URL");
    }
  }

  if (deploy) {
    if (deploy.if !== MAIN_PUSH_IF) {
      violations.push("deploy_session_edge must be restricted to push on refs/heads/main using the exact event/ref condition");
    }
    if (!sameSet(deploy.needs, DEPLOY_NEEDS)) {
      violations.push(`deploy_session_edge needs must exactly equal ${DEPLOY_NEEDS.join(", ")}`);
    }
    const prereqIndex = deploy.steps.findIndex((step) => step.name === "Validate session edge deploy prerequisites");
    const deployIndex = deploy.steps.findIndex((step) => stepIsExactCommand(step, DEPLOY_COMMAND));
    const fillDocsDeployIndex = deploy.steps.findIndex((step) => stepIsExactCommand(step, FILL_DOCS_DEPLOY_COMMAND));
    if (
      prereqIndex === -1 ||
      deployIndex === -1 ||
      fillDocsDeployIndex === -1 ||
      prereqIndex > deployIndex ||
      deployIndex > fillDocsDeployIndex
    ) {
      violations.push("deploy_session_edge must validate deploy prerequisites before deploying");
    }
    const prereqStep = deploy.steps[prereqIndex];
    if (!prereqStep || !stepIsExactCommand(prereqStep, SESSION_DEPLOY_PREREQ_COMMAND)) {
      violations.push(
        "deploy_session_edge must run the shared edge deploy prerequisite helper",
      );
    }
  }

  if (deployAiAgent) {
    if (deployAiAgent.if !== AI_DEPLOY_IF) {
      violations.push("deploy_ai_agent_edge must be restricted to push on refs/heads/main with ai_agent_changed == 'true'");
    }
    if (!sameSet(deployAiAgent.needs, AI_DEPLOY_NEEDS)) {
      violations.push(`deploy_ai_agent_edge needs must exactly equal ${AI_DEPLOY_NEEDS.join(", ")}`);
    }
    const prereqIndex = deployAiAgent.steps.findIndex((step) => step.name === "Validate AI agent edge deploy prerequisites");
    const deployIndex = deployAiAgent.steps.findIndex((step) => stepIsExactCommand(step, AI_DEPLOY_COMMAND));
    if (prereqIndex === -1 || deployIndex === -1 || prereqIndex > deployIndex) {
      violations.push("deploy_ai_agent_edge must validate deploy prerequisites before deploying");
    }
    const prereqStep = deployAiAgent.steps[prereqIndex];
    if (!prereqStep || !stepIsExactCommand(prereqStep, AI_DEPLOY_PREREQ_COMMAND)) {
      violations.push(
        "deploy_ai_agent_edge must run the shared edge deploy prerequisite helper",
      );
    }
  }

  if (deployPayroll) {
    if (deployPayroll.if !== PAYROLL_ACTIVATION_IF) {
      const activationIf = deployPayroll.if ?? "";
      if (
        !activationIf.includes("github.event_name == 'workflow_dispatch'") ||
        !activationIf.includes("inputs.activate_payroll_timesheets == true")
      ) {
        violations.push("deploy_payroll_timesheets must require explicit manual activation");
      } else if (!activationIf.includes(`inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}'`)) {
        violations.push("deploy_payroll_timesheets must require the exact protected payroll approval acknowledgement");
      } else {
        violations.push("deploy_payroll_timesheets must require immutable current-main manual activation");
      }
    }
    if (!sameSet(deployPayroll.needs, PAYROLL_DEPLOY_NEEDS)) {
      violations.push(`deploy_payroll_timesheets needs must exactly equal ${PAYROLL_DEPLOY_NEEDS.join(", ")}`);
    }
    const prereqIndex = deployPayroll.steps.findIndex((step) => step.name === "Validate payroll-timesheets deploy prerequisites");
    const deployIndex = deployPayroll.steps.findIndex((step) => stepIsExactCommand(step, PAYROLL_DEPLOY_COMMAND));
    if (prereqIndex === -1 || deployIndex === -1 || prereqIndex > deployIndex) {
      violations.push("deploy_payroll_timesheets must validate deploy prerequisites before deploying");
    }
    const prereqStep = deployPayroll.steps[prereqIndex];
    if (!prereqStep || !stepIsExactCommand(prereqStep, PAYROLL_DEPLOY_PREREQ_COMMAND)) {
      violations.push(
        "deploy_payroll_timesheets must run the shared edge deploy prerequisite helper",
      );
    }

    const firstAttestationIndex = deployPayroll.steps.findIndex(
      (step) => step.name === PAYROLL_TIMESHEETS_FIRST_ATTESTATION_STEP,
    );
    const firstAttestationStep = deployPayroll.steps[firstAttestationIndex];
    const credentialStepIndexes = deployPayroll.steps.flatMap((step, index) =>
      Object.keys(step.env ?? {}).some((name) => PAYROLL_TIMESHEETS_DEPLOY_CREDENTIAL_NAMES.has(name))
        ? [index]
        : [],
    );
    if (
      firstAttestationIndex === -1 ||
      !firstAttestationStep ||
      !sameRecord(firstAttestationStep.env, PAYROLL_TIMESHEETS_ATTESTATION_ENV) ||
      !sameSequence(executableLines(firstAttestationStep.run), PAYROLL_TIMESHEETS_ATTESTATION_LINES) ||
      credentialStepIndexes.length === 0 ||
      credentialStepIndexes.some((index) => index <= firstAttestationIndex)
    ) {
      violations.push("deploy_payroll_timesheets must attest current main before every deploy credential binding");
    }

    const finalAttestationIndex = deployPayroll.steps.findIndex(
      (step) => step.name === PAYROLL_TIMESHEETS_FINAL_ATTESTATION_STEP,
    );
    const finalAttestationStep = deployPayroll.steps[finalAttestationIndex];
    if (
      finalAttestationIndex !== deployIndex - 1 ||
      !finalAttestationStep ||
      !sameRecord(finalAttestationStep.env, PAYROLL_TIMESHEETS_ATTESTATION_ENV) ||
      !sameSequence(executableLines(finalAttestationStep.run), PAYROLL_TIMESHEETS_ATTESTATION_LINES)
    ) {
      violations.push("deploy_payroll_timesheets must verify github.sha equals live origin/main immediately before deploy");
    }
  }

  if (deployPayrollExport) {
    if (deployPayrollExport.if !== PAYROLL_EXPORT_ACTIVATION_IF) {
      const activationIf = deployPayrollExport.if ?? "";
      if (
        !activationIf.includes("github.event_name == 'workflow_dispatch'") ||
        !activationIf.includes("inputs.activate_payroll_export == true")
      ) {
        violations.push("deploy_payroll_export must require explicit manual activation");
      } else if (!activationIf.includes(`inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}'`)) {
        violations.push("deploy_payroll_export must require the exact protected payroll approval acknowledgement");
      } else {
        violations.push("deploy_payroll_export must require immutable current-main manual activation");
      }
    }
    if (!sameSet(deployPayrollExport.needs, PAYROLL_DEPLOY_NEEDS)) {
      violations.push(`deploy_payroll_export needs must exactly equal ${PAYROLL_DEPLOY_NEEDS.join(", ")}`);
    }
    const prereqIndex = deployPayrollExport.steps.findIndex(
      (step) => step.name === "Validate payroll-export deploy prerequisites",
    );
    const deployIndex = deployPayrollExport.steps.findIndex(
      (step) => stepIsExactCommand(step, PAYROLL_EXPORT_DEPLOY_COMMAND),
    );
    if (prereqIndex === -1 || deployIndex === -1 || prereqIndex > deployIndex) {
      violations.push("deploy_payroll_export must validate deploy prerequisites before deploying");
    }
    const prereqStep = deployPayrollExport.steps[prereqIndex];
    if (!prereqStep || !stepIsExactCommand(prereqStep, PAYROLL_EXPORT_DEPLOY_PREREQ_COMMAND)) {
      violations.push("deploy_payroll_export must run the shared edge deploy prerequisite helper");
    }

    const firstAttestationIndex = deployPayrollExport.steps.findIndex(
      (step) => step.name === PAYROLL_EXPORT_FIRST_ATTESTATION_STEP,
    );
    const firstAttestationStep = deployPayrollExport.steps[firstAttestationIndex];
    const credentialStepIndexes = deployPayrollExport.steps.flatMap((step, index) =>
      Object.keys(step.env ?? {}).some((name) => PAYROLL_EXPORT_DEPLOY_CREDENTIAL_NAMES.has(name))
        ? [index]
        : [],
    );
    if (
      firstAttestationIndex === -1 ||
      !firstAttestationStep ||
      !sameRecord(firstAttestationStep.env, PAYROLL_EXPORT_ATTESTATION_ENV) ||
      !sameSequence(executableLines(firstAttestationStep.run), PAYROLL_EXPORT_ATTESTATION_LINES) ||
      credentialStepIndexes.length === 0 ||
      credentialStepIndexes.some((index) => index <= firstAttestationIndex)
    ) {
      violations.push("deploy_payroll_export must attest current main before every deploy credential binding");
    }

    const finalAttestationIndex = deployPayrollExport.steps.findIndex(
      (step) => step.name === PAYROLL_EXPORT_FINAL_ATTESTATION_STEP,
    );
    const finalAttestationStep = deployPayrollExport.steps[finalAttestationIndex];
    if (
      finalAttestationIndex !== deployIndex - 1 ||
      !finalAttestationStep ||
      !sameRecord(finalAttestationStep.env, PAYROLL_EXPORT_ATTESTATION_ENV) ||
      !sameSequence(executableLines(finalAttestationStep.run), PAYROLL_EXPORT_ATTESTATION_LINES)
    ) {
      violations.push("deploy_payroll_export must verify github.sha equals live origin/main immediately before deploy");
    }
  }

  if (deployPayrollApprovals) {
    if (deployPayrollApprovals.if !== PAYROLL_APPROVALS_ACTIVATION_IF) {
      const activationIf = deployPayrollApprovals.if ?? "";
      if (
        !activationIf.includes("github.event_name == 'workflow_dispatch'") ||
        !activationIf.includes("inputs.activate_payroll_approvals == true")
      ) {
        violations.push("deploy_payroll_approvals must require explicit manual activation");
      } else if (!activationIf.includes(`inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}'`)) {
        violations.push("deploy_payroll_approvals must require the exact protected payroll approval acknowledgement");
      } else {
        violations.push("deploy_payroll_approvals must require immutable current-main manual activation");
      }
    }
    if (!sameSet(deployPayrollApprovals.needs, PAYROLL_DEPLOY_NEEDS)) {
      violations.push(`deploy_payroll_approvals needs must exactly equal ${PAYROLL_DEPLOY_NEEDS.join(", ")}`);
    }
    const prereqIndex = deployPayrollApprovals.steps.findIndex(
      (step) => step.name === "Validate payroll-approvals deploy prerequisites",
    );
    const deployIndex = deployPayrollApprovals.steps.findIndex(
      (step) => stepIsExactCommand(step, PAYROLL_APPROVALS_DEPLOY_COMMAND),
    );
    if (prereqIndex === -1 || deployIndex === -1 || prereqIndex > deployIndex) {
      violations.push("deploy_payroll_approvals must validate deploy prerequisites before deploying");
    }
    const prereqStep = deployPayrollApprovals.steps[prereqIndex];
    if (!prereqStep || !stepIsExactCommand(prereqStep, PAYROLL_APPROVALS_DEPLOY_PREREQ_COMMAND)) {
      violations.push(
        "deploy_payroll_approvals must run the shared edge deploy prerequisite helper",
      );
    }

    const firstAttestationIndex = deployPayrollApprovals.steps.findIndex(
      (step) => step.name === PAYROLL_APPROVALS_FIRST_ATTESTATION_STEP,
    );
    const firstAttestationStep = deployPayrollApprovals.steps[firstAttestationIndex];
    const credentialStepIndexes = deployPayrollApprovals.steps.flatMap((step, index) =>
      Object.keys(step.env ?? {}).some((name) => PAYROLL_APPROVALS_DEPLOY_CREDENTIAL_NAMES.has(name))
        ? [index]
        : [],
    );
    if (
      firstAttestationIndex === -1 ||
      !firstAttestationStep ||
      !sameRecord(firstAttestationStep.env, PAYROLL_APPROVALS_ATTESTATION_ENV) ||
      !sameSequence(executableLines(firstAttestationStep.run), PAYROLL_APPROVALS_ATTESTATION_LINES) ||
      credentialStepIndexes.length === 0 ||
      credentialStepIndexes.some((index) => index <= firstAttestationIndex)
    ) {
      violations.push("deploy_payroll_approvals must attest current main before every deploy credential binding");
    }

    const finalAttestationIndex = deployPayrollApprovals.steps.findIndex(
      (step) => step.name === PAYROLL_APPROVALS_FINAL_ATTESTATION_STEP,
    );
    const finalAttestationStep = deployPayrollApprovals.steps[finalAttestationIndex];
    if (
      finalAttestationIndex !== deployIndex - 1 ||
      !finalAttestationStep ||
      !sameRecord(finalAttestationStep.env, PAYROLL_APPROVALS_ATTESTATION_ENV) ||
      !sameSequence(executableLines(finalAttestationStep.run), PAYROLL_APPROVALS_ATTESTATION_LINES)
    ) {
      violations.push("deploy_payroll_approvals must verify github.sha equals live origin/main immediately before deploy");
    }
  }

  if (deployPayrollAdministration) {
    if (deployPayrollAdministration.if !== PAYROLL_ADMINISTRATION_ACTIVATION_IF) {
      const activationIf = deployPayrollAdministration.if ?? "";
      if (
        !activationIf.includes("github.event_name == 'workflow_dispatch'") ||
        !activationIf.includes("inputs.activate_payroll_administration == true")
      ) {
        violations.push("deploy_payroll_administration must require explicit manual activation");
      } else if (!activationIf.includes(`inputs.approval_acknowledgement == '${PAYROLL_APPROVAL_ACKNOWLEDGEMENT}'`)) {
        violations.push("deploy_payroll_administration must require the exact protected payroll approval acknowledgement");
      } else {
        violations.push("deploy_payroll_administration must require immutable current-main manual activation");
      }
    }
    if (!sameSet(deployPayrollAdministration.needs, PAYROLL_DEPLOY_NEEDS)) {
      violations.push(`deploy_payroll_administration needs must exactly equal ${PAYROLL_DEPLOY_NEEDS.join(", ")}`);
    }
    const prereqIndex = deployPayrollAdministration.steps.findIndex(
      (step) => step.name === "Validate payroll-administration deploy prerequisites",
    );
    const deployIndex = deployPayrollAdministration.steps.findIndex(
      (step) => stepIsExactCommand(step, PAYROLL_ADMINISTRATION_DEPLOY_COMMAND),
    );
    if (prereqIndex === -1 || deployIndex === -1 || prereqIndex > deployIndex) {
      violations.push("deploy_payroll_administration must validate deploy prerequisites before deploying");
    }
    const prereqStep = deployPayrollAdministration.steps[prereqIndex];
    if (!prereqStep || !stepIsExactCommand(prereqStep, PAYROLL_ADMINISTRATION_DEPLOY_PREREQ_COMMAND)) {
      violations.push("deploy_payroll_administration must run the shared edge deploy prerequisite helper");
    }

    const firstAttestationIndex = deployPayrollAdministration.steps.findIndex(
      (step) => step.name === PAYROLL_ADMINISTRATION_FIRST_ATTESTATION_STEP,
    );
    const firstAttestationStep = deployPayrollAdministration.steps[firstAttestationIndex];
    const credentialStepIndexes = deployPayrollAdministration.steps.flatMap((step, index) =>
      Object.keys(step.env ?? {}).some((name) => PAYROLL_ADMINISTRATION_DEPLOY_CREDENTIAL_NAMES.has(name))
        ? [index]
        : [],
    );
    if (
      firstAttestationIndex === -1 ||
      !firstAttestationStep ||
      !sameRecord(firstAttestationStep.env, PAYROLL_ADMINISTRATION_ATTESTATION_ENV) ||
      !sameSequence(executableLines(firstAttestationStep.run), PAYROLL_ADMINISTRATION_ATTESTATION_LINES) ||
      credentialStepIndexes.length === 0 ||
      credentialStepIndexes.some((index) => index <= firstAttestationIndex)
    ) {
      violations.push("deploy_payroll_administration must attest current main before every deploy credential binding");
    }

    const syncIndex = deployPayrollAdministration.steps.findIndex(
      (step) => step.name === PAYROLL_ADMINISTRATION_SECRET_SYNC_STEP,
    );
    const syncStep = deployPayrollAdministration.steps[syncIndex];
    const secretMutationAttestationIndex = deployPayrollAdministration.steps.findIndex(
      (step) => step.name === PAYROLL_ADMINISTRATION_SECRET_MUTATION_ATTESTATION_STEP,
    );
    const secretMutationAttestationStep =
      deployPayrollAdministration.steps[secretMutationAttestationIndex];
    const secretVerifyIndex = deployPayrollAdministration.steps.findIndex(
      (step) => stepIsExactCommand(step, PAYROLL_ADMINISTRATION_SECRET_VERIFY_COMMAND),
    );
    const secretVerifyStep = deployPayrollAdministration.steps[secretVerifyIndex];
    if (
      syncIndex <= firstAttestationIndex ||
      prereqIndex <= firstAttestationIndex ||
      syncIndex <= prereqIndex ||
      !syncStep ||
      !sameRecord(syncStep.env, PAYROLL_ADMINISTRATION_SECRET_SYNC_ENV) ||
      !sameSequence(executableLines(syncStep.run), PAYROLL_ADMINISTRATION_SECRET_SYNC_LINES) ||
      !secretVerifyStep ||
      secretVerifyIndex <= prereqIndex ||
      secretVerifyIndex >= deployIndex ||
      !sameRecord(prereqStep.env, {
        SUPABASE_URL: "${{ secrets.SUPABASE_URL }}",
        SUPABASE_PROJECT_REF: "${{ secrets.SUPABASE_PROJECT_REF }}",
        SUPABASE_ACCESS_TOKEN: "${{ secrets.SUPABASE_ACCESS_TOKEN }}",
      }) ||
      !sameRecord(secretVerifyStep.env, {
        SUPABASE_PROJECT_REF: "${{ secrets.SUPABASE_PROJECT_REF }}",
        SUPABASE_ACCESS_TOKEN: "${{ secrets.SUPABASE_ACCESS_TOKEN }}",
      })
    ) {
      violations.push("deploy_payroll_administration must validate target consistency before remote secret sync, then sync and verify the two required remote Edge secrets before deploy");
    }
    if (
      secretMutationAttestationIndex !== syncIndex - 1 ||
      !secretMutationAttestationStep ||
      !sameRecord(secretMutationAttestationStep.env, PAYROLL_ADMINISTRATION_ATTESTATION_ENV) ||
      !sameSequence(
        executableLines(secretMutationAttestationStep.run),
        PAYROLL_ADMINISTRATION_ATTESTATION_LINES,
      )
    ) {
      violations.push("deploy_payroll_administration must re-attest immutable current main immediately before remote secret mutation");
    }

    const upstashSecretReferenceLines = ciWorkflow
      .split(/\r?\n/)
      .map((line) => stripComment(line).trim())
      .filter((line) =>
        /\bsecrets\b[^\r\n]*(?:UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN)/.test(line),
      );
    if (!sameSet(upstashSecretReferenceLines, APPROVED_UPSTASH_SECRET_REFERENCE_LINES)) {
      violations.push("Upstash GitHub secrets may be referenced only by the exact approved payroll-administration sync bindings");
    }
    if (workflowUsesWholeSecretsContext(ciWorkflow)) {
      violations.push("CI workflow must not reference the whole GitHub secrets context");
    }

    const finalAttestationIndex = deployPayrollAdministration.steps.findIndex(
      (step) => step.name === PAYROLL_ADMINISTRATION_FINAL_ATTESTATION_STEP,
    );
    const finalAttestationStep = deployPayrollAdministration.steps[finalAttestationIndex];
    if (
      finalAttestationIndex !== deployIndex - 1 ||
      !finalAttestationStep ||
      !sameRecord(finalAttestationStep.env, PAYROLL_ADMINISTRATION_ATTESTATION_ENV) ||
      !sameSequence(executableLines(finalAttestationStep.run), PAYROLL_ADMINISTRATION_ATTESTATION_LINES)
    ) {
      violations.push("deploy_payroll_administration must verify github.sha equals live origin/main immediately before deploy");
    }
  }

  if (authSmoke) {
    if (!sameSet(authSmoke.needs, AUTH_SMOKE_NEEDS)) {
      if (!authSmoke.needs.includes("deploy_session_edge")) {
        violations.push("auth_browser_smoke must need deploy_session_edge");
      } else {
        violations.push(`auth_browser_smoke needs must exactly equal ${AUTH_SMOKE_NEEDS.join(", ")}`);
      }
    }
    if (authSmoke.if !== AUTH_SMOKE_IF) {
      violations.push("auth_browser_smoke must use the exact read-only/non-main and successful-main-deploy condition");
    }
    const requiredPlaywrightStep = authSmoke.steps.find(
      (step) => step.name === "Session browser smoke gate",
    );
    if (
      !requiredPlaywrightStep ||
      !stepHasExactCommand(requiredPlaywrightStep, "npm run ci:playwright") ||
      sameRecord(requiredPlaywrightStep.env ?? {}, {
        PW_BASE_URL: "${{ github.event_name == 'pull_request' && format('https://deploy-preview-{0}--velvety-cendol-dae4d6.netlify.app', github.event.pull_request.number) || secrets.PW_BASE_URL }}",
        PW_ADMIN_EMAIL: "${{ secrets.PW_ADMIN_EMAIL }}",
        PW_ADMIN_PASSWORD: "${{ secrets.PW_ADMIN_PASSWORD }}",
        PW_THERAPIST_EMAIL: "${{ secrets.PW_THERAPIST_EMAIL }}",
        PW_THERAPIST_PASSWORD: "${{ secrets.PW_THERAPIST_PASSWORD }}",
        PW_SCHEDULE_EMAIL: "${{ secrets.PW_SCHEDULE_EMAIL }}",
        PW_SCHEDULE_PASSWORD: "${{ secrets.PW_SCHEDULE_PASSWORD }}",
        PW_FOREIGN_CLIENT_ID: "${{ secrets.PW_FOREIGN_CLIENT_ID }}",
        PW_FOREIGN_THERAPIST_ID: "${{ secrets.PW_FOREIGN_THERAPIST_ID }}",
        VITE_SUPABASE_URL: "${{ secrets.SUPABASE_URL }}",
        SUPABASE_PUBLISHABLE_KEY: "${{ secrets.SUPABASE_PUBLISHABLE_KEY }}",
        VITE_SUPABASE_PUBLISHABLE_KEY: "${{ secrets.SUPABASE_PUBLISHABLE_KEY }}",
        VITE_SUPABASE_ANON_KEY: "${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}",
        SUPABASE_SECRET_KEY: "${{ secrets.SUPABASE_SECRET_KEY }}",
        SUPABASE_SERVICE_ROLE_KEY: "${{ secrets.SUPABASE_SECRET_KEY || secrets.SUPABASE_SERVICE_ROLE_KEY }}",
      }) === false
    ) {
      violations.push("auth_browser_smoke must run npm run ci:playwright with the complete required auth/session secret contract");
    }
    if (authSmoke.steps.some((step) => stepHasExactCommand(step, DEPLOY_COMMAND))) {
      violations.push("auth_browser_smoke must not deploy session edge functions");
    }
  }

  if (ciGate) {
    const requiredNeeds = ["tenant_safety", "runtime_migration_parity", "start_session_runtime_contract", "deploy_session_edge", "deploy_ai_agent_edge", "deploy_payroll_timesheets", "deploy_payroll_export", "deploy_payroll_approvals", "deploy_payroll_administration"];
    if (!requiredNeeds.every((need) => ciGate.needs.includes(need))) {
      violations.push("ci_gate must include tenant_safety, runtime_migration_parity, start_session_runtime_contract, deploy_session_edge, deploy_ai_agent_edge, deploy_payroll_timesheets, deploy_payroll_export, deploy_payroll_approvals, and deploy_payroll_administration");
    }

    const gateStep = ciGate.steps.find((step) => step.name === "Enforce lane-specific CI results") ?? ciGate.steps[0];
    const expectedEnv = {
      GITHUB_EVENT_NAME: "${{ github.event_name }}",
      GITHUB_REF: "${{ github.ref }}",
      ACTIVATE_PAYROLL_TIMESHEETS: "${{ inputs.activate_payroll_timesheets || false }}",
      ACTIVATE_PAYROLL_EXPORT: "${{ inputs.activate_payroll_export || false }}",
      ACTIVATE_PAYROLL_APPROVALS: "${{ inputs.activate_payroll_approvals || false }}",
      ACTIVATE_PAYROLL_ADMINISTRATION: "${{ inputs.activate_payroll_administration || false }}",
      AI_AGENT_CHANGED: "${{ needs.change_scope.outputs.ai_agent_changed }}",
      TENANT_SAFETY_RESULT: "${{ needs.tenant_safety.result }}",
      RUNTIME_PARITY_RESULT: "${{ needs.runtime_migration_parity.result }}",
      START_SESSION_RUNTIME_CONTRACT_RESULT: "${{ needs.start_session_runtime_contract.result }}",
      DEPLOY_SESSION_EDGE_RESULT: "${{ needs.deploy_session_edge.result }}",
      DEPLOY_AI_AGENT_EDGE_RESULT: "${{ needs.deploy_ai_agent_edge.result }}",
      DEPLOY_PAYROLL_TIMESHEETS_RESULT: "${{ needs.deploy_payroll_timesheets.result }}",
      DEPLOY_PAYROLL_EXPORT_RESULT: "${{ needs.deploy_payroll_export.result }}",
      DEPLOY_PAYROLL_APPROVALS_RESULT: "${{ needs.deploy_payroll_approvals.result }}",
      DEPLOY_PAYROLL_ADMINISTRATION_RESULT: "${{ needs.deploy_payroll_administration.result }}",
    };
    for (const [name, value] of Object.entries(expectedEnv)) {
      if (gateStep?.env?.[name] !== value) {
        violations.push(`ci_gate must map ${name} to ${value}`);
      }
    }

    const gateLines = executableLines(gateStep?.run);
    const resultChecks = [
      ['[ "${TENANT_SAFETY_RESULT}" = "success" ] || failed+=("tenant-safety=${TENANT_SAFETY_RESULT}")', "ci_gate must enforce tenant_safety result failure"],
      ['[ "${START_SESSION_RUNTIME_CONTRACT_RESULT}" = "success" ] || failed+=("start-session-runtime-contract=${START_SESSION_RUNTIME_CONTRACT_RESULT}")', "ci_gate must enforce start_session_runtime_contract result failure"],
    ];
    for (const [line, message] of resultChecks) {
      if (!gateLines.includes(line)) {
        violations.push(message);
      }
    }
    if (!hasSequence(gateLines, [
      'if { [ "${GITHUB_EVENT_NAME}" = "push" ] && [ "${GITHUB_REF}" = "refs/heads/main" ]; } || { [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ] && { [ "${ACTIVATE_PAYROLL_TIMESHEETS}" = "true" ] || [ "${ACTIVATE_PAYROLL_ADMINISTRATION}" = "true" ] || [ "${ACTIVATE_PAYROLL_APPROVALS}" = "true" ] || [ "${ACTIVATE_PAYROLL_EXPORT}" = "true" ]; }; }; then',
      '[ "${RUNTIME_PARITY_RESULT}" = "success" ] || failed+=("runtime-migration-parity=${RUNTIME_PARITY_RESULT}")',
      "fi",
    ])) {
      violations.push(
        "ci_gate must enforce runtime_migration_parity success on main pushes and explicit payroll activation",
      );
    }
    if (!hasSequence(gateLines, [
      'if [ "${GITHUB_EVENT_NAME}" = "push" ] && [ "${GITHUB_REF}" = "refs/heads/main" ] && [ "${DEPLOY_SESSION_EDGE_RESULT}" != "success" ]; then',
      'failed+=("deploy-session-edge=${DEPLOY_SESSION_EDGE_RESULT}")',
      "fi",
    ])) {
      violations.push("ci_gate must enforce deploy_session_edge success for main pushes");
    }
    if (!hasSequence(gateLines, [
      'if [ "${GITHUB_EVENT_NAME}" = "push" ] && [ "${GITHUB_REF}" = "refs/heads/main" ] && [ "${AI_AGENT_CHANGED}" = "true" ] && [ "${DEPLOY_AI_AGENT_EDGE_RESULT}" != "success" ]; then',
      'failed+=("deploy-ai-agent-edge=${DEPLOY_AI_AGENT_EDGE_RESULT}")',
      "fi",
    ])) {
      violations.push("ci_gate must enforce deploy_ai_agent_edge success when ai_agent_changed is true on main pushes");
    }
    if (!hasSequence(gateLines, [
      'if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ] && [ "${ACTIVATE_PAYROLL_TIMESHEETS}" = "true" ] && [ "${DEPLOY_PAYROLL_TIMESHEETS_RESULT}" != "success" ]; then',
      'failed+=("deploy-payroll-timesheets=${DEPLOY_PAYROLL_TIMESHEETS_RESULT}")',
      "fi",
    ])) {
      violations.push("ci_gate must enforce deploy_payroll_timesheets success for explicit manual activation");
    }
    if (!hasSequence(gateLines, [
      'if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ] && [ "${ACTIVATE_PAYROLL_EXPORT}" = "true" ] && [ "${DEPLOY_PAYROLL_EXPORT_RESULT}" != "success" ]; then',
      'failed+=("deploy-payroll-export=${DEPLOY_PAYROLL_EXPORT_RESULT}")',
      "fi",
    ])) {
      violations.push("ci_gate must enforce deploy_payroll_export success for explicit manual activation");
    }
    if (!hasSequence(gateLines, [
      'if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ] && [ "${ACTIVATE_PAYROLL_APPROVALS}" = "true" ] && [ "${DEPLOY_PAYROLL_APPROVALS_RESULT}" != "success" ]; then',
      'failed+=("deploy-payroll-approvals=${DEPLOY_PAYROLL_APPROVALS_RESULT}")',
      "fi",
    ])) {
      violations.push("ci_gate must enforce deploy_payroll_approvals success for explicit manual activation");
    }
    if (!hasSequence(gateLines, [
      'if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ] && [ "${ACTIVATE_PAYROLL_ADMINISTRATION}" = "true" ] && [ "${DEPLOY_PAYROLL_ADMINISTRATION_RESULT}" != "success" ]; then',
      'failed+=("deploy-payroll-administration=${DEPLOY_PAYROLL_ADMINISTRATION_RESULT}")',
      "fi",
    ])) {
      violations.push("ci_gate must enforce deploy_payroll_administration success for explicit manual activation");
    }
    if (!hasOrderedSequence(gateLines, ['if [ "${#failed[@]}" -gt 0 ]; then', "exit 1", "fi"])) {
      violations.push("ci_gate must exit nonzero when any required result fails");
    }
  }

  const tenantJob = tenantJobs["tenant-safety"];
  const tenantTestSteps = tenantJob?.steps.filter((step) => stepHasExactCommand(step, "npm test")) ?? [];
  if (
    tenantTestSteps.length !== 1 ||
    executableLines(tenantTestSteps[0]?.run).length !== 1 ||
    String(tenantTestSteps[0]?.["continue-on-error"] ?? "false").toLowerCase() === "true"
  ) {
    violations.push("tenant-safety workflow must run `npm test` without masking failures");
  }
  const tenantTestEnvironment = tenantTestSteps[0]?.env ?? {};
  const requiredTenantTestEnvironment = [
    "VITE_SUPABASE_URL",
    "SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  if (
    requiredTenantTestEnvironment.some(
      (key) => !String(tenantTestEnvironment[key] ?? "").trim(),
    )
  ) {
    violations.push("tenant-safety workflow must map the required Supabase test environment");
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
    for (const violation of [...new Set(result.violations)]) {
      console.error(`❌ ${violation}`);
    }
    process.exit(1);
  }

  console.log("Session deploy safety check passed.");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
