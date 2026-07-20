import { describe, expect, it } from 'vitest';
import { isValidPhone } from '../../src/lib/validation';

import {
  IEHP_PDF_MINI_MATRIX_CASES,
  IEHP_SKILLS_BEHAVIORS_PROOF_CASE,
  assertIehpSkillsBehaviorsChecklistSection,
  buildIehpPdfMiniMatrixHtml,
  buildIehpSkillsBehaviorsProofPdfHtml,
  canonicalizeUsPhoneForComparison,
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
    expect(IEHP_PDF_MINI_MATRIX_CASES).toHaveLength(3);
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
              { field_key: 'IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS', section_index: 1 },
            ],
            classification_source: 'explicit_goal_type',
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
