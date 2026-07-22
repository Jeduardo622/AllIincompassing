import { readdirSync } from 'node:fs';
import path from 'node:path';

type IehpPdfMiniMatrixBaseCase = {
  referralDate: string;
  documentPhone: string;
  pageBreakBeforeTarget: boolean;
};

type IehpDigitalPdfMiniMatrixCase = IehpPdfMiniMatrixBaseCase & {
  id: 'clean-single-page' | 'multi-page-target-content' | 'alternate-document-phone-format';
  renderMode: 'digital-pdf';
};

type IehpRasterPdfMiniMatrixCase = IehpPdfMiniMatrixBaseCase & {
  id: 'scan-300dpi-monochrome' | 'scan-300dpi-monochrome-rotated-2deg';
  renderMode: 'raster-scan';
  scan: {
    dpi: 300;
    colorMode: 'black-and-white';
    rotationDegrees: 0 | 2;
    compression: 'jpeg';
    jpegQuality: 85;
  };
};

export type IehpPdfMiniMatrixCase = IehpDigitalPdfMiniMatrixCase | IehpRasterPdfMiniMatrixCase;

type DocumentChecklistItem = {
  placeholder_key: string;
  value_text?: string | null;
};

type DocumentChecklistResponse = {
  items: DocumentChecklistItem[];
  structured_sections?: unknown[];
};

type AssessmentExtractionProvenanceRow = {
  field_key?: string | null;
  source_span?: unknown;
};

type SkillsBehaviorsChecklistStructuredSection = {
  field_key?: unknown;
  payload?: unknown;
};

type SkillsBehaviorsGoalRef = {
  field_key?: unknown;
  section_index?: unknown;
};

type SkillsBehaviorsItem = {
  name?: unknown;
  clinical_goal_type?: unknown;
  reconciliation_status?: unknown;
  summary_target_index?: unknown;
  matched_goal_refs?: unknown;
  classification_source?: unknown;
};

type SkillsBehaviorsCounts = {
  total?: unknown;
  behavior?: unknown;
  skill?: unknown;
  summary_only?: unknown;
  detailed_only?: unknown;
  ambiguous?: unknown;
};

type SkillsBehaviorsClinicalGoalType = 'behavior' | 'skill' | null;

type SkillsBehaviorsReconciliationStatus = 'matched' | 'summary_only' | 'detailed_only' | 'ambiguous';

export type IehpSkillsBehaviorsProofCase = {
  id: 'skills-behaviors-proof';
  expectedSectionKey: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS';
  expectedVersion: 1;
  expectedTargets: readonly [string, string, string];
  expectedCounts: {
    total: 4;
    behavior: 1;
    skill: 2;
    summary_only: 1;
    detailed_only: 1;
    ambiguous: 0;
  };
  expectedStatuses: {
    behaviorMatched: 'matched';
    skillMatched: 'matched';
    needsReview: 'summary_only';
    detailedOnly: 'detailed_only';
  };
  expectedItems: {
    behavior: string;
    skill: string;
    needsReview: string;
    detailedOnly: string;
    excludedParent: string;
  };
};

export type IehpSkillsBehaviorsAssertion = {
  rowCount: 1;
  version: 1;
  totalCountMatched: true;
  behaviorParsed: true;
  skillParsed: true;
  needsReviewPreserved: true;
  detailedOnlyPreserved: true;
  parentExcluded: true;
  provenanceVerified: true;
};

export type IehpDocumentFieldAssertion = {
  fieldKey: string;
  rowCount: number;
  valueMatched: true;
  provenanceRowCount: number;
  documentProvenanceVerified: true;
};

export const IEHP_PDF_MINI_MATRIX_CASES: readonly IehpPdfMiniMatrixCase[] = [
  {
    id: 'clean-single-page',
    referralDate: '06/30/2026',
    documentPhone: '(909) 555-0101',
    pageBreakBeforeTarget: false,
    renderMode: 'digital-pdf',
  },
  {
    id: 'multi-page-target-content',
    referralDate: '07/01/2026',
    documentPhone: '909-555-0102',
    pageBreakBeforeTarget: true,
    renderMode: 'digital-pdf',
  },
  {
    id: 'alternate-document-phone-format',
    referralDate: '07/02/2026',
    documentPhone: '+1 909 555 0103',
    pageBreakBeforeTarget: false,
    renderMode: 'digital-pdf',
  },
  {
    id: 'scan-300dpi-monochrome',
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
  },
  {
    id: 'scan-300dpi-monochrome-rotated-2deg',
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
  },
] as const;

export const IEHP_SKILLS_BEHAVIORS_PROOF_CASE: IehpSkillsBehaviorsProofCase = {
  id: 'skills-behaviors-proof',
  expectedSectionKey: 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS',
  expectedVersion: 1,
  expectedTargets: ['Physical Aggression', 'Functional Communication', 'Community Safety'],
  expectedCounts: {
    total: 4,
    behavior: 1,
    skill: 2,
    summary_only: 1,
    detailed_only: 1,
    ambiguous: 0,
  },
  expectedStatuses: {
    behaviorMatched: 'matched',
    skillMatched: 'matched',
    needsReview: 'summary_only',
    detailedOnly: 'detailed_only',
  },
  expectedItems: {
    behavior: 'Physical Aggression',
    skill: 'Functional Communication',
    needsReview: 'Community Safety',
    detailedOnly: 'Waiting',
    excludedParent: 'Parent Coaching',
  },
};

type ResolveIehpSmokeSampleFileArgs = {
  cwd: string;
  env?: Pick<NodeJS.ProcessEnv, 'PW_ASSESSMENT_SAMPLE_FILE'>;
  candidateFileNames?: string[];
};

const isRootIehpFbaSample = (fileName: string): boolean => {
  const lowerName = fileName.toLowerCase();
  return (
    lowerName.endsWith('.docx') &&
    lowerName.includes('iehp') &&
    lowerName.includes('fba') &&
    ['redacted', 'synthetic', 'smoke', 'test'].some((marker) => lowerName.includes(marker)) &&
    !lowerName.startsWith('updated fba')
  );
};

export const resolveIehpSmokeSampleFile = ({
  cwd,
  env = process.env,
  candidateFileNames,
}: ResolveIehpSmokeSampleFileArgs): string => {
  const configuredSampleFile = env.PW_ASSESSMENT_SAMPLE_FILE?.trim();
  if (configuredSampleFile) {
    return path.resolve(cwd, configuredSampleFile);
  }

  const rootFileNames =
    candidateFileNames ??
    readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  const matches = rootFileNames.filter(isRootIehpFbaSample);

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one safe root IEHP FBA DOCX sample when PW_ASSESSMENT_SAMPLE_FILE is not set; found ${matches.length}. Set PW_ASSESSMENT_SAMPLE_FILE for an explicit smoke fixture.`,
    );
  }

  return path.resolve(cwd, matches[0]);
};

export const buildIehpSmokeUploadFileName = (
  timestamp = Date.now(),
  extension: 'docx' | 'pdf' = 'docx',
): string => `iehp-fba-smoke-${timestamp}.${extension}`;

export const canonicalizeUsPhoneForComparison = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
};

export const buildIehpPdfMiniMatrixHtml = (caseDefinition: IehpPdfMiniMatrixCase): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${caseDefinition.id}</title>
  </head>
  <body>
    <section>
      ${caseDefinition.pageBreakBeforeTarget ? '<p>IEHP FBA PDF mini-matrix page one</p><div style="page-break-before: always;"></div>' : ''}
      <p>Referral Date: ${caseDefinition.referralDate}</p>
      <p>Assessor's phone number: ${caseDefinition.documentPhone}</p>
    </section>
  </body>
</html>`;

export const buildIehpSkillsBehaviorsProofPdfHtml = (
  proofCase: IehpSkillsBehaviorsProofCase,
): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${proofCase.id}</title>
  </head>
  <body>
    <section>
      <h1>BEHAVIORS:</h1>
      <p>The behaviors and functional skills to be addressed are:</p>
      <p>${proofCase.expectedTargets.join('; ')}</p>
      <h2>BACKGROUND INFORMATION</h2>
    </section>
    <section style="page-break-before: always;">
      <h2>TARGET BEHAVIORS:</h2>
      <p>Program Name: ${proofCase.expectedItems.behavior}</p>
      <p>Instrumental Goal: Member will reduce physical aggression during transitions.</p>
      <p>Data Collection: Rate per hour.</p>
      <p>Mastery Criteria: Zero instances across four consecutive weeks.</p>
      <p>Baseline: Three instances per hour.</p>
      <h2>REPLACEMENT BEHAVIORS:</h2>
      <p>Program Name: ${proofCase.expectedItems.skill}</p>
      <p>Instrumental Goal: Member will request help using functional communication.</p>
      <p>Data Collection: Percentage of opportunities.</p>
      <p>Mastery Criteria: Eighty percent across four consecutive weeks.</p>
      <p>Baseline: Zero percent independent.</p>
      <p>Program Name: ${proofCase.expectedItems.detailedOnly}</p>
      <p>Instrumental Goal: Member will wait safely before crossing in the community.</p>
      <p>Data Collection: Percentage of opportunities.</p>
      <p>Mastery Criteria: Eighty percent across four consecutive weeks.</p>
      <p>Baseline: Zero percent independent.</p>
      <h2>Safety/Crisis Procedure</h2>
    </section>
    <section style="page-break-before: always;">
      <h2>PARENT EDUCATION:</h2>
      <p>Program Name: ${proofCase.expectedItems.excludedParent}</p>
      <p>Instrumental Goal: Caregiver will carry out the synthetic home plan with fidelity.</p>
      <p>Data Collection: Percentage of opportunities.</p>
      <p>Mastery Criteria: Eighty percent across four consecutive weeks.</p>
      <p>Baseline: Zero percent independent.</p>
      <h2>Location of Service:</h2>
      <p>Synthetic test setting.</p>
    </section>
  </body>
</html>`;

export const assertIehpDocumentChecklistField = (args: {
  checklist: DocumentChecklistResponse;
  expectedValue: string;
  fieldKey: string;
  provenanceRows?: AssessmentExtractionProvenanceRow[];
}): IehpDocumentFieldAssertion => {
  const matchingRows = args.checklist.items.filter((item) => item.placeholder_key === args.fieldKey);
  if (matchingRows.length === 0) {
    throw new Error(`IEHP smoke could not find ${args.fieldKey} in assessment checklist.`);
  }
  if (matchingRows.length !== 1) {
    throw new Error(`IEHP smoke expected exactly one ${args.fieldKey} row but found ${matchingRows.length}.`);
  }

  const valueText = matchingRows[0]?.value_text?.trim() ?? '';
  if (!valueText) {
    throw new Error(`IEHP smoke found ${args.fieldKey} but its value was empty.`);
  }
  if (valueText !== args.expectedValue) {
    throw new Error(`IEHP smoke expected ${args.fieldKey} to match the expected document value exactly.`);
  }

  const provenanceRows = (args.provenanceRows ?? []).filter((row) => row.field_key === args.fieldKey);
  if (provenanceRows.length === 0) {
    throw new Error(`IEHP smoke could not find ${args.fieldKey} extraction provenance.`);
  }
  if (provenanceRows.length !== 1) {
    throw new Error(
      `IEHP smoke expected exactly one ${args.fieldKey} extraction provenance row but found ${provenanceRows.length}.`,
    );
  }

  const sourceSpan = provenanceRows[0]?.source_span;
  const sourceMethod = sourceSpan && typeof sourceSpan === 'object' && 'method' in sourceSpan
    ? (sourceSpan as { method?: unknown }).method
    : undefined;
  if (!sourceMethod) {
    throw new Error(
      `IEHP smoke expected ${args.fieldKey} provenance to expose exactly one non-client_snapshot source span.`,
    );
  }
  if (sourceMethod === 'client_snapshot') {
    throw new Error(
      `IEHP smoke expected ${args.fieldKey} provenance to come from document extraction, not client_snapshot.`,
    );
  }

  return {
    fieldKey: args.fieldKey,
    rowCount: matchingRows.length,
    valueMatched: true,
    provenanceRowCount: provenanceRows.length,
    documentProvenanceVerified: true,
  };
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasValidSkillsBehaviorsClinicalGoalType = (value: unknown): value is SkillsBehaviorsClinicalGoalType =>
  value === 'behavior' || value === 'skill' || value === null;

const hasValidSkillsBehaviorsReconciliationStatus = (value: unknown): value is SkillsBehaviorsReconciliationStatus =>
  value === 'matched' || value === 'summary_only' || value === 'detailed_only' || value === 'ambiguous';

const hasValidSkillsBehaviorsStatusTypePairing = (
  clinicalGoalType: SkillsBehaviorsClinicalGoalType,
  reconciliationStatus: SkillsBehaviorsReconciliationStatus,
): boolean =>
  (reconciliationStatus === 'matched' || reconciliationStatus === 'detailed_only')
    ? clinicalGoalType === 'behavior' || clinicalGoalType === 'skill'
    : clinicalGoalType === null;

const sameGoalRef = (value: unknown, fieldKey: string, sectionIndex: number): boolean =>
  isObjectRecord(value) &&
  value.field_key === fieldKey &&
  value.section_index === sectionIndex;

export const assertIehpSkillsBehaviorsChecklistSection = (args: {
  checklist: DocumentChecklistResponse;
  proofCase?: IehpSkillsBehaviorsProofCase;
}): IehpSkillsBehaviorsAssertion => {
  const proofCase = args.proofCase ?? IEHP_SKILLS_BEHAVIORS_PROOF_CASE;
  const sections = Array.isArray(args.checklist.structured_sections) ? args.checklist.structured_sections : [];
  const matchingRows = sections.filter((section) =>
    isObjectRecord(section) && section.field_key === proofCase.expectedSectionKey
  ) as SkillsBehaviorsChecklistStructuredSection[];

  if (matchingRows.length === 0) {
    throw new Error(`IEHP smoke could not find ${proofCase.expectedSectionKey} in structured sections.`);
  }
  if (matchingRows.length !== 1) {
    throw new Error(
      `IEHP smoke expected exactly one ${proofCase.expectedSectionKey} structured section row but found ${matchingRows.length}.`,
    );
  }

  const payload = matchingRows[0]?.payload;
  if (!isObjectRecord(payload) || !Array.isArray(payload.targets)) {
    throw new Error(`IEHP smoke found ${proofCase.expectedSectionKey} but payload.targets was missing or malformed.`);
  }
  const targets = payload.targets.filter((target): target is string => typeof target === 'string');
  if (
    targets.length !== proofCase.expectedTargets.length ||
    targets.some((target, index) => target !== proofCase.expectedTargets[index])
  ) {
    throw new Error(`IEHP smoke expected ${proofCase.expectedSectionKey} payload.targets to preserve the synthetic summary list exactly.`);
  }

  const skillsBehaviors = payload.skills_behaviors;
  if (!isObjectRecord(skillsBehaviors) || !Array.isArray(skillsBehaviors.items) || !isObjectRecord(skillsBehaviors.counts)) {
    throw new Error(`IEHP smoke found ${proofCase.expectedSectionKey} but payload.skills_behaviors was missing or malformed.`);
  }
  if (skillsBehaviors.version !== proofCase.expectedVersion) {
    throw new Error(
      `IEHP smoke expected ${proofCase.expectedSectionKey} skills_behaviors.version to equal ${proofCase.expectedVersion}.`,
    );
  }

  const rawItems = skillsBehaviors.items as unknown[];
  if (rawItems.some((item) => !isObjectRecord(item))) {
    throw new Error(
      `IEHP smoke found ${proofCase.expectedSectionKey} but payload.skills_behaviors.items contained a malformed entry.`,
    );
  }

  const items = rawItems as SkillsBehaviorsItem[];
  if (items.some((item) => !hasValidSkillsBehaviorsClinicalGoalType(item.clinical_goal_type))) {
    throw new Error(
      `IEHP smoke found ${proofCase.expectedSectionKey} but payload.skills_behaviors.items contained an invalid clinical_goal_type.`,
    );
  }
  if (
    items.some((item) =>
      !hasValidSkillsBehaviorsReconciliationStatus(item.reconciliation_status) ||
      !hasValidSkillsBehaviorsStatusTypePairing(item.clinical_goal_type, item.reconciliation_status)
    )
  ) {
    throw new Error(
      `IEHP smoke found ${proofCase.expectedSectionKey} but payload.skills_behaviors.items contained an invalid reconciliation_status for its clinical_goal_type.`,
    );
  }

  const findByName = (name: string): SkillsBehaviorsItem | undefined =>
    items.find((item) => item.name === name);

  if (findByName(proofCase.expectedItems.excludedParent)) {
    throw new Error('IEHP smoke expected the parent education goal to stay excluded from skills_behaviors items.');
  }

  const itemsMissingRefs = items.some((item) =>
    (item.reconciliation_status === 'matched' || item.reconciliation_status === 'detailed_only') &&
    (!Array.isArray(item.matched_goal_refs) || item.matched_goal_refs.length === 0)
  );
  if (itemsMissingRefs) {
    throw new Error(
      'IEHP smoke expected every matched or detailed-only skills_behaviors item to expose provenance refs.',
    );
  }

  const counts = skillsBehaviors.counts as SkillsBehaviorsCounts;
  const expectedCounts = proofCase.expectedCounts;
  if (
    counts.total !== expectedCounts.total ||
    counts.behavior !== expectedCounts.behavior ||
    counts.skill !== expectedCounts.skill ||
    counts.summary_only !== expectedCounts.summary_only ||
    counts.detailed_only !== expectedCounts.detailed_only ||
    counts.ambiguous !== expectedCounts.ambiguous
  ) {
    throw new Error(
      `IEHP smoke expected ${proofCase.expectedSectionKey} counts to match the synthetic proof contract exactly.`,
    );
  }

  if (items.length !== expectedCounts.total) {
    throw new Error(
      `IEHP smoke expected ${proofCase.expectedSectionKey} to contain exactly ${expectedCounts.total} skills_behaviors items but found ${items.length}.`,
    );
  }

  const behaviorItem = findByName(proofCase.expectedItems.behavior);
  if (
    !behaviorItem ||
    behaviorItem.clinical_goal_type !== 'behavior' ||
    behaviorItem.reconciliation_status !== proofCase.expectedStatuses.behaviorMatched ||
    !Array.isArray(behaviorItem.matched_goal_refs) ||
    !behaviorItem.matched_goal_refs.some((ref) =>
      sameGoalRef(ref, 'IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS', 0)
    )
  ) {
    throw new Error(
      `IEHP smoke expected ${proofCase.expectedItems.behavior} to remain a matched behavior with deterministic provenance refs.`,
    );
  }

  const skillItem = findByName(proofCase.expectedItems.skill);
  if (
    !skillItem ||
    skillItem.clinical_goal_type !== 'skill' ||
    skillItem.reconciliation_status !== proofCase.expectedStatuses.skillMatched ||
    !Array.isArray(skillItem.matched_goal_refs) ||
    !skillItem.matched_goal_refs.some((ref) =>
      sameGoalRef(ref, 'IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS', 0)
    )
  ) {
    throw new Error(
      `IEHP smoke expected ${proofCase.expectedItems.skill} to remain a matched skill with deterministic provenance refs.`,
    );
  }

  const needsReviewItem = findByName(proofCase.expectedItems.needsReview);
  if (
    !needsReviewItem ||
    needsReviewItem.clinical_goal_type !== null ||
    needsReviewItem.reconciliation_status !== proofCase.expectedStatuses.needsReview ||
    !Array.isArray(needsReviewItem.matched_goal_refs) ||
    needsReviewItem.matched_goal_refs.length !== 0
  ) {
    throw new Error(
      `IEHP smoke expected ${proofCase.expectedItems.needsReview} to stay a summary-only Needs Review item with no matched refs.`,
    );
  }

  const detailedOnlyItem = findByName(proofCase.expectedItems.detailedOnly);
  if (
    !detailedOnlyItem ||
    detailedOnlyItem.clinical_goal_type !== 'skill' ||
    detailedOnlyItem.reconciliation_status !== proofCase.expectedStatuses.detailedOnly ||
    !Array.isArray(detailedOnlyItem.matched_goal_refs) ||
    !detailedOnlyItem.matched_goal_refs.some((ref) =>
      sameGoalRef(ref, 'IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS', 1)
    )
  ) {
    throw new Error(
      `IEHP smoke expected ${proofCase.expectedItems.detailedOnly} to remain a detailed-only classified child item.`,
    );
  }

  return {
    rowCount: 1,
    version: 1,
    totalCountMatched: true,
    behaviorParsed: true,
    skillParsed: true,
    needsReviewPreserved: true,
    detailedOnlyPreserved: true,
    parentExcluded: true,
    provenanceVerified: true,
  };
};

export const buildIehpSmokeCleanupFailureManifestPayload = (args: {
  cleanupError: Error;
  cleanupTargetKnown: boolean;
  createdAt?: string;
  runError?: Error | null;
}): {
  createdAt: string;
  cleanupTargetKnown: boolean;
  cleanupError: string;
  runError: string | null;
} => ({
  createdAt: args.createdAt ?? new Date().toISOString(),
  cleanupTargetKnown: args.cleanupTargetKnown,
  cleanupError: 'Cleanup failed; inspect local terminal context or hosted smoke records for manual cleanup.',
  runError: args.runError ? 'IEHP smoke run failed before cleanup completed.' : null,
});

export const buildIehpSmokeCleanupFailureMessage = (args: {
  cleanupFailed: boolean;
  cleanupManifestPath?: string | null;
  cleanupManifestWriteFailed?: boolean;
  runFailed: boolean;
}): string => {
  const base = args.runFailed
    ? 'IEHP assessment import smoke failed and cleanup did not complete.'
    : 'IEHP assessment import smoke cleanup did not complete.';
  const manifest = args.cleanupManifestPath ? ` Cleanup manifest: ${args.cleanupManifestPath}.` : '';
  const manifestWrite = args.cleanupManifestWriteFailed ? ' Cleanup manifest write failed.' : '';
  const cleanup = args.cleanupFailed ? ' Manual cleanup may be required.' : '';
  return `${base}${cleanup}${manifest}${manifestWrite}`;
};
