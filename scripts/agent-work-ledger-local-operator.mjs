import { pathToFileURL } from "node:url";

import {
  PHASE2_CHECKS,
  runPhase2Harness,
} from "./agent-work-ledger-harness/phase2Harness.mjs";

export const REQUIRED_OPERATOR_CHECK_IDS = Object.freeze(
  PHASE2_CHECKS.map(({ id }) => id),
);

const MACHINE_SAFE_CODE = /^[a-z0-9_]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const PASSED = "passed";
const REQUIRED_CLEANUP_FIELDS = Object.freeze([
  "status",
  "databaseAudit",
  "composeDown",
  "supabaseStop",
  "composeResidue",
  "networkResidue",
  "archiveContext",
]);

const fail = (reasonCode) => {
  throw new Error(reasonCode);
};

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeMachineCode = (value, fallback = "operator_failed") => {
  const candidate = String(value ?? "").trim();
  return MACHINE_SAFE_CODE.test(candidate) ? candidate : fallback;
};

const assertSha256 = (value, reasonCode) => {
  if (!SHA256_HEX.test(String(value ?? ""))) fail(reasonCode);
};

const assertString = (value, reasonCode) => {
  if (typeof value !== "string" || value.length === 0) fail(reasonCode);
};

const assertExactCheckSet = (checks) => {
  if (!Array.isArray(checks) || checks.length !== REQUIRED_OPERATOR_CHECK_IDS.length) {
    fail("operator_check_set_invalid");
  }

  for (const [index, requiredId] of REQUIRED_OPERATOR_CHECK_IDS.entries()) {
    if (!isRecord(checks[index]) || checks[index].id !== requiredId) {
      fail("operator_check_set_invalid");
    }
  }
};

const getManifest = (result) => {
  if (!isRecord(result) || !isRecord(result.manifest)) fail("operator_result_invalid");
  return result.manifest;
};

const getExitCode = (result) => {
  const exitCode = result?.manifest?.exitCode;
  return Number.isInteger(exitCode) ? exitCode : 1;
};

const getFailureReason = (result, error) => {
  const manifestReason = result?.manifest?.failure?.reasonCode;
  if (typeof manifestReason === "string" && manifestReason.length > 0) {
    return sanitizeMachineCode(manifestReason);
  }
  if (error instanceof Error) {
    return sanitizeMachineCode(error.message);
  }
  return "operator_failed";
};

const writeCode = (processImpl, code, { trailingNewline = false } = {}) => {
  processImpl.stdout.write(trailingNewline ? `${code}\n` : code);
};

export const validateOperatorArgs = (argv) => {
  if (!Array.isArray(argv) || argv.length !== 0) fail("operator_arguments_forbidden");
};

export const validateOperatorResult = (result) => {
  if (!isRecord(result) || !isRecord(result.artifacts)) fail("operator_result_invalid");
  assertString(result.runId, "operator_result_invalid");
  assertString(result.artifacts.reportDir, "operator_artifacts_invalid");
  assertString(result.artifacts.summaryLogPath, "operator_artifacts_invalid");
  assertString(result.artifacts.manifestPath, "operator_artifacts_invalid");

  const manifest = getManifest(result);
  if (manifest.command !== "npm run test:agent-work:phase2") {
    fail("operator_command_invalid");
  }

  assertExactCheckSet(manifest.checks);
  for (const check of manifest.checks) {
    if (check.status !== PASSED) fail("operator_check_status_invalid");
    assertSha256(check.sanitizedOutputSha256, "operator_check_hash_invalid");
  }

  if (!isRecord(manifest.cleanup)) fail("operator_cleanup_invalid");
  for (const field of REQUIRED_CLEANUP_FIELDS) {
    if (manifest.cleanup[field] !== PASSED) fail("operator_cleanup_invalid");
  }

  if (manifest.exitStatus !== PASSED || manifest.exitCode !== 0) {
    fail("operator_exit_invalid");
  }

  if (!isRecord(manifest.artifacts)) fail("operator_artifact_hash_invalid");
  assertSha256(manifest.artifacts.summaryLogSha256, "operator_artifact_hash_invalid");
  assertSha256(manifest.artifacts.checkEvidenceSha256, "operator_artifact_hash_invalid");
};

export const runLocalOperator = async ({
  argv = process.argv.slice(2),
  runHarness = runPhase2Harness,
  processImpl = process,
} = {}) => {
  try {
    validateOperatorArgs(argv);

    const result = await runHarness();
    const manifest = getManifest(result);
    if (manifest.exitStatus !== PASSED || manifest.exitCode !== 0) {
      const code = getFailureReason(result);
      const exitCode = getExitCode(result);
      processImpl.exitCode = exitCode;
      writeCode(processImpl, code);
      return exitCode;
    }

    validateOperatorResult(result);
    processImpl.exitCode = 0;
    writeCode(processImpl, "operator_passed");
    return 0;
  } catch (error) {
    const code = getFailureReason(undefined, error);
    processImpl.exitCode = 1;
    writeCode(processImpl, code, {
      trailingNewline: code === "operator_arguments_forbidden",
    });
    return 1;
  }
};

const isMainModule = () =>
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule()) {
  await runLocalOperator({
    argv: process.argv.slice(2),
  });
}
