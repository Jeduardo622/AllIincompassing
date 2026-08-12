import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEPLOY_COMMAND = "npm run ci:deploy:session-edge-bundle";
const FILL_DOCS_DEPLOY_COMMAND = "npm run ci:deploy:fill-docs-function";
const AI_DEPLOY_COMMAND = "npm run ci:deploy:ai-agent-function";
const PAYROLL_DEPLOY_COMMAND = "node scripts/ci/deploy-payroll-timesheets-function.mjs";
const SESSION_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs session-edge";
const AI_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs ai-agent-optimized";
const PAYROLL_DEPLOY_PREREQ_COMMAND =
  "node scripts/ci/check-edge-deploy-prerequisites.mjs payroll-timesheets";
const MAIN_PUSH_IF = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const PAYROLL_ACTIVATION_IF = "github.event_name == 'workflow_dispatch' && inputs.activate_payroll_timesheets == true";
const RUNTIME_PARITY_IF = `(${MAIN_PUSH_IF}) || (${PAYROLL_ACTIVATION_IF})`;
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
];
const AUTH_SMOKE_NEEDS = ["policy", "change_scope", "deploy_session_edge"];
const PAYROLL_FUNCTION_PARITY_SCOPE_ENTRY = "payroll-timesheets";
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
const isRawFillDocsDeployInvocation = (line) =>
  isDirectNodeDeployScript(line, "scripts/ci/deploy-fill-docs-function.mjs") ||
  normalizeScriptCommand(line) === FILL_DOCS_DEPLOY_COMMAND;
const sameSet = (actual, expected) => {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.length === sortedExpected.length && sortedActual.every((value, index) => value === sortedExpected[index]);
};
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

export const evaluateSessionDeploySafety = ({ ciWorkflow, tenantWorkflow }) => {
  const violations = [];
  if (!/workflow_dispatch:\s*\n\s+inputs:\s*\n\s+activate_payroll_timesheets:\s*\n\s+description:[^\n]+\n\s+required:\s*true\s*\n\s+type:\s*boolean\s*\n\s+default:\s*false/.test(ciWorkflow)) {
    violations.push("workflow_dispatch must define a required default-false boolean activate_payroll_timesheets input");
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

  if (policy) {
    const policyRuns = runText(policy);
    for (const forbidden of [DEPLOY_COMMAND, FILL_DOCS_DEPLOY_COMMAND, AI_DEPLOY_COMMAND, PAYROLL_DEPLOY_COMMAND, "npm run validate:tenant", "check-runtime-migration-parity.mjs", "check-session-runtime-contract.mjs"]) {
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
    if (!scopeEntries.includes(PAYROLL_FUNCTION_PARITY_SCOPE_ENTRY)) {
      violations.push("SUPABASE_FUNCTION_PARITY_SCOPE must include payroll-timesheets");
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
      parityStep.env.SUPABASE_DB_URL !== "${{ secrets.SUPABASE_DB_URL }}"
    ) {
      violations.push("runtime_migration_parity must run the merge-range checker with change_scope SHAs and SUPABASE_DB_URL");
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
      violations.push("deploy_payroll_timesheets must require explicit manual activation");
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
    if (authSmoke.steps.some((step) => stepHasExactCommand(step, DEPLOY_COMMAND))) {
      violations.push("auth_browser_smoke must not deploy session edge functions");
    }
  }

  if (ciGate) {
    const requiredNeeds = ["tenant_safety", "runtime_migration_parity", "start_session_runtime_contract", "deploy_session_edge", "deploy_ai_agent_edge", "deploy_payroll_timesheets"];
    if (!requiredNeeds.every((need) => ciGate.needs.includes(need))) {
      violations.push("ci_gate must include tenant_safety, runtime_migration_parity, start_session_runtime_contract, deploy_session_edge, deploy_ai_agent_edge, and deploy_payroll_timesheets");
    }

    const gateStep = ciGate.steps.find((step) => step.name === "Enforce lane-specific CI results") ?? ciGate.steps[0];
    const expectedEnv = {
      GITHUB_EVENT_NAME: "${{ github.event_name }}",
      GITHUB_REF: "${{ github.ref }}",
      ACTIVATE_PAYROLL_TIMESHEETS: "${{ inputs.activate_payroll_timesheets || false }}",
      AI_AGENT_CHANGED: "${{ needs.change_scope.outputs.ai_agent_changed }}",
      TENANT_SAFETY_RESULT: "${{ needs.tenant_safety.result }}",
      RUNTIME_PARITY_RESULT: "${{ needs.runtime_migration_parity.result }}",
      START_SESSION_RUNTIME_CONTRACT_RESULT: "${{ needs.start_session_runtime_contract.result }}",
      DEPLOY_SESSION_EDGE_RESULT: "${{ needs.deploy_session_edge.result }}",
      DEPLOY_AI_AGENT_EDGE_RESULT: "${{ needs.deploy_ai_agent_edge.result }}",
      DEPLOY_PAYROLL_TIMESHEETS_RESULT: "${{ needs.deploy_payroll_timesheets.result }}",
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
      'if { [ "${GITHUB_EVENT_NAME}" = "push" ] && [ "${GITHUB_REF}" = "refs/heads/main" ]; } || { [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ] && [ "${ACTIVATE_PAYROLL_TIMESHEETS}" = "true" ]; }; then',
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
