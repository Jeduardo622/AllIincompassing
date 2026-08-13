import { readdirSync } from 'node:fs';
import path from 'node:path';

type IehpPdfMiniMatrixBaseCase = {
  referralDate: string;
  documentPhone: string;
  pageBreakBeforeTarget: boolean;
};

type IehpDigitalPdfMiniMatrixCase = IehpPdfMiniMatrixBaseCase & {
  id:
    | 'clean-single-page'
    | 'multi-page-target-content'
    | 'alternate-document-phone-format'
    | 'table-structured-fields';
  renderMode: 'digital-pdf';
  documentLayout: 'plain' | 'table';
};

type IehpRasterPdfMiniMatrixCase = IehpPdfMiniMatrixBaseCase & {
  id:
    | 'scan-300dpi-monochrome'
    | 'scan-300dpi-monochrome-rotated-2deg'
    | 'scan-150dpi-grayscale-low-quality';
  renderMode: 'raster-scan';
  scan: {
    dpi: 150 | 300;
    colorMode: 'black-and-white' | 'grayscale';
    rotationDegrees: 0 | 2;
    compression: 'jpeg';
    jpegQuality: 45 | 85;
  };
};

export type IehpPdfMiniMatrixCase = IehpDigitalPdfMiniMatrixCase | IehpRasterPdfMiniMatrixCase;

type DocumentChecklistItem = {
  id?: string;
  label?: string | null;
  placeholder_key: string;
  required?: boolean;
  status?: string;
  value_text?: string | null;
  value_json?: unknown;
};

type DocumentChecklistStructuredSection = {
  id?: string;
  field_key?: string;
  section_key?: string;
  section_index?: number;
  payload?: unknown;
  required?: boolean;
  status?: string;
};

type DocumentChecklistResponse = {
  items: DocumentChecklistItem[];
  structured_sections?: DocumentChecklistStructuredSection[] | unknown[];
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

type IehpPreflightBlocker = {
  code?: unknown;
};

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

export type IehpGeneratedDocxParityManifest = {
  sectionCount: 1;
  version: 1;
  names: string[];
  totalNames: number;
  behaviorCount: number;
  skillCount: number;
  matchedCount: number;
  detailedOnlyCount: number;
  summaryOnlyOrAmbiguousCount: number;
};

export type IehpRedactedPreflightBlockerEvidence = {
  ready: boolean;
  blockerCount: number;
  blockerCodes: string[];
  hasUnapprovedRequiredBlocker: boolean;
};

type IehpChecklistApprovalPatch = {
  item_id: string;
  status: 'approved';
  review_notes: string;
  value_text?: string;
  value_json?: unknown;
};

type IehpStructuredSectionApprovalPatch = {
  structured_section_id: string;
  status: 'approved';
  review_notes: string;
};

export type IehpRequiredFinalOutputApprovals = {
  checklistApprovals: IehpChecklistApprovalPatch[];
  structuredSectionApprovals: IehpStructuredSectionApprovalPatch[];
  summary: {
    checklistCount: number;
    structuredCount: number;
    allRequiredRowsApproved: boolean;
  };
};

export type IehpGeneratedDocxParityProofCase = {
  id: 'generated-docx-parity';
  expectedSectionHeadings: readonly string[];
  expectedBehaviorSkillTerms: readonly [string, string, string, string];
  expectedNarrativeTerms: readonly string[];
};

export type IehpGeneratedDocxParityAssertion = {
  expectedNameCount: number;
  matchedNameCount: number;
  expectedSectionHeadingCount: number;
  matchedSectionHeadingCount: number;
  expectedNarrativeTermCount: number;
  matchedNarrativeTermCount: number;
  allExpectedContentPresent: true;
};

export const IEHP_PDF_MINI_MATRIX_CASES: readonly IehpPdfMiniMatrixCase[] = [
  {
    id: 'clean-single-page',
    referralDate: '06/30/2026',
    documentPhone: '(909) 555-0101',
    pageBreakBeforeTarget: false,
    renderMode: 'digital-pdf',
    documentLayout: 'plain',
  },
  {
    id: 'multi-page-target-content',
    referralDate: '07/01/2026',
    documentPhone: '909-555-0102',
    pageBreakBeforeTarget: true,
    renderMode: 'digital-pdf',
    documentLayout: 'plain',
  },
  {
    id: 'alternate-document-phone-format',
    referralDate: '07/02/2026',
    documentPhone: '+1 909 555 0103',
    pageBreakBeforeTarget: false,
    renderMode: 'digital-pdf',
    documentLayout: 'plain',
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
  {
    id: 'scan-150dpi-grayscale-low-quality',
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
  },
  {
    id: 'table-structured-fields',
    referralDate: '07/06/2026',
    documentPhone: '909-555-0107',
    pageBreakBeforeTarget: false,
    renderMode: 'digital-pdf',
    documentLayout: 'table',
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

export const IEHP_GENERATED_DOCX_PARITY_PROOF_CASE: IehpGeneratedDocxParityProofCase = {
  id: 'generated-docx-parity',
  expectedSectionHeadings: [
    'Functional Behavioral Assessment Report',
    'Referral Date:',
    'Assessor/Certification:',
    'BEHAVIORS:',
    'BACKGROUND INFORMATION:',
    'BHT (School Hours)',
    'Health and Medical -',
    'Current Services and Activities-',
    'Intervention History -',
    'BHT Availability',
    "MEMBER'S ENVIRONMENTAL ANALYSIS:",
    'DESCRIPTION OF ASSESSMENT PROCEDURES:',
    'Preference Assessment- Within this section the assessor will state the preference assessment administered to the Member during the assessment.',
    'Preference Areas:',
    'ASSESSMENT MEAURES:',
    'Target Behaviors',
    'Replacement Behavior(s):',
    'Safety Procedure/Crisis Plan-',
    'Parent Education:',
    'Coordination of Care:',
    'Discharge, Transition and Exit Plans:',
    'Transition Planning:',
    'Teaching Intervention Strategies - Within this section list all teaching procedures and methodologies used to the teach skill deficits and replacement behaviors. Include strategies on generalization, maintenance, thinning schedules of reinforcement, transition to natural mediators, and relapse prevention.',
    "Family Involvement: Within this section of the report provider will outline parent involvement and participation within the therapy session. Provider will include a statement on the expected level of participation as outlined within the BHT IEHP Policy. Provider will outline the parent training and education approach for teaching the parent goals. Providers will include a plan on how the provider will address parental involvement within therapy sessions. Parent education goals will be listed below. Parent Participation is not an educational goal; it is an expectation. A Parent should have AT LEAST 2 Parent Education Goals.",
    'Clinical Recommendations',
    'Report completed by: The Health plan requires the treatment plan to be developed by a BCBA per APL 23-010',
  ],
  expectedBehaviorSkillTerms: [
    'Functional Communication',
    'Community Safety',
    'Transition Tolerance',
    'Waiting',
  ],
  expectedNarrativeTerms: [
    'Records reviewed included synthetic diagnostic',
    'visual schedule, transition warnings',
    'caregivers will secure the environment',
    'Home, school, and community',
    'Caregiver will implement prompting and reinforcement strategies',
  ],
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
    <style>
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #111; padding: 8px; text-align: left; }
    </style>
  </head>
  <body>
    <section>
      ${caseDefinition.pageBreakBeforeTarget ? '<p>IEHP FBA PDF mini-matrix page one</p><div style="page-break-before: always;"></div>' : ''}
      ${caseDefinition.renderMode === 'digital-pdf' && caseDefinition.documentLayout === 'table'
        ? `<table>
      <tbody>
        <tr>
          <th scope="row">Referral Date:</th>
          <td>${caseDefinition.referralDate}</td>
        </tr>
        <tr>
          <th scope="row">Assessor's phone number:</th>
          <td>${caseDefinition.documentPhone}</td>
        </tr>
      </tbody>
    </table>`
        : `<p>Referral Date: ${caseDefinition.referralDate}</p>
      <p>Assessor's phone number: ${caseDefinition.documentPhone}</p>`}
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

export const buildIehpGeneratedDocxParityPdfHtml = (
  proofCase: IehpGeneratedDocxParityProofCase = IEHP_GENERATED_DOCX_PARITY_PROOF_CASE,
): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${proofCase.id}</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        color: #111;
        margin: 32px;
        line-height: 1.35;
        font-size: 12px;
      }
      h1, h2, h3 {
        margin: 18px 0 8px;
      }
      p {
        margin: 0 0 6px;
      }
    </style>
  </head>
  <body>
    <h1>Inland Empire Health Plan Functional Behavioral Assessment Report</h1>
    <p>Header: synthetic IEHP generated DOCX parity fixture.</p>
    <h2>I. IDENTIFICATION</h2>
    <p>First Name: Synthetic</p>
    <p>Last Name: Member</p>
    <p>Birth Date: 01/01/2018</p>
    <p>Report Date: 08/12/2026</p>
    <p>Referral Date: 08/01/2026</p>
    <p>IEHP Member ID#: SYNTH-0001</p>
    <p>Present Address: 100 Synthetic Way, Test City, CA 90000</p>
    <p>Parent/Guardian: Synthetic Caregiver</p>
    <p>Phone: (909) 555-0199</p>
    <p>Language: English</p>
    <p>Assessor/Certification: Synthetic BCBA, BCBA 1-00-00000</p>
    <p>Assessor's phone number: (909) 555-0188</p>
    <p>Reason for Referral: Synthetic caregiver request for ABA treatment focused on communication, safety, and transitions.</p>
    <h2>II. BEHAVIORS</h2>
    <p>The behaviors and functional skills to be addressed are:</p>
    <p>${proofCase.expectedBehaviorSkillTerms.join('; ')}</p>
    <h2>III. BACKGROUND INFORMATION</h2>
    <p>Persons in Household and Relationship to IEHP Member</p>
    <p>Member lives with two caregivers and one sibling in a synthetic household.</p>
    <p>School Information</p>
    <p>Member attends a synthetic public school classroom with speech and behavior support.</p>
    <h2>IV. BHT SCHOOL HOURS</h2>
    <p>Monday through Friday: 8:00 AM to 3:00 PM.</p>
    <h2>HEALTH AND MEDICAL</h2>
    <p>Medical summary narrative for synthetic QA fixture. No acute medical concerns were documented.</p>
    <h2>CURRENT SERVICES AND ACTIVITIES</h2>
    <p>School-based services, caregiver coaching, and recreational community routines were reviewed.</p>
    <h2>INTERVENTION HISTORY</h2>
    <p>Prior ABA ended last year and resumed in a synthetic continuity-of-care scenario.</p>
    <h2>V. BHT AVAILABILITY</h2>
    <p>After-school weekday availability and weekend daytime availability were documented.</p>
    <h2>VI. MEMBER'S ENVIRONMENTAL ANALYSIS:</h2>
    <p>Availability and access to reinforcers: Yes. Level of noise/environmental distractions: Fair.</p>
    <h2>VII. DESCRIPTION OF ASSESSMENT PROCEDURES:</h2>
    <p>Records Reviewed: 08/01/2026 Telehealth BCBA</p>
    <p>Clinical Interview: 08/02/2026 Home BCBA</p>
    <p>1st Member Observation: 08/03/2026 home observation narrative.</p>
    <p>2nd Member Observation: 08/04/2026 school observation narrative.</p>
    <p>Records reviewed included synthetic diagnostic, school, and service coordination documents.</p>
    <h2>PREFERENCE ASSESSMENT</h2>
    <p>Caregiver reported interests and reinforcers including praise, sensory tools, breaks, and music.</p>
    <p>Preference Areas: Potential Reinforcers:</p>
    <p>Social: praise and shared activities.</p>
    <p>Sensory: fidgets and music.</p>
    <h2>VIII. ADAPTIVE AND FUNCTIONAL MEASURE SUMMARIES</h2>
    <p>VB-MAPP Assessment Summary: Preserve as assessment block.</p>
    <p>Vineland Adaptive Behavior Scales, 3rd Edition Date Administered: 08/01/2026 Name of Interviewer: Synthetic BCBA Name of Respondent: Synthetic Caregiver Assessment Summary: Synthetic adaptive summary.</p>
    <p>AFLS Assessment Summary: Preserve as assessment block.</p>
    <p>ABAS-3 Assessment Summary: Preserve as assessment block.</p>
    <h2>IX. TARGET BEHAVIORS</h2>
    <h3>TARGET BEHAVIORS:</h3>
    <p>Program Name: Transition Tolerance</p>
    <p>Instrumental Goal: Member will transition between tasks without aggression across home and school routines.</p>
    <p>Data Collection: Frequency</p>
    <p>Mastery Criteria: Zero events across four consecutive weeks.</p>
    <p>Baseline: Three events per hour.</p>
    <h3>REPLACEMENT BEHAVIORS:</h3>
    <p>Program Name: Functional Communication</p>
    <p>Instrumental Goal: Member will request help across five targets in home and school contexts.</p>
    <p>Data Collection: Percent opportunities</p>
    <p>Mastery Criteria: Eighty percent across four consecutive weeks.</p>
    <p>Baseline: Zero percent independent.</p>
    <p>Program Name: Waiting</p>
    <p>Instrumental Goal: Member will wait safely before accessing preferred activities in the community.</p>
    <p>Data Collection: Percent opportunities</p>
    <p>Mastery Criteria: Eighty percent across four consecutive weeks.</p>
    <p>Baseline: Zero percent independent.</p>
    <p>Program Name: Community Safety</p>
    <p>Instrumental Goal: Member will remain with caregiver and stop at safety cues across public settings.</p>
    <p>Data Collection: Percent opportunities</p>
    <p>Mastery Criteria: Eighty percent across four consecutive weeks.</p>
    <p>Baseline: Twenty percent independent.</p>
    <h2>X. BEHAVIOR INTERVENTION PLAN</h2>
    <p>Antecedent Strategies: visual schedule, transition warnings, and first-then supports.</p>
    <p>Replacement Behavior: request break and request help.</p>
    <p>Consequence Strategies: differential reinforcement and planned response blocking for safety.</p>
    <h2>SAFETY/CRISIS PROCEDURE</h2>
    <p>Safety Procedure: caregivers will secure the environment, follow the synthetic crisis response, and contact emergency services for immediate danger.</p>
    <h2>XI. PARENT EDUCATION</h2>
    <p>Program Name: Parent Coaching</p>
    <p>Instrumental Goal: Caregiver will implement prompting and reinforcement strategies with fidelity.</p>
    <p>Data Collection: Percent opportunities</p>
    <p>Mastery Criteria: Ninety percent across four consecutive weeks.</p>
    <p>Baseline: Zero percent independent.</p>
    <h2>XII. LOCATION OF SERVICE</h2>
    <p>Home, school, and community.</p>
    <h2>COORDINATION OF CARE:</h2>
    <p>Coordinate with parent, school, PCP, and current service providers.</p>
    <h2>XIII. DISCHARGE CRITERIA:</h2>
    <p>Exit plan criteria placeholder covering sustained performance and caregiver implementation.</p>
    <h2>TRANSITION OF CARE:</h2>
    <p>Transition planning includes fading service intensity, handoff to natural supports, and school coordination.</p>
    <h2>TEACHING INTERVENTION STRATEGIES</h2>
    <p>Modeling, least-to-most prompting, visual supports, and reinforcement thinning were documented.</p>
    <h2>FAMILY INVOLVEMENT</h2>
    <p>Caregiver participation, consent, and agreement with the synthetic treatment plan were documented.</p>
    <h2>XIV. RECOMMENDATIONS:</h2>
    <p>H2019 Therapeutic Behavioral Services, per 15 minutes 10 units</p>
    <p>H0032 Mental Health Service Plan Development by Non-Physician, per 15 minutes 4 units</p>
    <p>Recommendation notes: synthetic HCPCS recommendation summary.</p>
    <h2>REPORT COMPLETED BY:</h2>
    <p>Synthetic BCBA MM/DD/YYYY</p>
    <p>Signature placeholder: synthetic parity fixture only.</p>
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

const IEHP_OPTIONAL_FINAL_OUTPUT_KEYS = new Set([
  'IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES',
  'IEHP_FBA_ASSESSOR_PHONE',
  'IEHP_FBA_REFERRING_PROVIDER',
]);

const NON_MEANINGFUL_METADATA_KEYS = new Set([
  'id',
  'created_at',
  'updated_at',
  'section_key',
  'section_index',
  'field_key',
  'page_number',
  'field_type',
  'mode',
  'label',
  'status',
  'required',
  'source',
  'layout_json',
  'template_placeholder',
  'entered_value_present',
  'options',
]);

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 && normalized.toLowerCase() !== 'unknown';
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry));
  if (isObjectRecord(value)) {
    return Object.entries(value).some(([key, entry]) =>
      !NON_MEANINGFUL_METADATA_KEYS.has(key) && hasMeaningfulValue(entry)
    );
  }
  return false;
};

const isRequiredForIehpFinalOutput = (fieldKey: string | undefined, required: boolean | undefined): boolean =>
  Boolean(required) && typeof fieldKey === 'string' && !IEHP_OPTIONAL_FINAL_OUTPUT_KEYS.has(fieldKey);

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

export const buildRedactedIehpPreflightBlockerEvidence = (args: {
  ready: boolean;
  blockers: IehpPreflightBlocker[];
}): IehpRedactedPreflightBlockerEvidence => {
  const blockerCodes: string[] = [];
  for (const blocker of args.blockers) {
    const code = typeof blocker?.code === 'string' && blocker.code.trim() ? blocker.code.trim() : 'unknown_blocker';
    if (!blockerCodes.includes(code)) {
      blockerCodes.push(code);
    }
  }

  return {
    ready: args.ready,
    blockerCount: args.blockers.length,
    blockerCodes,
    hasUnapprovedRequiredBlocker: blockerCodes.some((code) => /(required|unapproved)/i.test(code)),
  };
};

export const deriveIehpGeneratedDocxParityManifest = (args: {
  checklist: DocumentChecklistResponse;
}): IehpGeneratedDocxParityManifest => {
  const sections = Array.isArray(args.checklist.structured_sections) ? args.checklist.structured_sections : [];
  const matchingRows = sections.filter((section) =>
    isObjectRecord(section) && section.field_key === 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS'
  );

  if (matchingRows.length === 0) {
    throw new Error('IEHP smoke could not find IEHP_FBA_BEHAVIOR_SKILL_TARGETS in structured sections.');
  }
  if (matchingRows.length !== 1) {
    throw new Error(
      `IEHP smoke expected exactly one IEHP_FBA_BEHAVIOR_SKILL_TARGETS structured section row but found ${matchingRows.length}.`,
    );
  }

  const payload = matchingRows[0]?.payload;
  const skillsBehaviors = isObjectRecord(payload) ? payload.skills_behaviors : null;
  if (!isObjectRecord(skillsBehaviors) || !Array.isArray(skillsBehaviors.items)) {
    throw new Error('IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors was missing or malformed.');
  }
  if (skillsBehaviors.version !== 1) {
    throw new Error('IEHP smoke expected IEHP_FBA_BEHAVIOR_SKILL_TARGETS skills_behaviors.version to equal 1.');
  }

  let behaviorCount = 0;
  let skillCount = 0;
  let matchedCount = 0;
  let detailedOnlyCount = 0;
  let summaryOnlyOrAmbiguousCount = 0;
  const names: string[] = [];

  for (const item of skillsBehaviors.items) {
    if (!isObjectRecord(item)) {
      throw new Error(
        'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors.items contained a malformed entry.',
      );
    }
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      throw new Error(
        'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors.items contained a blank name.',
      );
    }
    const clinicalGoalType = item.clinical_goal_type;
    const reconciliationStatus = item.reconciliation_status;
    if (!hasValidSkillsBehaviorsClinicalGoalType(clinicalGoalType)) {
      throw new Error(
        'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors.items contained an invalid clinical_goal_type.',
      );
    }
    if (
      !hasValidSkillsBehaviorsReconciliationStatus(reconciliationStatus) ||
      !hasValidSkillsBehaviorsStatusTypePairing(clinicalGoalType, reconciliationStatus)
    ) {
      throw new Error(
        'IEHP smoke found IEHP_FBA_BEHAVIOR_SKILL_TARGETS but payload.skills_behaviors.items contained an invalid reconciliation_status for its clinical_goal_type.',
      );
    }

    names.push(name);
    if (clinicalGoalType === 'behavior') behaviorCount += 1;
    if (clinicalGoalType === 'skill') skillCount += 1;
    if (reconciliationStatus === 'matched') matchedCount += 1;
    if (reconciliationStatus === 'detailed_only') detailedOnlyCount += 1;
    if (reconciliationStatus === 'summary_only' || reconciliationStatus === 'ambiguous') {
      summaryOnlyOrAmbiguousCount += 1;
    }
  }

  if (behaviorCount === 0 || skillCount === 0) {
    throw new Error('IEHP smoke expected at least one behavior and one skill in IEHP_FBA_BEHAVIOR_SKILL_TARGETS.');
  }
  if (summaryOnlyOrAmbiguousCount > 0) {
    throw new Error(
      'IEHP generated DOCX parity refuses to auto-approve summary-only or ambiguous skills_behaviors items.',
    );
  }

  return {
    sectionCount: 1,
    version: 1,
    names,
    totalNames: names.length,
    behaviorCount,
    skillCount,
    matchedCount,
    detailedOnlyCount,
    summaryOnlyOrAmbiguousCount,
  };
};

const normalizeParityText = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const normalizeParitySectionHeading = (value: string): string =>
  normalizeParityText(value.replace(/^\s*[ivxlcdm]+\.\s*/i, ''));

export const assertIehpGeneratedDocxTextParity = (args: {
  generatedDocxText: string;
  sourceManifest: IehpGeneratedDocxParityManifest;
  proofCase?: IehpGeneratedDocxParityProofCase;
}): IehpGeneratedDocxParityAssertion => {
  const proofCase = args.proofCase ?? IEHP_GENERATED_DOCX_PARITY_PROOF_CASE;
  const normalizedOutputParagraphs = args.generatedDocxText
    .split(/\r?\n+/)
    .map(normalizeParitySectionHeading)
    .filter((value) => value.length > 0);
  const countMatches = (values: readonly string[], normalizeExpected = normalizeParityText): number =>
    values.filter((value) => {
      const normalizedExpected = normalizeExpected(value);
      return normalizedOutputParagraphs.some((paragraph) => paragraph.includes(normalizedExpected));
    }).length;

  const matchedNameCount = countMatches(args.sourceManifest.names);
  const matchedSectionHeadingCount = proofCase.expectedSectionHeadings.filter((heading) =>
    normalizedOutputParagraphs.includes(normalizeParitySectionHeading(heading)),
  ).length;
  const matchedNarrativeTermCount = countMatches(proofCase.expectedNarrativeTerms);

  if (matchedNameCount !== args.sourceManifest.totalNames) {
    throw new Error('IEHP generated DOCX parity expected every in-memory skills_behaviors name to appear in the generated DOCX.');
  }
  if (matchedSectionHeadingCount !== proofCase.expectedSectionHeadings.length) {
    throw new Error('IEHP generated DOCX parity expected every representative IEHP section heading to appear in the generated DOCX.');
  }
  if (matchedNarrativeTermCount !== proofCase.expectedNarrativeTerms.length) {
    throw new Error('IEHP generated DOCX parity expected every representative source narrative to appear in the generated DOCX.');
  }

  return {
    expectedNameCount: args.sourceManifest.totalNames,
    matchedNameCount,
    expectedSectionHeadingCount: proofCase.expectedSectionHeadings.length,
    matchedSectionHeadingCount,
    expectedNarrativeTermCount: proofCase.expectedNarrativeTerms.length,
    matchedNarrativeTermCount,
    allExpectedContentPresent: true,
  };
};

const assertSyntheticAutoApprovalStatus = (status: string | undefined, fieldKey: string): void => {
  const normalizedStatus = status?.trim() ?? '';
  if (normalizedStatus !== 'drafted' && normalizedStatus !== 'verified' && normalizedStatus !== 'approved') {
    throw new Error(`IEHP smoke required row ${fieldKey} was not in a reviewable status for synthetic auto-approval.`);
  }
};

export const selectIehpRequiredFinalOutputApprovals = (args: {
  checklist: DocumentChecklistResponse;
}): IehpRequiredFinalOutputApprovals => {
  const checklistApprovals: IehpChecklistApprovalPatch[] = [];
  const structuredSectionApprovals: IehpStructuredSectionApprovalPatch[] = [];

  for (const item of args.checklist.items) {
    if (!isRequiredForIehpFinalOutput(item.placeholder_key, item.required)) {
      continue;
    }
    const hasMeaningfulTextValue = typeof item.value_text === 'string' && hasMeaningfulValue(item.value_text);
    const hasMeaningfulJsonValue = hasMeaningfulValue(item.value_json);
    if (!hasMeaningfulTextValue && !hasMeaningfulJsonValue) {
      throw new Error(`IEHP smoke required checklist row ${item.placeholder_key} was blank or malformed.`);
    }
    assertSyntheticAutoApprovalStatus(item.status, item.placeholder_key);
    if ((item.status ?? '').trim() === 'approved') {
      continue;
    }
    const itemId = typeof item.id === 'string' ? item.id.trim() : '';
    if (!itemId) {
      throw new Error(`IEHP smoke required checklist row ${item.placeholder_key} was blank or malformed.`);
    }
    checklistApprovals.push({
      item_id: itemId,
      status: 'approved',
      review_notes: 'IEHP generated DOCX parity auto-approved required checklist row from synthetic smoke fixture.',
      ...(hasMeaningfulTextValue
        ? { value_text: item.value_text.trim() }
        : { value_json: item.value_json }),
    });
  }

  const sections = Array.isArray(args.checklist.structured_sections) ? args.checklist.structured_sections : [];
  for (const section of sections) {
    if (!isObjectRecord(section) || !isRequiredForIehpFinalOutput(section.field_key, section.required === true)) {
      continue;
    }
    if (!isObjectRecord(section.payload)) {
      throw new Error(`IEHP smoke required structured row ${section.field_key} was blank or malformed.`);
    }
    const approvalPayload = section.field_key === 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS'
      ? Object.fromEntries(Object.entries(section.payload).filter(([key]) => key !== 'skills_behaviors'))
      : section.payload;
    if (!hasMeaningfulValue(approvalPayload)) {
      throw new Error(`IEHP smoke required structured row ${section.field_key} was blank or malformed.`);
    }
    assertSyntheticAutoApprovalStatus(
      typeof section.status === 'string' ? section.status : undefined,
      section.field_key ?? 'unknown',
    );
    if ((typeof section.status === 'string' ? section.status.trim() : '') === 'approved') {
      continue;
    }
    const sectionId = typeof section.id === 'string' ? section.id.trim() : '';
    if (!sectionId) {
      throw new Error(`IEHP smoke required structured row ${section.field_key} was blank or malformed.`);
    }
    structuredSectionApprovals.push({
      structured_section_id: sectionId,
      status: 'approved',
      review_notes: 'IEHP generated DOCX parity auto-approved required structured row from synthetic smoke fixture.',
    });
  }

  const allRequiredRowsApproved = checklistApprovals.length === 0 && structuredSectionApprovals.length === 0;
  return {
    checklistApprovals,
    structuredSectionApprovals,
    summary: {
      checklistCount: checklistApprovals.length,
      structuredCount: structuredSectionApprovals.length,
      allRequiredRowsApproved,
    },
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
