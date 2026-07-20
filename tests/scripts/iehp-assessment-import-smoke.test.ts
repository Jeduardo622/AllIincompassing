import { describe, expect, it } from 'vitest';
import { isValidPhone } from '../../src/lib/validation';

import {
  IEHP_PDF_MINI_MATRIX_CASES,
  buildIehpPdfMiniMatrixHtml,
  buildIehpSmokeUploadFileName,
  buildIehpSmokeCleanupFailureMessage,
  buildIehpSmokeCleanupFailureManifestPayload,
  resolveIehpSmokeSampleFile,
} from '../../scripts/lib/iehp-assessment-import-smoke';

describe('IEHP assessment import smoke helpers', () => {
  const normalizePath = (value: string): string => value.replace(/\\/g, '/');

  it('uses an explicitly configured sample file when provided', () => {
    const resolved = resolveIehpSmokeSampleFile({
      cwd: 'C:/repo',
      env: { PW_ASSESSMENT_SAMPLE_FILE: 'fixtures/custom-iehp.docx' },
      candidateFileNames: ['root IEHP FBA.docx'],
    });

    expect(normalizePath(resolved)).toMatch(/\/repo\/fixtures\/custom-iehp\.docx$/);
  });

  it('discovers a single safe root IEHP FBA DOCX without hard-coding the real file name', () => {
    const resolved = resolveIehpSmokeSampleFile({
      cwd: 'C:/repo',
      env: {},
      candidateFileNames: ['Updated FBA -IEHP (2).docx', 'Synthetic IEHP FBA sample.docx', 'CO-FBA-Template (1).docx'],
    });

    expect(normalizePath(resolved)).toMatch(/\/repo\/Synthetic IEHP FBA sample\.docx$/);
  });

  it('does not silently select a client-like IEHP FBA file by default', () => {
    expect(() =>
      resolveIehpSmokeSampleFile({
        cwd: 'C:/repo',
        env: {},
        candidateFileNames: ['Client Name IEHP FBA December 2025.docx'],
      }),
    ).toThrow('Set PW_ASSESSMENT_SAMPLE_FILE');
  });

  it('fails when the default IEHP sample cannot be selected deterministically', () => {
    expect(() =>
      resolveIehpSmokeSampleFile({
        cwd: 'C:/repo',
        env: {},
        candidateFileNames: ['first IEHP FBA.docx', 'second IEHP FBA.docx'],
      }),
    ).toThrow('Expected exactly one safe root IEHP FBA DOCX sample');
  });

  it('uses a synthetic upload file name instead of the source file name', () => {
    expect(buildIehpSmokeUploadFileName(12345)).toBe('iehp-fba-smoke-12345.docx');
  });

  it('keeps the default DOCX upload name and supports PDF uploads explicitly', () => {
    expect(buildIehpSmokeUploadFileName(12345)).toBe('iehp-fba-smoke-12345.docx');
    expect(buildIehpSmokeUploadFileName(12345, 'pdf')).toBe('iehp-fba-smoke-12345.pdf');
  });

  it('defines exactly the approved IEHP PDF mini matrix cases with unique synthetic values', () => {
    expect(IEHP_PDF_MINI_MATRIX_CASES.map((caseDefinition) => caseDefinition.id)).toEqual([
      'clean-single-page',
      'multi-page-target-content',
      'alternate-document-phone-format',
    ]);

    expect(new Set(IEHP_PDF_MINI_MATRIX_CASES.map((caseDefinition) => caseDefinition.referralDate)).size).toBe(
      IEHP_PDF_MINI_MATRIX_CASES.length,
    );
    expect(new Set(IEHP_PDF_MINI_MATRIX_CASES.map((caseDefinition) => caseDefinition.documentPhone)).size).toBe(
      IEHP_PDF_MINI_MATRIX_CASES.length,
    );
    expect(IEHP_PDF_MINI_MATRIX_CASES.map((caseDefinition) => caseDefinition.documentPhone)).toEqual([
      '(909) 555-0101',
      '909-555-0102',
      '+1 909 555 0103',
    ]);
  });

  it('keeps every matrix document phone in a distinct accepted format that passes the shared phone validator', () => {
    expect(IEHP_PDF_MINI_MATRIX_CASES.map((caseDefinition) => caseDefinition.documentPhone)).toEqual([
      '(909) 555-0101',
      '909-555-0102',
      '+1 909 555 0103',
    ]);

    for (const caseDefinition of IEHP_PDF_MINI_MATRIX_CASES) {
      expect(isValidPhone(caseDefinition.documentPhone)).toBe(true);
    }
  });

  it('renders the referral label and document phone into selectable HTML with a page break only for the multi-page case', () => {
    for (const caseDefinition of IEHP_PDF_MINI_MATRIX_CASES) {
      const html = buildIehpPdfMiniMatrixHtml(caseDefinition);

      expect(html).toContain(`Referral Date: ${caseDefinition.referralDate}`);
      expect(html).toContain(`Assessor's phone number: ${caseDefinition.documentPhone}`);

      if (caseDefinition.pageBreakBeforeTarget) {
        expect(html).toContain('page-break-before: always;');
      } else {
        expect(html).not.toContain('page-break-before: always;');
      }
    }
  });

  it('places the multi-page page-break token before both the referral date and assessor phone so the asserted content lands on page two', () => {
    const html = buildIehpPdfMiniMatrixHtml(
      IEHP_PDF_MINI_MATRIX_CASES.find((caseDefinition) => caseDefinition.id === 'multi-page-target-content')!,
    );
    const pageBreakIndex = html.indexOf('page-break-before: always;');
    const referralDateIndex = html.indexOf('Referral Date: 07/01/2026');
    const assessorPhoneIndex = html.indexOf("Assessor's phone number: 909-555-0102");

    expect(pageBreakIndex).toBeGreaterThanOrEqual(0);
    expect(pageBreakIndex).toBeLessThan(referralDateIndex);
    expect(pageBreakIndex).toBeLessThan(assessorPhoneIndex);
  });

  it('redacts cleanup failure manifests', () => {
    const payload = buildIehpSmokeCleanupFailureManifestPayload({
      cleanupError: new Error('Storage cleanup failed for client-documents/clients/client-1/assessments/file.docx'),
      cleanupTargetKnown: true,
      createdAt: '2026-06-02T00:00:00.000Z',
      runError: new Error('run failed for doc-1'),
    });

    expect(JSON.stringify(payload)).not.toContain('client-1');
    expect(JSON.stringify(payload)).not.toContain('doc-1');
    expect(payload).toEqual({
      createdAt: '2026-06-02T00:00:00.000Z',
      cleanupTargetKnown: true,
      cleanupError: 'Cleanup failed; inspect local terminal context or hosted smoke records for manual cleanup.',
      runError: 'IEHP smoke run failed before cleanup completed.',
    });
  });

  it('redacts cleanup failure error messages', () => {
    const message = buildIehpSmokeCleanupFailureMessage({
      cleanupFailed: true,
      cleanupManifestPath: 'artifacts/latest/manifest.json',
      cleanupManifestWriteFailed: false,
      runFailed: true,
    });

    expect(message).toContain('IEHP assessment import smoke failed and cleanup did not complete.');
    expect(message).toContain('Manual cleanup may be required.');
    expect(message).toContain('artifacts/latest/manifest.json');
    expect(message).not.toContain('client-documents');
    expect(message).not.toContain('doc-1');
  });
});
