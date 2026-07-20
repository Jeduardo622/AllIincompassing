import { readdirSync } from 'node:fs';
import path from 'node:path';

export type IehpPdfMiniMatrixCase = {
  id: 'clean-single-page' | 'multi-page-target-content' | 'alternate-document-phone-format';
  referralDate: string;
  documentPhone: string;
  pageBreakBeforeTarget: boolean;
};

type DocumentChecklistItem = {
  placeholder_key: string;
  value_text?: string | null;
};

type DocumentChecklistResponse = {
  items: DocumentChecklistItem[];
};

type AssessmentExtractionProvenanceRow = {
  field_key?: string | null;
  source_span?: unknown;
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
    documentPhone: '555-0101',
    pageBreakBeforeTarget: false,
  },
  {
    id: 'multi-page-target-content',
    referralDate: '07/01/2026',
    documentPhone: '555-0102',
    pageBreakBeforeTarget: true,
  },
  {
    id: 'alternate-document-phone-format',
    referralDate: '07/02/2026',
    documentPhone: '555-0103',
    pageBreakBeforeTarget: false,
  },
] as const;

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

export const buildIehpPdfMiniMatrixHtml = (caseDefinition: IehpPdfMiniMatrixCase): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${caseDefinition.id}</title>
  </head>
  <body>
    <section>
      <p>Referral Date: ${caseDefinition.referralDate}</p>
      ${caseDefinition.pageBreakBeforeTarget ? '<div style="page-break-before: always;"></div>' : ''}
      <p>Assessor's phone number: ${caseDefinition.documentPhone}</p>
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
