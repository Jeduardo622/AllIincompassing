import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPECTED_IEHP_PDF_MINI_MATRIX_CASE_IDS = Object.freeze([
  'clean-single-page',
  'multi-page-target-content',
  'alternate-document-phone-format',
  'scan-300dpi-monochrome',
  'scan-300dpi-monochrome-rotated-2deg',
  'scan-150dpi-grayscale-low-quality',
  'table-structured-fields',
  'skills-behaviors-proof',
]);

const REDACTED_PHONE_PATTERN = /^\(\*\*\*\) \*\*\*-\d{4}$/;
const RAW_PHONE_PATTERN = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const SUCCESS_MODE = 'pdf-mini-matrix-case';
const FAILURE_MODE = 'pdf-mini-matrix-case-failure';
const AGGREGATE_MODE = 'pdf-mini-matrix';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const extractJsonObjectsFromLog = (source) => {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char !== '}' || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;

    try {
      const candidate = JSON.parse(source.slice(start, index + 1));
      if (isRecord(candidate)) objects.push(candidate);
    } catch {
      // Console output can contain unrelated brace blocks.
    }
    start = -1;
  }

  return objects;
};

const sanitizeNestedEvidence = (value) => {
  if (Array.isArray(value)) return value.map((entry) => sanitizeNestedEvidence(entry));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nestedValue]) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes('screenshot')) return [];
      if (normalizedKey.includes('error')) return [];
      if (
        normalizedKey.includes('phone')
        && key !== 'expectedPhoneRedacted'
        && key !== 'actualPhoneRedacted'
      ) {
        return [];
      }
      return [[key, sanitizeNestedEvidence(nestedValue)]];
    }),
  );
};

const sanitizeAssessorPhoneAssertion = (value) => {
  if (!isRecord(value)) return null;
  return {
    fieldKey: value.fieldKey,
    rowCount: value.rowCount,
    nonEmpty: value.nonEmpty,
    validFormat: value.validFormat,
    precedenceMatchedExpectedPhone: value.precedenceMatchedExpectedPhone,
    provenanceRowCount: value.provenanceRowCount,
    provenanceVerified: value.provenanceVerified,
    sourceMethod: value.sourceMethod,
    sourceField: value.sourceField,
    expectedPhoneRedacted: value.expectedPhoneRedacted,
    actualPhoneRedacted: value.actualPhoneRedacted,
  };
};

const sanitizeSuccessfulCase = (entry) => ({
  ok: true,
  mode: SUCCESS_MODE,
  caseId: entry.caseId,
  templateType: 'iehp_fba',
  status: entry.status,
  draftPrograms: entry.draftPrograms,
  draftGoals: entry.draftGoals,
  assessorPhoneAssertion: sanitizeAssessorPhoneAssertion(entry.assessorPhoneAssertion),
  referralDateAssertion: sanitizeNestedEvidence(entry.referralDateAssertion),
  skillsBehaviorsProofResult: sanitizeNestedEvidence(entry.skillsBehaviorsProofResult),
  cleanupVerified: entry.cleanupVerified === true,
});

const sanitizeFailedCase = (entry) => ({
  ok: false,
  mode: FAILURE_MODE,
  caseId: entry.caseId,
  templateType: 'iehp_fba',
  cleanupVerified: false,
  failureCategory: 'case_execution_failed',
  errorCategory: 'matrix_failures_detected',
});

const assertRedactedPhoneEvidence = (successfulCases) => {
  for (const matrixCase of successfulCases) {
    const assertion = matrixCase.assessorPhoneAssertion;
    if (
      !assertion
      || !REDACTED_PHONE_PATTERN.test(assertion.expectedPhoneRedacted ?? '')
      || !REDACTED_PHONE_PATTERN.test(assertion.actualPhoneRedacted ?? '')
    ) {
      throw new Error('redacted_phone_evidence_invalid');
    }
  }
};

const assertNoRawPhones = (value) => {
  if (RAW_PHONE_PATTERN.test(JSON.stringify(value))) {
    throw new Error('raw_phone_detected');
  }
};

const hasExactSuccessfulAggregate = (aggregate) =>
  aggregate?.ok === true
  && aggregate?.mode === AGGREGATE_MODE
  && aggregate?.totalCases === 8
  && aggregate?.passedCases === 8
  && aggregate?.cleanupVerifiedCases === 8
  && aggregate?.skillsBehaviorsVerifiedCases === 1;

const buildMetadataFields = (workflowStatus, metadata, successfulCount, failedCount) => ({
  ok: workflowStatus === 'success',
  status: workflowStatus ?? 'unknown',
  workflowRunId: metadata.workflowRunId ?? null,
  workflowRunAttempt: metadata.workflowRunAttempt ?? null,
  validatedSha: metadata.validatedSha ?? null,
  validatedPrNumber: metadata.validatedPrNumber ?? null,
  previewUrl: metadata.previewUrl ?? null,
  caseCount: successfulCount,
  failedCaseCount: failedCount,
});

export const buildFinalizedIehpPdfMiniMatrixEvidence = ({
  logSource,
  workflowStatus,
  metadata = {},
}) => {
  const workflowSucceeded = workflowStatus === 'success';
  const objects = extractJsonObjectsFromLog(logSource);
  const successfulSourceCases = objects.filter((entry) => entry.mode === SUCCESS_MODE);
  const failedSourceCases = objects.filter((entry) => entry.mode === FAILURE_MODE);
  const loggedAggregate = objects.filter((entry) => entry.mode === AGGREGATE_MODE).at(-1);
  const successfulCases = successfulSourceCases.map(sanitizeSuccessfulCase);
  const failedCases = failedSourceCases.map(sanitizeFailedCase);

  assertRedactedPhoneEvidence(successfulCases);

  const cases = EXPECTED_IEHP_PDF_MINI_MATRIX_CASE_IDS.flatMap((caseId) => {
    const failedCase = failedCases.find((entry) => entry.caseId === caseId);
    if (failedCase) return [failedCase];
    const successfulCase = successfulCases.find((entry) => entry.caseId === caseId);
    return successfulCase ? [successfulCase] : [];
  });
  const cleanupVerifiedSuccessfulCases = cases.filter(
    (entry) => entry.mode === SUCCESS_MODE && entry.cleanupVerified === true,
  );
  const skillsBehaviorsVerifiedCases = cleanupVerifiedSuccessfulCases.filter(
    (entry) => entry.skillsBehaviorsProofResult != null,
  ).length;
  const failedCaseCount = cases.filter((entry) => entry.mode === FAILURE_MODE).length;
  const aggregate = {
    ok: workflowSucceeded
      && cleanupVerifiedSuccessfulCases.length === 8
      && failedCaseCount === 0
      && skillsBehaviorsVerifiedCases === 1,
    mode: AGGREGATE_MODE,
    totalCases: EXPECTED_IEHP_PDF_MINI_MATRIX_CASE_IDS.length,
    passedCases: cleanupVerifiedSuccessfulCases.length,
    cleanupVerifiedCases: cleanupVerifiedSuccessfulCases.length,
    skillsBehaviorsVerifiedCases,
  };
  const runMetadata = buildMetadataFields(
    workflowStatus,
    metadata,
    cleanupVerifiedSuccessfulCases.length,
    failedCaseCount,
  );
  const runStatus = {
    ok: workflowSucceeded,
    status: workflowStatus ?? 'unknown',
    workflowRunId: metadata.workflowRunId ?? null,
    workflowRunAttempt: metadata.workflowRunAttempt ?? null,
    validatedSha: metadata.validatedSha ?? null,
    validatedPrNumber: metadata.validatedPrNumber ?? null,
    previewUrl: metadata.previewUrl ?? null,
  };

  if (!workflowSucceeded) {
    runMetadata.ok = false;
    if (failedCaseCount > 0) {
      runStatus.evidenceError = `matrix_case_failures_detected:${failedCaseCount}`;
    }
    if (cleanupVerifiedSuccessfulCases.length !== 8) {
      runStatus.evidenceShortfall = `successful_cleanup_verified_cases:${cleanupVerifiedSuccessfulCases.length}/8`;
    }
  }

  assertNoRawPhones({ cases, aggregate, metadata: runMetadata, runStatus });

  if (workflowSucceeded) {
    const sourceCaseIds = successfulSourceCases.map((entry) => entry.caseId);
    const exactSourceOrder = JSON.stringify(sourceCaseIds)
      === JSON.stringify(EXPECTED_IEHP_PDF_MINI_MATRIX_CASE_IDS);
    if (
      successfulSourceCases.length !== 8
      || failedSourceCases.length !== 0
      || !exactSourceOrder
      || !hasExactSuccessfulAggregate(loggedAggregate)
      || !hasExactSuccessfulAggregate(aggregate)
    ) {
      throw new Error('successful_contract_failed');
    }
  }

  return {
    cases,
    aggregate,
    metadata: runMetadata,
    runStatus,
    hasEvidence: cases.length > 0 || Boolean(loggedAggregate),
  };
};

const writeJson = (outputDirectory, fileName, value) => {
  writeFileSync(
    path.join(outputDirectory, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
};

export const finalizeIehpPdfMiniMatrixEvidenceRun = ({
  logSource,
  outputDirectory,
  workflowStatus,
  metadata = {},
}) => {
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  try {
    const finalized = buildFinalizedIehpPdfMiniMatrixEvidence({
      logSource,
      workflowStatus,
      metadata,
    });
    if (finalized.hasEvidence) {
      writeJson(outputDirectory, 'cases.json', finalized.cases);
      writeJson(outputDirectory, 'aggregate.json', finalized.aggregate);
      writeJson(outputDirectory, 'run-metadata.json', finalized.metadata);
    }
    writeJson(outputDirectory, 'run-status.json', finalized.runStatus);
    return finalized;
  } catch (error) {
    const evidenceError = error instanceof Error && [
      'raw_phone_detected',
      'redacted_phone_evidence_invalid',
      'successful_contract_failed',
    ].includes(error.message)
      ? error.message
      : 'evidence_finalization_failed';
    const runStatus = {
      ok: false,
      status: workflowStatus ?? 'unknown',
      workflowRunId: metadata.workflowRunId ?? null,
      workflowRunAttempt: metadata.workflowRunAttempt ?? null,
      validatedSha: metadata.validatedSha ?? null,
      validatedPrNumber: metadata.validatedPrNumber ?? null,
      previewUrl: metadata.previewUrl ?? null,
      evidenceError,
    };
    writeJson(outputDirectory, 'run-status.json', runStatus);
    if (workflowStatus === 'success') throw error;
    return { runStatus, hasEvidence: false };
  }
};

export const runIehpPdfMiniMatrixEvidenceFinalizer = (env = process.env) => {
  const outputDirectory = path.join(env.RUNNER_TEMP, 'iehp-pdf-mini-matrix-public');
  const logPath = env.PRIVATE_MATRIX_LOG_PATH;
  const logSource = logPath && existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';

  return finalizeIehpPdfMiniMatrixEvidenceRun({
    logSource,
    outputDirectory,
    workflowStatus: env.WORKFLOW_STATUS ?? 'unknown',
    metadata: {
      workflowRunId: env.GITHUB_RUN_ID,
      workflowRunAttempt: env.GITHUB_RUN_ATTEMPT,
      validatedSha: env.VALIDATED_SHA,
      validatedPrNumber: env.VALIDATED_PR_NUMBER,
      previewUrl: env.PREVIEW_URL,
    },
  });
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    runIehpPdfMiniMatrixEvidenceFinalizer();
  } catch {
    console.error('IEHP PDF mini-matrix evidence finalization failed.');
    process.exitCode = 1;
  }
}
