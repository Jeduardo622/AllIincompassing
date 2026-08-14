import { describe, expect, it } from 'vitest';
import { isValidPhone } from '../../src/lib/validation';

import {
  IEHP_DEGRADED_SKILLS_BEHAVIORS_PROOF_CASE,
  IEHP_GENERATED_DOCX_PARITY_PROOF_CASE,
  IEHP_PDF_MINI_MATRIX_CASES,
  IEHP_SKILLS_BEHAVIORS_PROOF_CASE,
  assertIehpGeneratedDocxTextParity,
  assertIehpSkillsBehaviorsChecklistSection,
  buildRedactedIehpPreflightBlockerEvidence,
  buildIehpGeneratedDocxParityPdfHtml,
  buildIehpDegradedSkillsBehaviorsRasterPagesHtml,
  buildIehpPdfMiniMatrixHtml,
  buildIehpSkillsBehaviorsProofPdfHtml,
  canonicalizeUsPhoneForComparison,
  buildIehpSmokeUploadFileName,
  buildIehpSmokeCleanupFailureMessage,
  buildIehpSmokeCleanupFailureManifestPayload,
  deriveIehpGeneratedDocxParityManifest,
  resolveIehpSmokeSampleFile,
  selectIehpRequiredFinalOutputApprovals,
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

  it('supports a dedicated generated docx parity smoke command name', () => {
    expect(buildIehpSmokeUploadFileName(12345, 'docx')).toBe('iehp-fba-smoke-12345.docx');
  });

  it('defines exactly the approved IEHP PDF mini matrix cases with unique synthetic values', () => {
    expect(IEHP_PDF_MINI_MATRIX_CASES.map((caseDefinition) => caseDefinition.id)).toEqual([
      'clean-single-page',
      'multi-page-target-content',
      'alternate-document-phone-format',
      'scan-300dpi-monochrome',
      'scan-300dpi-monochrome-rotated-2deg',
      'scan-150dpi-grayscale-low-quality',
      'table-structured-fields',
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
      '909.555.0104',
      '909 555 0105',
      '(909) 555-0106',
      '909-555-0107',
    ]);
  });

  it('keeps every matrix document phone in a distinct accepted format that passes the shared phone validator', () => {
    expect(IEHP_PDF_MINI_MATRIX_CASES.map((caseDefinition) => caseDefinition.documentPhone)).toEqual([
      '(909) 555-0101',
      '909-555-0102',
      '+1 909 555 0103',
      '909.555.0104',
      '909 555 0105',
      '(909) 555-0106',
      '909-555-0107',
    ]);

    for (const caseDefinition of IEHP_PDF_MINI_MATRIX_CASES) {
      expect(isValidPhone(caseDefinition.documentPhone)).toBe(true);
    }
  });

  it('defines one deterministic image-only 300 DPI monochrome scan case', () => {
    expect(
      IEHP_PDF_MINI_MATRIX_CASES.find((caseDefinition) => caseDefinition.id === 'scan-300dpi-monochrome'),
    ).toMatchObject({
      referralDate: '07/03/2026',
      documentPhone: '909.555.0104',
      pageBreakBeforeTarget: false,
      renderMode: 'raster-scan',
      scan: {
        dpi: 300,
        colorMode: 'black-and-white',
        rotationDegrees: 0,
        compression: 'jpeg',
        jpegQuality: 85,
      },
    });
  });

  it('defines one deterministic image-only 300 DPI monochrome scan rotated exactly 2 degrees', () => {
    expect(
      IEHP_PDF_MINI_MATRIX_CASES.find(
        (caseDefinition) => caseDefinition.id === 'scan-300dpi-monochrome-rotated-2deg',
      ),
    ).toMatchObject({
      referralDate: '07/04/2026',
      documentPhone: '909 555 0105',
      pageBreakBeforeTarget: false,
      renderMode: 'raster-scan',
      scan: {
        dpi: 300,
        colorMode: 'black-and-white',
        rotationDegrees: 2,
        compression: 'jpeg',
        jpegQuality: 85,
      },
    });
  });

  it('defines one deterministic degraded 150 DPI grayscale JPEG scan', () => {
    expect(
      IEHP_PDF_MINI_MATRIX_CASES.find(
        (caseDefinition) => caseDefinition.id === 'scan-150dpi-grayscale-low-quality',
      ),
    ).toMatchObject({
      referralDate: '07/05/2026',
      documentPhone: '(909) 555-0106',
      pageBreakBeforeTarget: false,
      renderMode: 'raster-scan',
      scan: {
        dpi: 150,
        colorMode: 'grayscale',
        rotationDegrees: 0,
        compression: 'jpeg',
        jpegQuality: 45,
      },
    });
  });

  it('renders the table-structured case as semantic table cells instead of paragraph labels', () => {
    const tableCase = IEHP_PDF_MINI_MATRIX_CASES.find(
      (caseDefinition) => caseDefinition.id === 'table-structured-fields',
    )!;
    const html = buildIehpPdfMiniMatrixHtml(tableCase);

    expect(tableCase).toMatchObject({
      referralDate: '07/06/2026',
      documentPhone: '909-555-0107',
      renderMode: 'digital-pdf',
      documentLayout: 'table',
    });
    expect(html).toContain('<table>');
    expect(html).toContain('table { border-collapse: collapse; width: 100%; }');
    expect(html).toContain('th, td { border: 1px solid #111; padding: 8px; text-align: left; }');
    expect(html).toContain('<th scope="row">Referral Date:</th>');
    expect(html).toContain('<th scope="row">Assessor\'s phone number:</th>');
    expect(html).toContain(`<td>${tableCase.referralDate}</td>`);
    expect(html).toContain(`<td>${tableCase.documentPhone}</td>`);
    expect(html).not.toContain(`Referral Date: ${tableCase.referralDate}`);
  });

  it('renders the referral label and document phone into selectable HTML with a page break only for the multi-page case', () => {
    for (const caseDefinition of IEHP_PDF_MINI_MATRIX_CASES) {
      const html = buildIehpPdfMiniMatrixHtml(caseDefinition);

      if (caseDefinition.renderMode === 'digital-pdf' && caseDefinition.documentLayout === 'table') {
        expect(html).toContain('<th scope="row">Referral Date:</th>');
        expect(html).toContain(`<td>${caseDefinition.referralDate}</td>`);
        expect(html).toContain('<th scope="row">Assessor\'s phone number:</th>');
        expect(html).toContain(`<td>${caseDefinition.documentPhone}</td>`);
      } else {
        expect(html).toContain(`Referral Date: ${caseDefinition.referralDate}`);
        expect(html).toContain(`Assessor's phone number: ${caseDefinition.documentPhone}`);
      }

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
    const pageOneContentIndex = html.indexOf('IEHP FBA PDF mini-matrix page one');
    const referralDateIndex = html.indexOf('Referral Date: 07/01/2026');
    const assessorPhoneIndex = html.indexOf("Assessor's phone number: 909-555-0102");

    expect(pageOneContentIndex).toBeGreaterThanOrEqual(0);
    expect(pageOneContentIndex).toBeLessThan(pageBreakIndex);
    expect(pageBreakIndex).toBeGreaterThanOrEqual(0);
    expect(pageBreakIndex).toBeLessThan(referralDateIndex);
    expect(pageBreakIndex).toBeLessThan(assessorPhoneIndex);
  });

  it('canonicalizes equivalent ten-digit and +1 US phones to the same comparison value', () => {
    expect(canonicalizeUsPhoneForComparison('909-555-0103')).toBe('9095550103');
    expect(canonicalizeUsPhoneForComparison('+1 909 555 0103')).toBe('9095550103');
  });

  it('defines one dedicated opt-in skills behaviors proof case without changing the existing mini matrix cases', () => {
    expect(IEHP_PDF_MINI_MATRIX_CASES).toHaveLength(7);
    expect(IEHP_SKILLS_BEHAVIORS_PROOF_CASE).toMatchObject({
      id: 'skills-behaviors-proof',
      expectedSectionKey: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
      expectedVersion: 1,
      expectedCounts: {
        total: 4,
        behavior: 1,
        skill: 2,
        summary_only: 1,
        detailed_only: 1,
        ambiguous: 0,
      },
      expectedTargets: ['Physical Aggression', 'Functional Communication', 'Community Safety'],
    });
  });

  it('defines the matrix Skills & Behaviors proof as an image-only 300 DPI monochrome scan rotated exactly 2 degrees', () => {
    expect(IEHP_DEGRADED_SKILLS_BEHAVIORS_PROOF_CASE).toEqual({
      id: 'skills-behaviors-proof-300dpi-monochrome-rotated-2deg',
      renderMode: 'raster-scan',
      scan: {
        dpi: 300,
        colorMode: 'black-and-white',
        rotationDegrees: 2,
        compression: 'jpeg',
        jpegQuality: 85,
      },
    });
  });

  it('renders three fixed-size raster source pages while preserving every Skills & Behaviors assertion anchor', () => {
    const pages = buildIehpDegradedSkillsBehaviorsRasterPagesHtml(
      IEHP_SKILLS_BEHAVIORS_PROOF_CASE,
      IEHP_DEGRADED_SKILLS_BEHAVIORS_PROOF_CASE,
    );

    expect(pages).toHaveLength(3);
    for (const html of pages) {
      expect(html).toContain('width: 2550px');
      expect(html).toContain('height: 3300px');
      expect(html).toContain('transform: rotate(2deg)');
    }

    const combinedHtml = pages.join('\n');
    for (const target of IEHP_SKILLS_BEHAVIORS_PROOF_CASE.expectedTargets) {
      expect(combinedHtml).toContain(target);
    }
    for (const item of Object.values(IEHP_SKILLS_BEHAVIORS_PROOF_CASE.expectedItems)) {
      expect(combinedHtml).toContain(item);
    }
    expect(combinedHtml).toContain('TARGET BEHAVIORS:');
    expect(combinedHtml).toContain('REPLACEMENT BEHAVIORS:');
    expect(combinedHtml).toContain('PARENT EDUCATION:');
  });

  it('renders the dedicated skills behaviors proof html with early summary targets, later child goal blocks, one detailed-only child, and one excluded parent goal', () => {
    const html = buildIehpSkillsBehaviorsProofPdfHtml(IEHP_SKILLS_BEHAVIORS_PROOF_CASE);

    expect(html).toContain('BEHAVIORS:');
    expect(html).toContain('The behaviors and functional skills to be addressed are:');
    expect(html).toContain('BACKGROUND INFORMATION');
    expect(html).toContain('Physical Aggression');
    expect(html).toContain('Functional Communication');
    expect(html).toContain('Community Safety');
    expect(html).toContain(IEHP_SKILLS_BEHAVIORS_PROOF_CASE.expectedTargets.join('; '));
    expect(html).toContain('TARGET BEHAVIORS:');
    expect(html).toContain('REPLACEMENT BEHAVIORS:');
    expect(html).toContain('Program Name:');
    expect(html).toContain('Instrumental Goal:');
    expect(html).toContain('Waiting');
    expect(html).toContain('Safety/Crisis Procedure');
    expect(html).toContain('Parent Coaching');
    expect(html).toContain('PARENT EDUCATION:');
    expect(html).toContain('Location of Service:');

    const orderedAnchors = [
      'BEHAVIORS:',
      'BACKGROUND INFORMATION',
      'TARGET BEHAVIORS:',
      'REPLACEMENT BEHAVIORS:',
      'Safety/Crisis Procedure',
      'PARENT EDUCATION:',
      'Location of Service:',
    ].map((anchor) => html.indexOf(anchor));
    expect(orderedAnchors.every((index) => index >= 0)).toBe(true);
    expect(orderedAnchors).toEqual([...orderedAnchors].sort((left, right) => left - right));
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

  it('redacts preflight blocker evidence down to code and count only', () => {
    expect(
      buildRedactedIehpPreflightBlockerEvidence({
        ready: false,
        blockers: [
          { code: 'required_checklist_pending', message: 'Synthetic detail that must stay private.' },
          { code: 'required_checklist_pending', message: 'Second private detail.' },
          { code: 'required_structured_sections_pending', message: 'Another private detail.' },
        ],
      }),
    ).toEqual({
      ready: false,
      blockerCount: 3,
      blockerCodes: ['required_checklist_pending', 'required_structured_sections_pending'],
      hasUnapprovedRequiredBlocker: true,
    });
  });

  it('renders a dedicated synthetic IEHP generated-docx parity PDF fixture with full extraction headings and deterministic terms', () => {
    const html = buildIehpGeneratedDocxParityPdfHtml(IEHP_GENERATED_DOCX_PARITY_PROOF_CASE);

    for (const term of IEHP_GENERATED_DOCX_PARITY_PROOF_CASE.expectedBehaviorSkillTerms) {
      expect(html).toContain(term);
    }
    for (const term of IEHP_GENERATED_DOCX_PARITY_PROOF_CASE.expectedNarrativeTerms) {
      expect(html).toContain(term);
    }

    expect(html).toContain('Report Date: 08/12/2026');
    expect(html).toContain('IEHP Member ID#: SYNTH-0001');
    expect(html).toContain('Records Reviewed: 08/01/2026 Telehealth BCBA');
    expect(html).toContain('Clinical Interview: 08/02/2026 Home BCBA');
    expect(html).toContain('1st Member Observation: 08/03/2026 home observation narrative.');
    expect(html).toContain('2nd Member Observation: 08/04/2026 school observation narrative.');
    expect(html).toContain('H2019 Therapeutic Behavioral Services, per 15 minutes 10 units');
    expect(html).toContain('H0032 Mental Health Service Plan Development by Non-Physician, per 15 minutes 4 units');
  });
});

describe('assertIehpSkillsBehaviorsChecklistSection', () => {
  const buildChecklist = (structuredSectionOverrides: Array<Record<string, unknown>>) => ({
    items: [],
    structured_sections: structuredSectionOverrides,
  });

  const validStructuredSection = {
    field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
    section_index: 0,
    payload: {
      targets: ['Physical Aggression', 'Functional Communication', 'Community Safety'],
      skills_behaviors: {
        version: 1,
        counts: {
          total: 4,
          behavior: 1,
          skill: 2,
          summary_only: 1,
          detailed_only: 1,
          ambiguous: 0,
        },
        items: [
          {
            name: 'Physical Aggression',
            clinical_goal_type: 'behavior',
            reconciliation_status: 'matched',
            summary_target_index: 0,
            matched_goal_refs: [
              { field_key: 'IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS', section_index: 0 },
            ],
            classification_source: 'detailed_goal_field_key',
          },
          {
            name: 'Functional Communication',
            clinical_goal_type: 'skill',
            reconciliation_status: 'matched',
            summary_target_index: 1,
            matched_goal_refs: [
              { field_key: 'IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS', section_index: 0 },
            ],
            classification_source: 'detailed_goal_field_key',
          },
          {
            name: 'Community Safety',
            clinical_goal_type: null,
            reconciliation_status: 'summary_only',
            summary_target_index: 2,
            matched_goal_refs: [],
            classification_source: null,
          },
          {
            name: 'Waiting',
            clinical_goal_type: 'skill',
            reconciliation_status: 'detailed_only',
            summary_target_index: null,
            matched_goal_refs: [
              { field_key: 'IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS', section_index: 1 },
            ],
            classification_source: 'detailed_goal_field_key',
          },
        ],
      },
    },
  };

  it('returns redacted count-and-boolean-only evidence for the dedicated proof contract', () => {
    expect(
      assertIehpSkillsBehaviorsChecklistSection({
        checklist: buildChecklist([validStructuredSection]),
        proofCase: IEHP_SKILLS_BEHAVIORS_PROOF_CASE,
      }),
    ).toEqual({
      rowCount: 1,
      version: 1,
      totalCountMatched: true,
      behaviorParsed: true,
      skillParsed: true,
      needsReviewPreserved: true,
      detailedOnlyPreserved: true,
      parentExcluded: true,
      provenanceVerified: true,
    });
  });

  it.each([
    {
      name: 'missing summary row',
      checklist: buildChecklist([]),
      message:
        'IEHP smoke could not find IEHP_FBA_BEHAVIOR_SKILL_TARGETS in structured sections.',
    },
    {
      name: 'duplicate summary rows',
      checklist: buildChecklist([validStructuredSection, validStructuredSection]),
      message:
        'IEHP smoke expected exactly one IEHP_FBA_BEHAVIOR_SKILL_TARGETS structured section row but found 2.',
    },
    {
      name: 'missing skills behaviors payload',
      checklist: buildChecklist([
        {
          ...validStructuredSection,
          payload: {
            targets: ['Physical Aggression', 'Functional Communication', 'Community Safety'],
          },
        },
      ]),
      message:
        'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors was missing or malformed.',
    },
    {
      name: 'wrong counts',
      checklist: buildChecklist([
        {
          ...validStructuredSection,
          payload: {
            ...validStructuredSection.payload,
            skills_behaviors: {
              ...validStructuredSection.payload.skills_behaviors,
              counts: {
                total: 5,
                behavior: 1,
                skill: 2,
                summary_only: 1,
                detailed_only: 1,
                ambiguous: 0,
              },
            },
          },
        },
      ]),
      message:
        'IEHP smoke expected IEHP_FBA_BEHAVIOR_SKILL_TARGETS counts to match the synthetic proof contract exactly.',
    },
    {
      name: 'parent included',
      checklist: buildChecklist([
        {
          ...validStructuredSection,
          payload: {
            ...validStructuredSection.payload,
            skills_behaviors: {
              ...validStructuredSection.payload.skills_behaviors,
              items: [
                ...validStructuredSection.payload.skills_behaviors.items,
                {
                  name: 'Parent Coaching',
                  clinical_goal_type: 'skill',
                  reconciliation_status: 'detailed_only',
                  summary_target_index: null,
                  matched_goal_refs: [
                    { field_key: 'IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS', section_index: 2 },
                  ],
                  classification_source: 'detailed_goal_field_key',
                },
              ],
              counts: {
                total: 5,
                behavior: 1,
                skill: 3,
                summary_only: 1,
                detailed_only: 2,
                ambiguous: 0,
              },
            },
          },
        },
      ]),
      message:
        'IEHP smoke expected the parent education goal to stay excluded from skills_behaviors items.',
    },
    {
      name: 'missing matched goal refs',
      checklist: buildChecklist([
        {
          ...validStructuredSection,
          payload: {
            ...validStructuredSection.payload,
            skills_behaviors: {
              ...validStructuredSection.payload.skills_behaviors,
              items: [
                {
                  ...validStructuredSection.payload.skills_behaviors.items[0],
                  matched_goal_refs: [],
                },
                ...validStructuredSection.payload.skills_behaviors.items.slice(1),
              ],
            },
          },
        },
      ]),
      message:
        'IEHP smoke expected every matched or detailed-only skills_behaviors item to expose provenance refs.',
    },
    {
      name: 'malformed mixed-array items',
      checklist: buildChecklist([
        {
          ...validStructuredSection,
          payload: {
            ...validStructuredSection.payload,
            skills_behaviors: {
              ...validStructuredSection.payload.skills_behaviors,
              items: [
                validStructuredSection.payload.skills_behaviors.items[0],
                'malformed-item',
                ...validStructuredSection.payload.skills_behaviors.items.slice(1),
              ],
            },
          },
        },
      ]),
      message:
        'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors.items contained a malformed entry.',
    },
    {
      name: 'wrong clinical goal type',
      checklist: buildChecklist([
        {
          ...validStructuredSection,
          payload: {
            ...validStructuredSection.payload,
            skills_behaviors: {
              ...validStructuredSection.payload.skills_behaviors,
              items: [
                {
                  ...validStructuredSection.payload.skills_behaviors.items[0],
                  clinical_goal_type: 'unsupported',
                },
                ...validStructuredSection.payload.skills_behaviors.items.slice(1),
              ],
            },
          },
        },
      ]),
      message:
        'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors.items contained an invalid clinical_goal_type.',
    },
    {
      name: 'wrong reconciliation status type pairing',
      checklist: buildChecklist([
        {
          ...validStructuredSection,
          payload: {
            ...validStructuredSection.payload,
            skills_behaviors: {
              ...validStructuredSection.payload.skills_behaviors,
              items: [
                validStructuredSection.payload.skills_behaviors.items[0],
                {
                  ...validStructuredSection.payload.skills_behaviors.items[1],
                  clinical_goal_type: 'skill',
                  reconciliation_status: 'summary_only',
                },
                ...validStructuredSection.payload.skills_behaviors.items.slice(2),
              ],
            },
          },
        },
      ]),
      message:
        'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors.items contained an invalid reconciliation_status for its clinical_goal_type.',
    },
  ])('fails clearly for $name', ({ checklist, message }) => {
    expect(() =>
      assertIehpSkillsBehaviorsChecklistSection({
        checklist,
        proofCase: IEHP_SKILLS_BEHAVIORS_PROOF_CASE,
      }),
    ).toThrow(message);
  });
});

describe('deriveIehpGeneratedDocxParityManifest', () => {
  const checklist = {
    items: [],
    structured_sections: [
      {
        field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
        payload: {
          skills_behaviors: {
            version: 1,
            items: [
              {
                name: 'Behavior One',
                clinical_goal_type: 'behavior',
                reconciliation_status: 'matched',
              },
              {
                name: 'Skill One',
                clinical_goal_type: 'skill',
                reconciliation_status: 'matched',
              },
              {
                name: 'Skill Two',
                clinical_goal_type: 'skill',
                reconciliation_status: 'detailed_only',
              },
            ],
          },
        },
      },
    ],
  };

  it('derives a v1 generated-docx parity manifest from skills_behaviors without producing log-ready names', () => {
    expect(deriveIehpGeneratedDocxParityManifest({ checklist })).toEqual({
      sectionCount: 1,
      version: 1,
      names: ['Behavior One', 'Skill One', 'Skill Two'],
      totalNames: 3,
      behaviorCount: 1,
      skillCount: 2,
      matchedCount: 2,
      detailedOnlyCount: 1,
      summaryOnlyOrAmbiguousCount: 0,
    });
  });

  it.each(['summary_only', 'ambiguous'] as const)(
    'refuses to build an auto-approval manifest with a %s skills_behaviors item',
    (reconciliationStatus) => {
      const unresolvedChecklist = structuredClone(checklist);
      const section = unresolvedChecklist.structured_sections[0];
      section.payload.skills_behaviors.items.push({
        name: 'Needs Review',
        clinical_goal_type: null,
        reconciliation_status: reconciliationStatus,
      });

      expect(() => deriveIehpGeneratedDocxParityManifest({ checklist: unresolvedChecklist })).toThrow(
        'IEHP generated DOCX parity refuses to auto-approve summary-only or ambiguous skills_behaviors items.',
      );
    },
  );

  it.each([
    {
      name: 'missing section',
      input: { items: [], structured_sections: [] },
      message: 'IEHP smoke could not find IEHP_FBA_BEHAVIOR_SKILL_TARGETS in structured sections.',
    },
    {
      name: 'wrong version',
      input: {
        items: [],
        structured_sections: [
          {
            field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
            payload: { skills_behaviors: { version: 2, items: [{ name: 'Behavior One', clinical_goal_type: 'behavior', reconciliation_status: 'matched' }, { name: 'Skill One', clinical_goal_type: 'skill', reconciliation_status: 'matched' }] } },
          },
        ],
      },
      message: 'IEHP smoke expected IEHP_FBA_BEHAVIOR_SKILL_TARGETS skills_behaviors.version to equal 1.',
    },
    {
      name: 'missing behavior',
      input: {
        items: [],
        structured_sections: [
          {
            field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
            payload: { skills_behaviors: { version: 1, items: [{ name: 'Skill One', clinical_goal_type: 'skill', reconciliation_status: 'matched' }] } },
          },
        ],
      },
      message: 'IEHP smoke expected at least one behavior and one skill in IEHP_FBA_BEHAVIOR_SKILL_TARGETS.',
    },
    {
      name: 'blank item name',
      input: {
        items: [],
        structured_sections: [
          {
            field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
            payload: { skills_behaviors: { version: 1, items: [{ name: 'Behavior One', clinical_goal_type: 'behavior', reconciliation_status: 'matched' }, { name: '   ', clinical_goal_type: 'skill', reconciliation_status: 'matched' }] } },
          },
        ],
      },
      message: 'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors.items contained a blank name.',
    },
  ])('fails clearly for $name', ({ input, message }) => {
    expect(() => deriveIehpGeneratedDocxParityManifest({ checklist: input })).toThrow(message);
  });
});

describe('assertIehpGeneratedDocxTextParity', () => {
  const proofCase = {
    id: 'generated-docx-parity' as const,
    expectedSectionHeadings: ['I. IDENTIFICATION', 'IX. TARGET BEHAVIORS'],
    expectedBehaviorSkillTerms: ['Behavior One', 'Skill One', 'Skill Two', 'Skill Three'] as const,
    expectedNarrativeTerms: ['Synthetic narrative one', 'Synthetic narrative two'],
  };
  const sourceManifest = {
    sectionCount: 1 as const,
    version: 1 as const,
    names: ['Behavior One', 'Skill One'],
    totalNames: 2,
    behaviorCount: 1,
    skillCount: 1,
    matchedCount: 2,
    detailedOnlyCount: 0,
    summaryOnlyOrAmbiguousCount: 0,
  };
  const completeText = [
    ...proofCase.expectedSectionHeadings,
    ...proofCase.expectedNarrativeTerms,
    ...sourceManifest.names,
  ].join('\n');

  it('requires names, representative section headings, and representative source narratives', () => {
    expect(assertIehpGeneratedDocxTextParity({ generatedDocxText: completeText, sourceManifest, proofCase })).toEqual({
      expectedNameCount: 2,
      matchedNameCount: 2,
      expectedSectionHeadingCount: 2,
      matchedSectionHeadingCount: 2,
      expectedNarrativeTermCount: 2,
      matchedNarrativeTermCount: 2,
      allExpectedContentPresent: true,
    });
  });

  it('matches section headings across Word run fragmentation and non-literal numbering', () => {
    const fragmentedProofCase = {
      ...proofCase,
      expectedSectionHeadings: ['II. BEHAVIORS', 'Assessor/Certification:', 'Safety Procedure/Crisis Plan'],
    };
    const fragmentedText = [
      'BEHAVIORS :',
      'Assessor /C ertification :',
      'Safety Procedure/Crisis Plan-',
      ...proofCase.expectedNarrativeTerms,
      ...sourceManifest.names,
    ].join('\n');

    expect(
      assertIehpGeneratedDocxTextParity({
        generatedDocxText: fragmentedText,
        sourceManifest,
        proofCase: fragmentedProofCase,
      }),
    ).toMatchObject({
      matchedSectionHeadingCount: 3,
      allExpectedContentPresent: true,
    });
  });

  it('does not satisfy missing headings with related body text or later behavior headings', () => {
    const collisionProofCase = {
      ...proofCase,
      expectedSectionHeadings: [
        'II. BEHAVIORS',
        'ASSESSMENT MEAURES:',
        'Discharge, Transition and Exit Plans:',
        'Transition Planning:',
      ],
    };
    const collisionText = [
      'TARGET BEHAVIORS:',
      'REPLACEMENT BEHAVIORS:',
      'Assessment Summary:',
      'Discharge criteria are described in this body paragraph.',
      'Transition planning includes fading service intensity.',
      ...proofCase.expectedNarrativeTerms,
      ...sourceManifest.names,
    ].join('\n');

    expect(() =>
      assertIehpGeneratedDocxTextParity({
        generatedDocxText: collisionText,
        sourceManifest,
        proofCase: collisionProofCase,
      }),
    ).toThrow('representative IEHP section heading');
  });

  it.each([
    {
      label: 'skill or behavior name',
      text: completeText.replace('Behavior One', 'Behavior\nOne'),
    },
    {
      label: 'source narrative',
      text: completeText.replace('Synthetic narrative two', 'Synthetic narrative\ntwo'),
    },
  ])('does not join adjacent paragraphs to satisfy a missing $label', ({ text }) => {
    expect(() =>
      assertIehpGeneratedDocxTextParity({
        generatedDocxText: text,
        sourceManifest,
        proofCase,
      }),
    ).toThrow('IEHP generated DOCX parity expected');
  });

  it.each([
    ['skill or behavior name', 'Behavior One'],
    ['section heading', 'IX. TARGET BEHAVIORS'],
    ['source narrative', 'Synthetic narrative two'],
  ])('fails closed when the generated DOCX omits a representative %s', (_label, missingTerm) => {
    expect(() =>
      assertIehpGeneratedDocxTextParity({
        generatedDocxText: completeText.replace(missingTerm, ''),
        sourceManifest,
        proofCase,
      }),
    ).toThrow('IEHP generated DOCX parity expected');
  });
});

describe('selectIehpRequiredFinalOutputApprovals', () => {
  const baseChecklist = {
    items: [
      {
        id: 'required-checklist',
        label: 'Required text field',
        placeholder_key: 'IEHP_REQUIRED_TEXT',
        required: true,
        status: 'verified',
        value_text: 'Approved text',
      },
      {
        id: 'optional-phone',
        label: 'Optional phone',
        placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
        required: true,
        status: 'verified',
        value_text: '(951) 555-0101',
      },
    ],
    structured_sections: [
      {
        id: 'required-structured',
        field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
        section_key: 'behavior-skill-targets',
        section_index: 0,
        required: true,
        status: 'verified',
        payload: {
          skills_behaviors: {
            version: 1,
            items: [{ name: 'Behavior One', clinical_goal_type: 'behavior', reconciliation_status: 'matched' }],
          },
          keep_server_side: true,
        },
      },
      {
        id: 'optional-provider',
        field_key: 'IEHP_FBA_REFERRING_PROVIDER',
        section_key: 'provider',
        section_index: 1,
        required: true,
        status: 'verified',
        payload: { provider: 'Synthetic Provider' },
      },
    ],
  };

  it('selects only final-output-required approvals and keeps structured approvals status-only', () => {
    const result = selectIehpRequiredFinalOutputApprovals({ checklist: baseChecklist });

    expect(result.summary).toEqual({
      checklistCount: 1,
      structuredCount: 1,
      allRequiredRowsApproved: false,
    });
    expect(result.checklistApprovals).toEqual([
      {
        item_id: 'required-checklist',
        status: 'approved',
        review_notes: 'IEHP generated DOCX parity auto-approved required checklist row from synthetic smoke fixture.',
        value_text: 'Approved text',
      },
    ]);
    expect(result.structuredSectionApprovals).toEqual([
      {
        structured_section_id: 'required-structured',
        status: 'approved',
        review_notes: 'IEHP generated DOCX parity auto-approved required structured row from synthetic smoke fixture.',
      },
    ]);
  });

  it('reports all required rows approved after already-approved required rows are filtered out', () => {
    const result = selectIehpRequiredFinalOutputApprovals({
      checklist: {
        items: [
          {
            id: 'required-checklist',
            label: 'Required text field',
            placeholder_key: 'IEHP_REQUIRED_TEXT',
            required: true,
            status: 'approved',
            value_text: 'Approved text',
          },
        ],
        structured_sections: [
          {
            id: 'required-structured',
            field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
            section_key: 'behavior-skill-targets',
            section_index: 0,
            required: true,
            status: 'approved',
            payload: {
              targets: ['Behavior One'],
              skills_behaviors: {
                version: 1,
                items: [{ name: 'Behavior One', clinical_goal_type: 'behavior', reconciliation_status: 'matched' }],
              },
            },
          },
        ],
      },
    });

    expect(result.summary).toEqual({
      checklistCount: 0,
      structuredCount: 0,
      allRequiredRowsApproved: true,
    });
  });

  it('preserves value_json on checklist approvals instead of stringifying it into value_text', () => {
    const valueJson = { narrative: 'Structured review value', selected: 'yes' };
    const result = selectIehpRequiredFinalOutputApprovals({
      checklist: {
        items: [
          {
            id: 'required-checklist',
            label: 'Required json field',
            placeholder_key: 'IEHP_REQUIRED_JSON',
            required: true,
            status: 'verified',
            value_text: '   ',
            value_json: valueJson,
          },
        ],
        structured_sections: [],
      },
    });

    expect(result.checklistApprovals).toEqual([
      {
        item_id: 'required-checklist',
        status: 'approved',
        review_notes: 'IEHP generated DOCX parity auto-approved required checklist row from synthetic smoke fixture.',
        value_json: valueJson,
      },
    ]);
  });

  it.each([
    {
      name: 'blank required checklist value',
      checklist: {
        items: [
          {
            id: 'required-checklist',
            label: 'Required text field',
            placeholder_key: 'IEHP_REQUIRED_TEXT',
            required: true,
            status: 'verified',
            value_text: '   ',
          },
        ],
        structured_sections: [],
      },
      message: 'IEHP smoke required checklist row IEHP_REQUIRED_TEXT was blank or malformed.',
    },
    {
      name: 'missing required structured payload',
      checklist: {
        items: [],
        structured_sections: [
          {
            id: 'required-structured',
            field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
            section_key: 'behavior-skill-targets',
            section_index: 0,
            required: true,
            status: 'verified',
            payload: null,
          },
        ],
      },
      message: 'IEHP smoke required structured row IEHP_FBA_BEHAVIOR_SKILL_TARGETS was blank or malformed.',
    },
    {
      name: 'false-only checklist value',
      checklist: {
        items: [
          {
            id: 'required-checklist',
            label: 'Required boolean field',
            placeholder_key: 'IEHP_REQUIRED_BOOLEAN',
            required: true,
            status: 'verified',
            value_json: false,
          },
        ],
        structured_sections: [],
      },
      message: 'IEHP smoke required checklist row IEHP_REQUIRED_BOOLEAN was blank or malformed.',
    },
    {
      name: 'metadata-only structured payload',
      checklist: {
        items: [],
        structured_sections: [
          {
            id: 'required-structured',
            field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
            section_key: 'behavior-skill-targets',
            section_index: 0,
            required: true,
            status: 'verified',
            payload: {
              field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
              section_index: 0,
              required: true,
              source: 'adobe',
            },
          },
        ],
      },
      message: 'IEHP smoke required structured row IEHP_FBA_BEHAVIOR_SKILL_TARGETS was blank or malformed.',
    },
    {
      name: 'derived-only skills behaviors payload',
      checklist: {
        items: [],
        structured_sections: [
          {
            id: 'required-structured',
            field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
            required: true,
            status: 'verified',
            payload: {
              skills_behaviors: {
                version: 1,
                items: [{ name: 'Derived Only', clinical_goal_type: 'skill', reconciliation_status: 'matched' }],
              },
            },
          },
        ],
      },
      message: 'IEHP smoke required structured row IEHP_FBA_BEHAVIOR_SKILL_TARGETS was blank or malformed.',
    },
    {
      name: 'approved metadata-only structured payload',
      checklist: {
        items: [],
        structured_sections: [
          {
            id: 'required-structured',
            field_key: 'IEHP_FBA_REASON_FOR_REFERRAL',
            required: true,
            status: 'approved',
            payload: { source: 'adobe', template_placeholder: true, entered_value_present: false },
          },
        ],
      },
      message: 'IEHP smoke required structured row IEHP_FBA_REASON_FOR_REFERRAL was blank or malformed.',
    },
    {
      name: 'unknown-only structured payload',
      checklist: {
        items: [],
        structured_sections: [
          {
            id: 'required-structured',
            field_key: 'IEHP_FBA_REASON_FOR_REFERRAL',
            required: true,
            status: 'verified',
            payload: { clinical_value: 'unknown' },
          },
        ],
      },
      message: 'IEHP smoke required structured row IEHP_FBA_REASON_FOR_REFERRAL was blank or malformed.',
    },
    {
      name: 'unreviewable checklist status',
      checklist: {
        items: [
          {
            id: 'required-checklist',
            placeholder_key: 'IEHP_REQUIRED_TEXT',
            required: true,
            status: 'not_started',
            value_text: 'Synthetic value',
          },
        ],
        structured_sections: [],
      },
      message: 'IEHP smoke required row IEHP_REQUIRED_TEXT was not in a reviewable status for synthetic auto-approval.',
    },
    {
      name: 'rejected structured status',
      checklist: {
        items: [],
        structured_sections: [
          {
            id: 'required-structured',
            field_key: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
            required: true,
            status: 'rejected',
            payload: { narrative: 'Synthetic value' },
          },
        ],
      },
      message:
        'IEHP smoke required row IEHP_FBA_BEHAVIOR_SKILL_TARGETS was not in a reviewable status for synthetic auto-approval.',
    },
  ])('fails closed for $name', ({ checklist, message }) => {
    expect(() => selectIehpRequiredFinalOutputApprovals({ checklist })).toThrow(message);
  });
});
