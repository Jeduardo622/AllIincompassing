/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EXPECTED_IEHP_PDF_MINI_MATRIX_CASE_IDS,
  buildFinalizedIehpPdfMiniMatrixEvidence,
  finalizeIehpPdfMiniMatrixEvidenceRun,
} from '../../scripts/finalize-iehp-pdf-mini-matrix-evidence.mjs';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'iehp-mini-matrix-finalizer-'));
  temporaryDirectories.push(directory);
  return directory;
};

const phoneAssertion = {
  fieldKey: 'IEHP_FBA_ASSESSOR_PHONE',
  rowCount: 1,
  nonEmpty: true,
  validFormat: true,
  precedenceMatchedExpectedPhone: true,
  provenanceRowCount: 1,
  provenanceVerified: true,
  sourceMethod: 'client_snapshot',
  sourceField: 'primary_therapist_phone',
  expectedPhoneRedacted: '(***) ***-4242',
  actualPhoneRedacted: '(***) ***-4242',
};

const successfulCase = (caseId: string, skillsBehaviorsProofResult: Record<string, unknown> | null = null) => ({
  ok: true,
  mode: 'pdf-mini-matrix-case',
  caseId,
  templateType: 'iehp_fba',
  status: 'drafted',
  draftPrograms: 0,
  draftGoals: 0,
  assessorPhoneAssertion: phoneAssertion,
  referralDateAssertion: { fieldKey: 'IEHP_FBA_REFERRAL_DATE', matched: true },
  skillsBehaviorsProofResult,
  cleanupVerified: true,
});

const failureCase = (caseId: string) => ({
  ok: false,
  mode: 'pdf-mini-matrix-case-failure',
  caseId,
  templateType: 'iehp_fba',
  cleanupVerified: true,
  failureCategory: 'private failure detail',
  errorCategory: 'private stack detail',
});

const asLog = (objects: Array<Record<string, unknown>>): string =>
  objects.map((object, index) => `log line ${index}\n${JSON.stringify(object, null, 2)}`).join('\n');

const readJson = (directory: string, fileName: string): Record<string, unknown> | Array<Record<string, unknown>> =>
  JSON.parse(readFileSync(path.join(directory, fileName), 'utf8'));

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('IEHP PDF mini-matrix evidence finalizer', () => {
  it('writes canonically ordered redacted partial evidence after mixed case results without throwing', () => {
    const outputDirectory = createTemporaryDirectory();
    const logSource = asLog([
      {
        ...successfulCase('table-structured-fields'),
        screenshot: 'artifacts/private/table-failure.png',
        errorMessage: 'private table error text',
        rawPhone: '(951) 555-0101',
      },
      successfulCase('clean-single-page'),
      {
        ...failureCase('multi-page-target-content'),
        screenshotPath: 'artifacts/private/multi-page-failure.png',
        error: 'private rejection text',
        phone: '951-555-0102',
      },
      successfulCase('skills-behaviors-proof', { verified: true }),
      {
        ok: false,
        mode: 'pdf-mini-matrix',
        totalCases: 8,
        passedCases: 99,
        cleanupVerifiedCases: 99,
        skillsBehaviorsVerifiedCases: 99,
      },
    ]);

    expect(() => finalizeIehpPdfMiniMatrixEvidenceRun({
      logSource,
      outputDirectory,
      workflowStatus: 'failure',
      metadata: {
        workflowRunId: 'run-1',
        workflowRunAttempt: '2',
        validatedSha: 'a'.repeat(40),
        validatedPrNumber: '154',
        previewUrl: 'https://example.invalid',
      },
    })).not.toThrow();

    const cases = readJson(outputDirectory, 'cases.json') as Array<Record<string, unknown>>;
    const aggregate = readJson(outputDirectory, 'aggregate.json') as Record<string, unknown>;
    const metadata = readJson(outputDirectory, 'run-metadata.json') as Record<string, unknown>;
    const runStatus = readJson(outputDirectory, 'run-status.json') as Record<string, unknown>;
    const publicEvidence = JSON.stringify({ cases, aggregate, metadata, runStatus });

    expect(cases.map((entry) => entry.caseId)).toEqual([
      'clean-single-page',
      'multi-page-target-content',
      'table-structured-fields',
      'skills-behaviors-proof',
    ]);
    expect(cases.find((entry) => entry.caseId === 'table-structured-fields')).toMatchObject({
      ok: true,
      cleanupVerified: true,
    });
    expect(cases.find((entry) => entry.caseId === 'multi-page-target-content')).toEqual({
      ok: false,
      mode: 'pdf-mini-matrix-case-failure',
      caseId: 'multi-page-target-content',
      templateType: 'iehp_fba',
      cleanupVerified: false,
      failureCategory: 'case_execution_failed',
      errorCategory: 'matrix_failures_detected',
    });
    expect(aggregate).toEqual({
      ok: false,
      mode: 'pdf-mini-matrix',
      totalCases: 8,
      passedCases: 3,
      cleanupVerifiedCases: 3,
      skillsBehaviorsVerifiedCases: 1,
    });
    expect(metadata).toMatchObject({ ok: false, caseCount: 3, failedCaseCount: 1 });
    expect(runStatus).toMatchObject({
      ok: false,
      status: 'failure',
      evidenceError: 'matrix_case_failures_detected:1',
      evidenceShortfall: 'successful_cleanup_verified_cases:3/8',
    });
    expect(publicEvidence).not.toContain('private table error text');
    expect(publicEvidence).not.toContain('private rejection text');
    expect(publicEvidence).not.toContain('failure.png');
    expect(publicEvidence).not.toContain('(951) 555-0101');
    expect(publicEvidence).not.toContain('951-555-0102');
    expect(existsSync(path.join(outputDirectory, 'matrix-output.log'))).toBe(false);
  });

  it('strictly accepts only the canonical successful 8/8/8/1 contract with no failure objects', () => {
    const outputDirectory = createTemporaryDirectory();
    const successfulCases = EXPECTED_IEHP_PDF_MINI_MATRIX_CASE_IDS.map((caseId) =>
      successfulCase(caseId, caseId === 'skills-behaviors-proof' ? { verified: true } : null));
    const aggregate = {
      ok: true,
      mode: 'pdf-mini-matrix',
      totalCases: 8,
      passedCases: 8,
      cleanupVerifiedCases: 8,
      skillsBehaviorsVerifiedCases: 1,
    };

    finalizeIehpPdfMiniMatrixEvidenceRun({
      logSource: asLog([...successfulCases, aggregate]),
      outputDirectory,
      workflowStatus: 'success',
      metadata: {},
    });

    expect(readJson(outputDirectory, 'cases.json')).toHaveLength(8);
    expect(readJson(outputDirectory, 'aggregate.json')).toEqual(aggregate);
    expect(readJson(outputDirectory, 'run-status.json')).toMatchObject({ ok: true, status: 'success' });

    expect(() => buildFinalizedIehpPdfMiniMatrixEvidence({
      logSource: asLog([...successfulCases.slice(0, 7), failureCase('skills-behaviors-proof'), aggregate]),
      workflowStatus: 'success',
      metadata: {},
    })).toThrow('successful_contract_failed');

    expect(() => buildFinalizedIehpPdfMiniMatrixEvidence({
      logSource: asLog([...successfulCases, { ...aggregate, cleanupVerifiedCases: 7 }]),
      workflowStatus: 'success',
      metadata: {},
    })).toThrow('successful_contract_failed');
  });

  it('fails closed when successful evidence lacks redacted phones or contains a raw phone in an allowed field', () => {
    expect(() => buildFinalizedIehpPdfMiniMatrixEvidence({
      logSource: asLog([{
        ...successfulCase('clean-single-page'),
        assessorPhoneAssertion: {
          ...phoneAssertion,
          actualPhoneRedacted: 'missing-redaction',
        },
      }]),
      workflowStatus: 'failure',
      metadata: {},
    })).toThrow('redacted_phone_evidence_invalid');

    expect(() => buildFinalizedIehpPdfMiniMatrixEvidence({
      logSource: asLog([{
        ...successfulCase('clean-single-page'),
        referralDateAssertion: {
          note: 'unexpected contact 951-555-0199',
        },
      }]),
      workflowStatus: 'failure',
      metadata: {},
    })).toThrow('raw_phone_detected');
  });
});
