import { createClient } from '@supabase/supabase-js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { isValidPhone, sanitizePhone } from '../src/lib/validation';
import * as iehpAssessmentImportSmoke from './lib/iehp-assessment-import-smoke';

import { cleanupAssessmentImportArtifacts, deleteAssessmentStorageObject } from './lib/assessment-import-cleanup';
import { assertSmokeClientMarker } from './lib/assessment-upload-promote-smoke-guards';
import { readClinicalQaOutputFixtureText } from './lib/clinical-data-parity-agent';
import {
  IEHP_GENERATED_DOCX_PARITY_PROOF_CASE,
  IEHP_PDF_MINI_MATRIX_CASES,
  assertIehpDocumentChecklistField,
  assertIehpGeneratedDocxTextParity,
  buildRedactedIehpPreflightBlockerEvidence,
  buildIehpGeneratedDocxParityPdfHtml,
  buildIehpPdfMiniMatrixHtml,
  canonicalizeUsPhoneForComparison,
  deriveIehpGeneratedDocxParityManifest,
  buildIehpSmokeCleanupFailureMessage,
  buildIehpSmokeCleanupFailureManifestPayload,
  buildIehpSmokeUploadFileName,
  resolveIehpSmokeSampleFile,
  selectIehpRequiredFinalOutputApprovals,
} from './lib/iehp-assessment-import-smoke';
import { loadPlaywrightEnv } from './lib/load-playwright-env';
import {
  captureFailureScreenshot,
  ensureArtifactsDir,
  loginAndAssertSession,
  preflightCredentials,
} from './lib/playwright-smoke';

type AssessmentDocumentRecord = {
  id: string;
  file_name: string;
  bucket_id?: string | null;
  object_path: string;
  status: 'uploaded' | 'extracting' | 'extraction_running' | 'extracted' | 'drafted' | 'approved' | 'rejected' | 'extraction_failed';
  extraction_error?: string | null;
  template_type?: string | null;
};

type AssessmentDraftsResponse = {
  programs?: unknown[];
  goals?: unknown[];
};

type ChecklistResponse = {
  items: Array<{
    id: string;
    placeholder_key: string;
    label?: string | null;
    required?: boolean;
    status?: string;
    value_text?: string | null;
    value_json?: unknown;
  }>;
  structured_sections?: Array<{
    id?: string;
    field_key?: string;
    section_key?: string;
    section_index?: number;
    payload?: unknown;
    required?: boolean;
    status?: string;
  }> | unknown[];
};

type ChecklistResponsePayload =
  | ChecklistResponse
  | ChecklistResponse['items'];

type AssessmentExtractionProvenanceRow = {
  field_key?: string | null;
  source_span?: unknown;
};

type IehpAssessorPhoneAssertion = {
  fieldKey: 'IEHP_FBA_ASSESSOR_PHONE';
  rowCount: number;
  nonEmpty: true;
  validFormat: true;
  precedenceMatchedExpectedPhone: true;
  provenanceRowCount: number;
  provenanceVerified: true;
  sourceMethod: 'client_snapshot';
  sourceField: 'primary_therapist_phone';
  expectedPhoneRedacted: string;
  actualPhoneRedacted: string;
};

type IehpDocumentFieldAssertion = ReturnType<typeof assertIehpDocumentChecklistField>;

type IehpSmokeCaseInput = {
  caseId: string;
  uploadFileName: string;
  mimeType: string;
  sourceFileBuffer: Buffer;
  expectedReferralDate?: string | null;
  assessmentAssertions?: (args: { checklist: ChecklistResponse }) => Record<string, unknown> | null;
};

type IehpSmokeCaseEvidence = {
  ok: true;
  mode: 'default-docx' | 'pdf-mini-matrix-case' | 'skills-behaviors-proof';
  caseId: string;
  templateType: 'iehp_fba';
  status: AssessmentDocumentRecord['status'];
  draftPrograms: number;
  draftGoals: number;
  assessorPhoneAssertion: IehpAssessorPhoneAssertion;
  referralDateAssertion: IehpDocumentFieldAssertion | null;
  skillsBehaviorsProofResult?: Record<string, unknown> | null;
  cleanupVerified: true;
  screenshot: string;
};

type AssessmentPlanPdfBlocker = {
  code?: unknown;
};

type AssessmentPlanPdfPreflightResponse = {
  assessment_document_id?: unknown;
  generated_file_type?: unknown;
  preflight?: {
    ready?: unknown;
    blockers?: unknown;
    warnings?: unknown;
  };
};

type AssessmentPlanPdfGenerateResponse = {
  assessment_document_id?: string;
  generated_file_type?: 'docx' | 'pdf';
  signed_url?: string;
  object_path?: string;
  bucket_id?: string | null;
  filename?: string | null;
};

type ParsedAssessmentPlanPdfPreflight = {
  assessmentDocumentId: string;
  generatedFileType: 'docx' | 'pdf';
  ready: boolean;
  blockers: AssessmentPlanPdfBlocker[];
};

const DEFAULT_BASE_URL = 'https://app.allincompassing.ai';
const DEFAULT_ASSESSMENT_BUCKET_ID = 'client-documents';
const EXTRACTION_TIMEOUT_MS = 120_000;
const IEHP_REFERRAL_DATE_FIELD_KEY = 'IEHP_FBA_REFERRAL_DATE';

type SupabaseClientFactory = typeof createClient;
type SmokeAuthResult = { accessToken: string };
type CredentialCandidate = {
  email?: string;
  password?: string;
  label: string;
};

const IEHP_ASSESSOR_PHONE_FIELD_KEY = 'IEHP_FBA_ASSESSOR_PHONE';

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for IEHP assessment import smoke.`);
  }
  return value;
};

const resolveSupabaseUrl = (): string => process.env.VITE_SUPABASE_URL?.trim() || getRequiredEnv('SUPABASE_URL');
const resolveSupabaseAnonKey = (): string =>
  process.env.VITE_SUPABASE_ANON_KEY?.trim() || getRequiredEnv('SUPABASE_ANON_KEY');

const pause = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const buildRasterScanImageDataUrl = async (args: {
  page: import('playwright').Page;
  colorMode: 'black-and-white' | 'grayscale';
  jpegQuality: number;
}): Promise<string> => {
  const screenshotBuffer = await args.page.screenshot({ type: 'png' });
  const screenshotBase64 = screenshotBuffer.toString('base64');

  return args.page.evaluate(
    async ({ base64, colorMode, quality }) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;

      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        throw new Error('Canvas 2d context is unavailable for IEHP scan rendering.');
      }

      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;
      for (let index = 0; index < data.length; index += 4) {
        const luminance = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
        const normalized = colorMode === 'black-and-white'
          ? (luminance < 192 ? 0 : 255)
          : luminance;
        data[index] = normalized;
        data[index + 1] = normalized;
        data[index + 2] = normalized;
        data[index + 3] = 255;
      }
      context.putImageData(imageData, 0, 0);

      return canvas.toDataURL('image/jpeg', quality / 100);
    },
    { base64: screenshotBase64, colorMode: args.colorMode, quality: args.jpegQuality },
  );
};

const fetchWithRetry = async (url: string, init: RequestInit, label: string): Promise<Response> => {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`${label} failed with status ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await pause(1_500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed after retries.`);
};

const writeCleanupFailureManifest = (args: {
  latestDir: string;
  cleanupError: Error;
  cleanupTargetKnown: boolean;
  runError?: Error | null;
}): string => {
  const manifestPath = path.join(args.latestDir, `iehp-assessment-import-cleanup-failure-${Date.now()}.json`);
  writeFileSync(
    manifestPath,
    JSON.stringify(buildIehpSmokeCleanupFailureManifestPayload(args), null, 2),
  );
  return manifestPath;
};

export const executeIehpSmokeCaseWithCleanup = async <TEvidence>(args: {
  caseId: string;
  latestDir: string;
  executeCase: () => Promise<TEvidence>;
  cleanupCase: () => Promise<void>;
  cleanupTargetKnown: () => boolean;
  onRunFailure?: (error: Error) => Promise<void>;
}): Promise<TEvidence> => {
  let caseEvidence: TEvidence | undefined;
  let cleanupFailure: Error | null = null;
  let runFailure: Error | null = null;
  let cleanupFailureManifestPath: string | null = null;
  let cleanupFailureManifestError: Error | null = null;

  try {
    caseEvidence = await args.executeCase();
  } catch (error) {
    runFailure = error instanceof Error ? error : new Error(String(error));
    await args.onRunFailure?.(runFailure);
  } finally {
    await args.cleanupCase().catch((cleanupError) => {
      cleanupFailure = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
      console.error(`IEHP assessment import smoke cleanup failed for ${args.caseId}.`);
    });
    if (cleanupFailure) {
      try {
        cleanupFailureManifestPath = writeCleanupFailureManifest({
          latestDir: args.latestDir,
          cleanupError: cleanupFailure,
          cleanupTargetKnown: args.cleanupTargetKnown(),
          runError: runFailure,
        });
        console.error(
          `IEHP assessment import smoke cleanup manifest written to ${cleanupFailureManifestPath} for ${args.caseId}`,
        );
      } catch (manifestError) {
        cleanupFailureManifestError =
          manifestError instanceof Error ? manifestError : new Error(String(manifestError));
        console.error('IEHP assessment import smoke could not write cleanup manifest', cleanupFailureManifestError);
      }
    }
  }

  if (runFailure && cleanupFailure) {
    throw new Error(
      buildIehpSmokeCleanupFailureMessage({
        cleanupFailed: true,
        cleanupManifestPath: cleanupFailureManifestPath,
        cleanupManifestWriteFailed: Boolean(cleanupFailureManifestError),
        runFailed: true,
      }),
    );
  }
  if (runFailure) {
    throw runFailure;
  }
  if (cleanupFailure) {
    throw new Error(
      buildIehpSmokeCleanupFailureMessage({
        cleanupFailed: true,
        cleanupManifestPath: cleanupFailureManifestPath,
        cleanupManifestWriteFailed: Boolean(cleanupFailureManifestError),
        runFailed: false,
      }),
    );
  }
  if (caseEvidence === undefined) {
    throw new Error(`IEHP assessment import smoke case ${args.caseId} did not produce cleanup-verified evidence.`);
  }

  return caseEvidence;
};

const fetchAssessmentDocuments = async (
  baseUrl: string,
  accessToken: string,
  clientId: string,
): Promise<AssessmentDocumentRecord[]> => {
  const response = await fetchWithRetry(
    `${baseUrl}/api/assessment-documents?client_id=${encodeURIComponent(clientId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'Assessment document query',
  );

  if (!response.ok) {
    throw new Error(`Assessment document query failed with status ${response.status}.`);
  }

  return (await response.json()) as AssessmentDocumentRecord[];
};

const fetchAssessmentDraftCounts = async (
  baseUrl: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<{ programCount: number; goalCount: number }> => {
  const response = await fetchWithRetry(
    `${baseUrl}/api/assessment-drafts?assessment_document_id=${encodeURIComponent(assessmentDocumentId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'Assessment draft query',
  );

  if (!response.ok) {
    throw new Error(`Assessment draft query failed with status ${response.status}.`);
  }

  const drafts = (await response.json()) as AssessmentDraftsResponse;
  return {
    programCount: drafts.programs?.length ?? 0,
    goalCount: drafts.goals?.length ?? 0,
  };
};

const fetchAssessmentChecklist = async (
  baseUrl: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<ChecklistResponse> => {
  const response = await fetchWithRetry(
    `${baseUrl}/api/assessment-checklist?assessment_document_id=${encodeURIComponent(assessmentDocumentId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'Assessment checklist query',
  );

  if (!response.ok) {
    throw new Error(`Assessment checklist query failed with status ${response.status}.`);
  }

  return normalizeAssessmentChecklistResponse((await response.json()) as ChecklistResponsePayload);
};

const callAppJson = async <T>(
  baseUrl: string,
  accessToken: string,
  pathValue: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetchWithRetry(
    `${baseUrl}${pathValue}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    },
    `Request for ${pathValue}`,
  );

  if (!response.ok) {
    throw new Error(`Request for ${pathValue} failed with status ${response.status}.`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) as T : {} as T;
};

const postAssessmentPlanPdfPreflight = async (args: {
  baseUrl: string;
  accessToken: string;
  assessmentDocumentId: string;
}): Promise<AssessmentPlanPdfPreflightResponse> =>
  callAppJson<AssessmentPlanPdfPreflightResponse>(
    args.baseUrl,
    args.accessToken,
    '/api/assessment-plan-pdf',
    {
      method: 'POST',
      body: JSON.stringify({
        assessment_document_id: args.assessmentDocumentId,
        preflight_only: true,
      }),
    },
  );

export const parseAssessmentPlanPdfPreflight = (
  payload: AssessmentPlanPdfPreflightResponse,
): ParsedAssessmentPlanPdfPreflight => {
  const assessmentDocumentId =
    typeof payload.assessment_document_id === 'string' ? payload.assessment_document_id.trim() : '';
  if (!assessmentDocumentId) {
    throw new Error('IEHP generated DOCX parity expected assessment-plan-pdf preflight to include assessment_document_id.');
  }

  const generatedFileType = payload.generated_file_type;
  if (generatedFileType !== 'docx' && generatedFileType !== 'pdf') {
    throw new Error('IEHP generated DOCX parity expected assessment-plan-pdf preflight to include generated_file_type.');
  }

  if (!payload.preflight || typeof payload.preflight !== 'object') {
    throw new Error('IEHP generated DOCX parity expected assessment-plan-pdf preflight payload.preflight.');
  }

  if (typeof payload.preflight.ready !== 'boolean') {
    throw new Error('IEHP generated DOCX parity expected assessment-plan-pdf preflight ready boolean.');
  }

  if (!Array.isArray(payload.preflight.blockers)) {
    throw new Error('IEHP generated DOCX parity expected assessment-plan-pdf preflight blockers array.');
  }

  return {
    assessmentDocumentId,
    generatedFileType,
    ready: payload.preflight.ready,
    blockers: payload.preflight.blockers as AssessmentPlanPdfBlocker[],
  };
};

export const cleanupGeneratedDocxParityArtifacts = async (args: {
  generatedArtifact?:
    | {
        bucketId: string;
        objectPath: string;
      }
    | null;
  sourceAssessment?:
    | {
        assessmentDocumentId: string;
        bucketId: string;
        objectPath: string;
      }
    | null;
  deleteGeneratedArtifact?: () => Promise<void>;
  deleteSourceAssessment?: () => Promise<void>;
}): Promise<void> => {
  const operations: Array<Promise<void>> = [];

  if (args.generatedArtifact || args.deleteGeneratedArtifact) {
    operations.push((args.deleteGeneratedArtifact ?? (async () => undefined))());
  }
  if (args.sourceAssessment || args.deleteSourceAssessment) {
    operations.push((args.deleteSourceAssessment ?? (async () => undefined))());
  }

  const results = await Promise.allSettled(operations);
  const failedCount = results.filter((result) => result.status === 'rejected').length;
  if (failedCount > 0) {
    throw new Error(`IEHP generated DOCX parity cleanup did not complete for ${failedCount} cleanup target(s).`);
  }
};

export const assertIehpGeneratedDocxStorageTarget = (args: {
  bucketId: string | null | undefined;
  objectPath: string | null | undefined;
  clientId: string;
  assessmentDocumentId: string;
}): { bucketId: typeof DEFAULT_ASSESSMENT_BUCKET_ID; objectPath: string } => {
  const bucketId = args.bucketId?.trim() ?? '';
  const objectPath = args.objectPath?.trim() ?? '';
  const expectedPrefix = `clients/${args.clientId}/assessments/generated-iehp-fba-${args.assessmentDocumentId}-`;
  const timestampAndExtension = objectPath.slice(expectedPrefix.length);

  if (bucketId !== DEFAULT_ASSESSMENT_BUCKET_ID) {
    throw new Error('IEHP generated DOCX parity rejected an unexpected generated artifact bucket.');
  }
  if (!objectPath.startsWith(expectedPrefix) || !/^\d+\.docx$/.test(timestampAndExtension)) {
    throw new Error('IEHP generated DOCX parity rejected an unexpected generated artifact object path.');
  }

  return { bucketId: DEFAULT_ASSESSMENT_BUCKET_ID, objectPath };
};

export const readSyntheticGeneratedDocxText = async (
  artifactBuffer: Buffer,
  options: {
    tempRoot?: string;
    reader?: (filePath: string) => Promise<string>;
  } = {},
): Promise<string> => {
  const tempDirectory = mkdtempSync(path.join(options.tempRoot ?? tmpdir(), 'synthetic-iehp-docx-parity-'));
  const tempArtifactPath = path.join(tempDirectory, 'generated.docx');

  try {
    writeFileSync(tempArtifactPath, artifactBuffer);
    return await (options.reader ?? readClinicalQaOutputFixtureText)(tempArtifactPath);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
};

const patchAssessmentChecklist = async (args: {
  baseUrl: string;
  accessToken: string;
  body: Record<string, unknown>;
}): Promise<void> => {
  await callAppJson(
    args.baseUrl,
    args.accessToken,
    '/api/assessment-checklist',
    {
      method: 'PATCH',
      body: JSON.stringify(args.body),
    },
  );
};

export const fetchIehpAssessorPhoneProvenance = async (args: {
  accessToken: string;
  assessmentDocumentId: string;
  organizationId: string;
  supabaseAnonKey: string;
  supabaseUrl: string;
}): Promise<AssessmentExtractionProvenanceRow[]> => {
  const response = await fetchWithRetry(
    `${args.supabaseUrl}/rest/v1/assessment_extractions?select=field_key,source_span&assessment_document_id=eq.${encodeURIComponent(
      args.assessmentDocumentId,
    )}&field_key=eq.${encodeURIComponent(IEHP_ASSESSOR_PHONE_FIELD_KEY)}&organization_id=eq.${encodeURIComponent(
      args.organizationId,
    )}&limit=2`,
    {
      headers: {
        apikey: args.supabaseAnonKey,
        Authorization: `Bearer ${args.accessToken}`,
      },
    },
    'IEHP assessor phone extraction provenance query',
  );

  if (!response.ok) {
    throw new Error(`IEHP assessor phone extraction provenance query failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload as AssessmentExtractionProvenanceRow[] : [];
};

const fetchIehpAssessmentProvenance = async (args: {
  accessToken: string;
  assessmentDocumentId: string;
  organizationId: string;
  supabaseAnonKey: string;
  supabaseUrl: string;
  fieldKeys: string[];
}): Promise<AssessmentExtractionProvenanceRow[]> => {
  const encodedFieldKeys = args.fieldKeys
    .map((fieldKey) => `"${fieldKey.replace(/"/g, '\\"')}"`)
    .join(',');
  const response = await fetchWithRetry(
    `${args.supabaseUrl}/rest/v1/assessment_extractions?select=field_key,source_span&assessment_document_id=eq.${encodeURIComponent(
      args.assessmentDocumentId,
    )}&field_key=in.(${encodeURIComponent(encodedFieldKeys)})&organization_id=eq.${encodeURIComponent(
      args.organizationId,
    )}&limit=10`,
    {
      headers: {
        apikey: args.supabaseAnonKey,
        Authorization: `Bearer ${args.accessToken}`,
      },
    },
    'IEHP assessment extraction provenance query',
  );

  if (!response.ok) {
    throw new Error(`IEHP assessment extraction provenance query failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload as AssessmentExtractionProvenanceRow[] : [];
};

export const normalizeAssessmentChecklistResponse = (
  payload: ChecklistResponsePayload,
): ChecklistResponse => {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      structured_sections: [],
    };
  }

  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    structured_sections: Array.isArray(payload.structured_sections) ? payload.structured_sections : [],
  };
};

const redactPhone = (phone: string): string => {
  const digits = sanitizePhone(phone).replace(/\D/g, '');
  if (digits.length === 10) {
    return `(***) ***-${digits.slice(-4)}`;
  }
  if (digits.length > 4) {
    return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
  }
  return '*'.repeat(Math.max(digits.length, 1));
};

export const assertIehpAssessorPhoneChecklist = (args: {
  checklist: ChecklistResponse;
  expectedPhone: string;
  provenanceRows?: AssessmentExtractionProvenanceRow[];
}): IehpAssessorPhoneAssertion => {
  const matchingRows = args.checklist.items.filter((item) => item.placeholder_key === IEHP_ASSESSOR_PHONE_FIELD_KEY);
  if (matchingRows.length === 0) {
    throw new Error('IEHP smoke could not find IEHP_FBA_ASSESSOR_PHONE in assessment checklist.');
  }
  if (matchingRows.length !== 1) {
    throw new Error(`IEHP smoke expected exactly one IEHP_FBA_ASSESSOR_PHONE row but found ${matchingRows.length}.`);
  }

  const actualPhone = matchingRows[0]?.value_text?.trim() ?? '';
  if (!actualPhone) {
    throw new Error('IEHP smoke found IEHP_FBA_ASSESSOR_PHONE but its value was empty.');
  }
  if (!isValidPhone(actualPhone)) {
    throw new Error('IEHP smoke found IEHP_FBA_ASSESSOR_PHONE but its value did not match the accepted phone format.');
  }
  if (sanitizePhone(actualPhone) !== sanitizePhone(args.expectedPhone)) {
    throw new Error(
      'IEHP smoke expected IEHP_FBA_ASSESSOR_PHONE to match the configured client primary therapist snapshot phone.',
    );
  }

  const provenanceRows = (args.provenanceRows ?? []).filter((row) => row.field_key === IEHP_ASSESSOR_PHONE_FIELD_KEY);
  if (provenanceRows.length === 0) {
    throw new Error('IEHP smoke could not find IEHP_FBA_ASSESSOR_PHONE extraction provenance.');
  }
  if (provenanceRows.length !== 1) {
    throw new Error(
      `IEHP smoke expected exactly one IEHP_FBA_ASSESSOR_PHONE extraction provenance row but found ${provenanceRows.length}.`,
    );
  }
  const sourceSpan = provenanceRows[0]?.source_span;
  const sourceMethod = sourceSpan && typeof sourceSpan === 'object' && 'method' in sourceSpan
    ? (sourceSpan as { method?: unknown }).method
    : undefined;
  const sourceField = sourceSpan && typeof sourceSpan === 'object' && 'field' in sourceSpan
    ? (sourceSpan as { field?: unknown }).field
    : undefined;
  if (sourceMethod !== 'client_snapshot' || sourceField !== 'primary_therapist_phone') {
    throw new Error(
      'IEHP smoke expected IEHP_FBA_ASSESSOR_PHONE provenance to be client_snapshot.primary_therapist_phone.',
    );
  }

  return {
    fieldKey: IEHP_ASSESSOR_PHONE_FIELD_KEY,
    rowCount: matchingRows.length,
    nonEmpty: true,
    validFormat: true,
    precedenceMatchedExpectedPhone: true,
    provenanceRowCount: provenanceRows.length,
    provenanceVerified: true,
    sourceMethod,
    sourceField,
    expectedPhoneRedacted: redactPhone(args.expectedPhone),
    actualPhoneRedacted: redactPhone(actualPhone),
  };
};

const isInvalidCredentialsError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown };
  return candidate.code === 'invalid_credentials';
};

const signInSmokeUser = async (
  supabase: ReturnType<SupabaseClientFactory>,
  email: string,
  password: string,
): Promise<SmokeAuthResult> => {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !authData.session || !authData.user) {
    throw authError ?? new Error('Could not authenticate IEHP assessment import smoke user.');
  }

  return {
    accessToken: authData.session.access_token,
  };
};

export const selectConfiguredSmokeClient = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  credentialCandidates: CredentialCandidate[],
  options: {
    clientFactory?: SupabaseClientFactory;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{
  accessToken: string;
  clientId: string;
  therapistId: string;
  organizationId: string;
  expectedAssessorPhone: string;
  credentials: { email: string; password: string; label: string };
}> => {
  const env = options.env ?? process.env;
  const configuredClientId = env.PW_ASSESSMENT_CLIENT_ID?.trim();
  if (!configuredClientId) {
    throw new Error('PW_ASSESSMENT_CLIENT_ID is required for IEHP assessment import smoke.');
  }
  const clientFactory = options.clientFactory ?? createClient;
  const supabase = clientFactory(supabaseUrl, supabaseAnonKey);
  const availableCredentials = credentialCandidates.filter((candidate) => candidate.email && candidate.password);

  if (availableCredentials.length === 0) {
    const labels = credentialCandidates.map((candidate) => candidate.label).join(' | ');
    throw new Error(`Missing required credentials. Provide one of: ${labels}`);
  }

  for (const candidate of availableCredentials) {
    const email = candidate.email!;
    const password = candidate.password!;
    try {
      const authResult = await signInSmokeUser(supabase, email, password);
      const { data: client, error } = await supabase
        .from('clients')
        .select('id, therapist_id, organization_id, full_name')
        .eq('id', configuredClientId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!client) {
        throw new Error(
          `Configured PW_ASSESSMENT_CLIENT_ID is not accessible for authenticated credential: ${candidate.label}.`,
        );
      }

      const organizationId = typeof client.organization_id === 'string' ? client.organization_id.trim() : '';
      if (!organizationId) {
        throw new Error(
          'Configured PW_ASSESSMENT_CLIENT_ID must expose a non-empty organization for IEHP assessment import smoke.',
        );
      }

      const therapistId = typeof client.therapist_id === 'string' ? client.therapist_id.trim() : '';
      if (!therapistId) {
        throw new Error(
          'Configured PW_ASSESSMENT_CLIENT_ID must expose a primary therapist with a non-empty phone for IEHP assessment import smoke.',
        );
      }

      const { data: therapist, error: therapistError } = await supabase
        .from('therapists')
        .select('id, phone')
        .eq('id', therapistId)
        .maybeSingle();

      if (therapistError) {
        throw therapistError;
      }

      const expectedAssessorPhone = typeof therapist?.phone === 'string' ? therapist.phone.trim() : '';
      if (!expectedAssessorPhone) {
        throw new Error(
          'Configured PW_ASSESSMENT_CLIENT_ID must expose a primary therapist with a non-empty phone for IEHP assessment import smoke.',
        );
      }
      if (!isValidPhone(expectedAssessorPhone)) {
        throw new Error(
          'Configured PW_ASSESSMENT_CLIENT_ID must expose a primary therapist with an accepted phone format for IEHP assessment import smoke.',
        );
      }

      assertSmokeClientMarker(
        typeof client.full_name === 'string' ? client.full_name : null,
        'configured-client',
      );

      return {
        accessToken: authResult.accessToken,
        clientId: client.id,
        therapistId,
        organizationId,
        expectedAssessorPhone,
        credentials: {
          email,
          password,
          label: candidate.label,
        },
      };
    } catch (error) {
      if (!isInvalidCredentialsError(error)) {
        throw error;
      }
      console.warn(`IEHP assessment import smoke credential failed: ${candidate.label}. Trying next configured credential.`);
    }
  }

  throw new Error('Could not authenticate any configured IEHP assessment import smoke credential.');
};

export const restoreIehpGeneratedDocxReviewSelection = async (args: {
  isReviewVisible: () => Promise<boolean>;
  isUploadedAssessmentVisible: () => Promise<boolean>;
  waitForNextPoll: () => Promise<void>;
  selectUploadedAssessment: () => Promise<void>;
  waitForReview: () => Promise<void>;
  maxPollAttempts?: number;
}): Promise<void> => {
  const maxPollAttempts = args.maxPollAttempts ?? 120;
  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    if (await args.isReviewVisible()) {
      await args.waitForReview();
      return;
    }
    if (await args.isUploadedAssessmentVisible()) {
      await args.selectUploadedAssessment();
      await args.waitForReview();
      return;
    }
    if (attempt < maxPollAttempts - 1) {
      await args.waitForNextPoll();
    }
  }
  throw new Error('IEHP assessment queue did not restore a review or uploaded assessment.');
};

async function run() {
  loadPlaywrightEnv();

  const baseUrl = (process.env.PW_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();
  const isPdfMiniMatrixMode = process.argv.includes('--pdf-mini-matrix');
  const isSkillsBehaviorsProofMode = process.argv.includes('--skills-behaviors-proof');
  const isGeneratedDocxParityMode = process.argv.includes('--generated-docx-parity');
  const IEHP_SKILLS_BEHAVIORS_PROOF_CASE = iehpAssessmentImportSmoke.IEHP_SKILLS_BEHAVIORS_PROOF_CASE;
  // buildIehpSkillsBehaviorsProofPdfHtml
  const sampleFilePath =
    isPdfMiniMatrixMode || isSkillsBehaviorsProofMode || isGeneratedDocxParityMode
      ? null
      : resolveIehpSmokeSampleFile({ cwd: process.cwd() });
  const defaultSourceFileBuffer = sampleFilePath ? readFileSync(sampleFilePath) : null;
  const credentialCandidates = [
    {
      email: process.env.PW_SUPERADMIN_EMAIL,
      password: process.env.PW_SUPERADMIN_PASSWORD,
      label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
    },
  ];
  preflightCredentials(credentialCandidates);
  const { accessToken, clientId, organizationId, expectedAssessorPhone, credentials } = await selectConfiguredSmokeClient(
    supabaseUrl,
    supabaseAnonKey,
    credentialCandidates,
  );

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();
  const latestDir = ensureArtifactsDir();

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    const runSmokeCase = async (caseInput: IehpSmokeCaseInput): Promise<IehpSmokeCaseEvidence> => {
      let createdAssessment: AssessmentDocumentRecord | null = null;
      return executeIehpSmokeCaseWithCleanup({
        caseId: caseInput.caseId,
        latestDir,
        executeCase: async () => {
        await page.goto(`${baseUrl}/clients/${clientId}?tab=programs-goals`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForLoadState('networkidle').catch(() => undefined);

        await page.locator('#programs-goals-fba-template').selectOption('iehp_fba');
        await page.getByText('IEHP FBA Upload Workflow').waitFor({ timeout: 20_000 });
        await page.locator('#programs-goals-fba-file-upload').setInputFiles({
          name: caseInput.uploadFileName,
          mimeType: caseInput.mimeType,
          buffer: caseInput.sourceFileBuffer,
        });
        await page.getByRole('button', { name: /Upload IEHP FBA/i }).click();
        await page.getByText('Uploading and processing your FBA. This can take a moment.').waitFor({ timeout: 20_000 });

        const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const documents = await fetchAssessmentDocuments(baseUrl, accessToken, clientId);
          createdAssessment =
            documents.find(
              (document) => document.file_name === caseInput.uploadFileName && document.template_type === 'iehp_fba',
            ) ?? null;
          if (createdAssessment && !['uploaded', 'extracting', 'extraction_running'].includes(createdAssessment.status)) {
            break;
          }
          await pause(2_000);
        }

        if (!createdAssessment) {
          throw new Error('Uploaded IEHP assessment document was not found in the queue.');
        }
        if (createdAssessment.status === 'drafted') {
          throw new Error('IEHP import smoke unexpectedly created draft records and moved to drafted status.');
        }
        if (createdAssessment.status !== 'extracted') {
          throw new Error(
            `IEHP import smoke ended with ${createdAssessment.status}${
              createdAssessment.extraction_error ? `: ${createdAssessment.extraction_error}` : ''
            }`,
          );
        }

        const { programCount, goalCount } = await fetchAssessmentDraftCounts(baseUrl, accessToken, createdAssessment.id);
        if (programCount !== 0 || goalCount !== 0) {
          throw new Error(
            `IEHP import smoke expected zero drafts but found ${programCount} program(s) and ${goalCount} goal(s).`,
          );
        }

        const checklist = await fetchAssessmentChecklist(baseUrl, accessToken, createdAssessment.id);
        const provenanceRows = await fetchIehpAssessmentProvenance({
          accessToken,
          assessmentDocumentId: createdAssessment.id,
          organizationId,
          supabaseAnonKey,
          supabaseUrl,
          fieldKeys: caseInput.expectedReferralDate
            ? [IEHP_ASSESSOR_PHONE_FIELD_KEY, IEHP_REFERRAL_DATE_FIELD_KEY]
            : [IEHP_ASSESSOR_PHONE_FIELD_KEY],
        });
        const assessorPhoneAssertion = assertIehpAssessorPhoneChecklist({
          checklist,
          expectedPhone: expectedAssessorPhone,
          provenanceRows,
        });
        const referralDateAssertion = caseInput.expectedReferralDate
          ? assertIehpDocumentChecklistField({
              checklist,
              expectedValue: caseInput.expectedReferralDate,
              fieldKey: IEHP_REFERRAL_DATE_FIELD_KEY,
              provenanceRows,
            })
          : null;
        const skillsBehaviorsProofResult = caseInput.assessmentAssertions?.({ checklist }) ?? null;

        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await page
          .getByRole('button', {
            name: new RegExp(caseInput.uploadFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          })
          .first()
          .waitFor({ timeout: 20_000 });

        const screenshotPath = path.join(latestDir, `iehp-assessment-import-smoke-${caseInput.caseId}-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        return {
          ok: true,
          mode: isSkillsBehaviorsProofMode
            ? 'skills-behaviors-proof'
            : isPdfMiniMatrixMode
              ? 'pdf-mini-matrix-case'
              : 'default-docx',
          caseId: caseInput.caseId,
          templateType: 'iehp_fba',
          status: createdAssessment.status,
          draftPrograms: programCount,
          draftGoals: goalCount,
          assessorPhoneAssertion,
          referralDateAssertion,
          skillsBehaviorsProofResult,
          cleanupVerified: true,
          screenshot: screenshotPath,
        };
        },
        cleanupCase: async () => {
          if (!createdAssessment) {
            return;
          }
          await cleanupAssessmentImportArtifacts({
            accessToken,
            baseUrl,
            supabaseAnonKey,
            supabaseUrl,
            target: {
              assessmentDocumentId: createdAssessment.id,
              bucketId: createdAssessment.bucket_id?.trim() || 'client-documents',
              objectPath: createdAssessment.object_path,
            },
          });
        },
        cleanupTargetKnown: () => Boolean(createdAssessment),
        onRunFailure: async () => {
          const screenshot = await captureFailureScreenshot(
            page,
            `playwright-iehp-assessment-import-smoke-${caseInput.caseId}-failure`,
          );
          console.error(`IEHP assessment import smoke failed for ${caseInput.caseId}. Screenshot: ${screenshot}`);
        },
      });
    };

    const runSkillsBehaviorsProofCase = async () => {
      const proofCaseId = IEHP_SKILLS_BEHAVIORS_PROOF_CASE.id;
      const proofUploadFileName = buildIehpSmokeUploadFileName(Date.now(), 'pdf');
      const proofPdfPage = await context.newPage();
      try {
        await proofPdfPage.setContent(
          iehpAssessmentImportSmoke.buildIehpSkillsBehaviorsProofPdfHtml(IEHP_SKILLS_BEHAVIORS_PROOF_CASE),
        );
        const pdfBuffer = await proofPdfPage.pdf({ format: 'Letter', printBackground: true });
        await proofPdfPage.close().then(() => undefined);
        const caseEvidence = await runSmokeCase({
          caseId: proofCaseId,
          uploadFileName: proofUploadFileName,
          mimeType: 'application/pdf',
          sourceFileBuffer: pdfBuffer,
          assessmentAssertions: ({ checklist }) =>
            iehpAssessmentImportSmoke.assertIehpSkillsBehaviorsChecklistSection({
              checklist,
              proofCase: IEHP_SKILLS_BEHAVIORS_PROOF_CASE,
            }),
        });
        return caseEvidence;
      } finally {
        if (!proofPdfPage.isClosed()) {
          await proofPdfPage.close().then(() => undefined);
        }
      }
    };

    const runGeneratedDocxParityCase = async () => {
      let createdAssessment: AssessmentDocumentRecord | null = null;
      let generatedDocxObjectPath: string | null = null;
      let generatedDocxBucketId: string | null = null;

      return executeIehpSmokeCaseWithCleanup({
        caseId: 'generated-docx-parity',
        latestDir,
        executeCase: async () => {
          const uploadFileName = buildIehpSmokeUploadFileName(Date.now(), 'pdf');
          const generatedPdfPage = await context.newPage();
          let generatedPdfBuffer: Buffer;
          try {
            await generatedPdfPage.setContent(
              buildIehpGeneratedDocxParityPdfHtml(IEHP_GENERATED_DOCX_PARITY_PROOF_CASE),
            );
            generatedPdfBuffer = await generatedPdfPage.pdf({ format: 'Letter', printBackground: true });
          } finally {
            if (!generatedPdfPage.isClosed()) {
              await generatedPdfPage.close().then(() => undefined);
            }
          }
          await page.goto(`${baseUrl}/clients/${clientId}?tab=programs-goals`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
          });
          await page.waitForLoadState('networkidle').catch(() => undefined);

          await page.locator('#programs-goals-fba-template').selectOption('iehp_fba');
          await page.getByText('IEHP FBA Upload Workflow').waitFor({ timeout: 20_000 });
          await page.locator('#programs-goals-fba-file-upload').setInputFiles({
            name: uploadFileName,
            mimeType: 'application/pdf',
            buffer: generatedPdfBuffer,
          });
          await page.getByRole('button', { name: /Upload IEHP FBA/i }).click();
          await page.getByText('Uploading and processing your FBA. This can take a moment.').waitFor({ timeout: 20_000 });

          const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
          while (Date.now() < deadline) {
            const documents = await fetchAssessmentDocuments(baseUrl, accessToken, clientId);
            createdAssessment =
              documents.find(
                (document) => document.file_name === uploadFileName && document.template_type === 'iehp_fba',
              ) ?? null;
            if (createdAssessment && !['uploaded', 'extracting', 'extraction_running'].includes(createdAssessment.status)) {
              break;
            }
            await pause(2_000);
          }

          if (!createdAssessment) {
            throw new Error('Uploaded IEHP assessment document was not found in the queue.');
          }
          if (createdAssessment.status === 'drafted') {
            throw new Error('IEHP import smoke unexpectedly created draft records and moved to drafted status.');
          }
          if (createdAssessment.status !== 'extracted') {
            throw new Error(
              `IEHP import smoke ended with ${createdAssessment.status}${
                createdAssessment.extraction_error ? `: ${createdAssessment.extraction_error}` : ''
              }`,
            );
          }

          const { programCount, goalCount } = await fetchAssessmentDraftCounts(baseUrl, accessToken, createdAssessment.id);
          if (programCount !== 0 || goalCount !== 0) {
            throw new Error(
              `IEHP import smoke expected zero drafts but found ${programCount} program(s) and ${goalCount} goal(s).`,
            );
          }

          const checklist = await fetchAssessmentChecklist(baseUrl, accessToken, createdAssessment.id);
          const provenanceRows = await fetchIehpAssessmentProvenance({
            accessToken,
            assessmentDocumentId: createdAssessment.id,
            organizationId,
            supabaseAnonKey,
            supabaseUrl,
            fieldKeys: [IEHP_ASSESSOR_PHONE_FIELD_KEY],
          });
          const assessorPhoneAssertion = assertIehpAssessorPhoneChecklist({
            checklist,
            expectedPhone: expectedAssessorPhone,
            provenanceRows,
          });

          const preflightBeforeApprovalResponse = await postAssessmentPlanPdfPreflight({
            baseUrl,
            accessToken,
            assessmentDocumentId: createdAssessment.id,
          });
          const parsedPreflightBeforeApproval = parseAssessmentPlanPdfPreflight(preflightBeforeApprovalResponse);
          const preflightBeforeApproval = buildRedactedIehpPreflightBlockerEvidence({
            ready: parsedPreflightBeforeApproval.ready,
            blockers: parsedPreflightBeforeApproval.blockers,
          });
          if (preflightBeforeApproval.ready || !preflightBeforeApproval.hasUnapprovedRequiredBlocker) {
            throw new Error('IEHP generated DOCX parity expected preflight_only to report unapproved required blockers.');
          }

          const sourceManifest = deriveIehpGeneratedDocxParityManifest({ checklist });
          const approvalSelection = selectIehpRequiredFinalOutputApprovals({ checklist });
          for (const approval of approvalSelection.checklistApprovals) {
            await patchAssessmentChecklist({
              baseUrl,
              accessToken,
              body: approval,
            });
          }
          for (const approval of approvalSelection.structuredSectionApprovals) {
            await patchAssessmentChecklist({
              baseUrl,
              accessToken,
              body: approval,
            });
          }

          const approvedChecklist = await fetchAssessmentChecklist(baseUrl, accessToken, createdAssessment.id);
          const approvalVerification = selectIehpRequiredFinalOutputApprovals({ checklist: approvedChecklist });
          if (!approvalVerification.summary.allRequiredRowsApproved) {
            throw new Error('IEHP generated DOCX parity expected all required final-output rows to be approved after PATCH.');
          }

          const preflightAfterApprovalResponse = await postAssessmentPlanPdfPreflight({
            baseUrl,
            accessToken,
            assessmentDocumentId: createdAssessment.id,
          });
          const parsedPreflightAfterApproval = parseAssessmentPlanPdfPreflight(preflightAfterApprovalResponse);
          const preflightAfterApproval = buildRedactedIehpPreflightBlockerEvidence({
            ready: parsedPreflightAfterApproval.ready,
            blockers: parsedPreflightAfterApproval.blockers,
          });
          if (!preflightAfterApproval.ready) {
            throw new Error('IEHP generated DOCX parity expected preflight_only to become ready after required approvals.');
          }

          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
          await page.waitForLoadState('networkidle').catch(() => undefined);
          const reviewHeading = page.getByRole('heading', { name: 'IEHP FBA Checklist Review' });
          const uploadedAssessmentButton = page.getByRole('button', { name: uploadFileName, exact: true });
          await restoreIehpGeneratedDocxReviewSelection({
            isReviewVisible: () => reviewHeading.isVisible().catch(() => false),
            isUploadedAssessmentVisible: () => uploadedAssessmentButton.isVisible().catch(() => false),
            waitForNextPoll: () => page.waitForTimeout(500),
            selectUploadedAssessment: () => uploadedAssessmentButton.click({ timeout: 20_000 }),
            waitForReview: () => reviewHeading.waitFor({ timeout: 20_000 }),
          });
          const generatedDocxResponsePromise = page.waitForResponse(
            (response) => {
              const url = new URL(response.url());
              return url.pathname === '/api/assessment-plan-pdf' && response.request().method() === 'POST';
            },
            { timeout: 45_000 },
          );
          const popupPromise = page.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
          await page.getByRole('button', { name: /Generate completed IEHP DOCX/i }).click({ timeout: 10_000 });

          const generatedDocxResponse = await generatedDocxResponsePromise;
          if (!generatedDocxResponse.ok()) {
            throw new Error('IEHP generated DOCX parity request failed before artifact download.');
          }

          const generatedDocxPayload = (await generatedDocxResponse.json()) as AssessmentPlanPdfGenerateResponse;
          if (generatedDocxPayload.assessment_document_id !== createdAssessment.id) {
            throw new Error('IEHP generated DOCX parity received a generation response for the wrong assessment document.');
          }
          if (generatedDocxPayload.generated_file_type !== 'docx') {
            throw new Error('IEHP generated DOCX parity expected a DOCX response.');
          }
          const signedUrl = typeof generatedDocxPayload.signed_url === 'string' ? generatedDocxPayload.signed_url.trim() : '';
          if (!signedUrl) {
            throw new Error('IEHP generated DOCX parity expected a non-empty signed_url.');
          }
          const generatedStorageTarget = assertIehpGeneratedDocxStorageTarget({
            bucketId: generatedDocxPayload.bucket_id,
            objectPath: generatedDocxPayload.object_path,
            clientId,
            assessmentDocumentId: createdAssessment.id,
          });
          generatedDocxObjectPath = generatedStorageTarget.objectPath;
          generatedDocxBucketId = generatedStorageTarget.bucketId;

          const generatedDocxArtifactResponse = await page.context().request.get(signedUrl);
          if (!generatedDocxArtifactResponse.ok()) {
            throw new Error(`IEHP generated DOCX parity artifact download failed with HTTP ${generatedDocxArtifactResponse.status()}.`);
          }
          const generatedDocxArtifactBuffer = await generatedDocxArtifactResponse.body();
          const popup = await popupPromise;
          await popup?.close().catch(() => undefined);

          const generatedDocxText = await readSyntheticGeneratedDocxText(generatedDocxArtifactBuffer);
          const generatedDocxParity = assertIehpGeneratedDocxTextParity({
            generatedDocxText,
            sourceManifest,
            proofCase: IEHP_GENERATED_DOCX_PARITY_PROOF_CASE,
          });

          return {
            ok: true,
            mode: 'generated-docx-parity',
            caseId: 'generated-docx-parity',
            templateType: 'iehp_fba',
            status: createdAssessment.status,
            draftPrograms: programCount,
            draftGoals: goalCount,
            assessorPhoneAssertion,
            preflightBeforeApproval,
            preflightAfterApproval,
            sourceManifest: {
              sectionCount: sourceManifest.sectionCount,
              version: sourceManifest.version,
              totalNames: sourceManifest.totalNames,
              behaviorCount: sourceManifest.behaviorCount,
              skillCount: sourceManifest.skillCount,
              matchedCount: sourceManifest.matchedCount,
              detailedOnlyCount: sourceManifest.detailedOnlyCount,
              summaryOnlyOrAmbiguousCount: sourceManifest.summaryOnlyOrAmbiguousCount,
            },
            approvalSummary: approvalSelection.summary,
            generatedDocxParity,
            cleanupVerified: true,
          };
        },
        cleanupCase: async () => {
          await cleanupGeneratedDocxParityArtifacts({
            generatedArtifact: generatedDocxObjectPath
              ? {
                  bucketId: generatedDocxBucketId || DEFAULT_ASSESSMENT_BUCKET_ID,
                  objectPath: generatedDocxObjectPath,
                }
              : null,
            sourceAssessment: createdAssessment
              ? {
                  assessmentDocumentId: createdAssessment.id,
                  bucketId: createdAssessment.bucket_id?.trim() || DEFAULT_ASSESSMENT_BUCKET_ID,
                  objectPath: createdAssessment.object_path,
                }
              : null,
            deleteGeneratedArtifact: generatedDocxObjectPath
              ? () =>
                  deleteAssessmentStorageObject(fetch, {
                    supabaseUrl,
                    supabaseAnonKey,
                    accessToken,
                    bucketId: generatedDocxBucketId || DEFAULT_ASSESSMENT_BUCKET_ID,
                    objectPath: generatedDocxObjectPath,
                  })
              : undefined,
            deleteSourceAssessment: createdAssessment
              ? () =>
                  cleanupAssessmentImportArtifacts({
                    accessToken,
                    baseUrl,
                    supabaseAnonKey,
                    supabaseUrl,
                    target: {
                      assessmentDocumentId: createdAssessment.id,
                      bucketId: createdAssessment.bucket_id?.trim() || DEFAULT_ASSESSMENT_BUCKET_ID,
                      objectPath: createdAssessment.object_path,
                    },
                  })
              : undefined,
          });
        },
        cleanupTargetKnown: () => Boolean(createdAssessment),
        onRunFailure: async () => {
          const screenshot = await captureFailureScreenshot(
            page,
            'playwright-iehp-assessment-import-smoke-generated-docx-parity-failure',
          );
          console.error(`IEHP assessment import smoke failed for generated-docx-parity. Screenshot: ${screenshot}`);
        },
      });
    };

    if (isPdfMiniMatrixMode) {
      const passedCases: IehpSmokeCaseEvidence[] = [];
      for (const caseDefinition of IEHP_PDF_MINI_MATRIX_CASES) {
        if (
          canonicalizeUsPhoneForComparison(caseDefinition.documentPhone) ===
          canonicalizeUsPhoneForComparison(expectedAssessorPhone)
        ) {
          throw new Error(
            `IEHP PDF mini matrix case ${caseDefinition.id} normalized document phone matched the configured snapshot phone, so precedence proof would be ambiguous.`,
          );
        }
        const generatorPage = await context.newPage();
        try {
          await generatorPage.setContent(buildIehpPdfMiniMatrixHtml(caseDefinition));
          let uploadPdfBuffer: Buffer;
          if (caseDefinition.renderMode === 'raster-scan') {
            const scanWidth = Math.round(caseDefinition.scan.dpi * 8.5);
            const scanHeight = caseDefinition.scan.dpi * 11;
            const scanFontSize = Math.round(54 * (caseDefinition.scan.dpi / 300));
            const scanPaddingTop = Math.round(240 * (caseDefinition.scan.dpi / 300));
            const scanPaddingSides = Math.round(220 * (caseDefinition.scan.dpi / 300));
            await generatorPage.setViewportSize({ width: scanWidth, height: scanHeight });
            await generatorPage.setContent(`
              <!doctype html>
              <html lang="en">
                <head>
                  <meta charset="utf-8" />
                  <title>${caseDefinition.id}</title>
                  <style>
                    html, body {
                      margin: 0;
                      padding: 0;
                      width: ${scanWidth}px;
                      height: ${scanHeight}px;
                      background: white;
                    }

                    body {
                      color: black;
                      font-family: Arial, sans-serif;
                      font-size: ${scanFontSize}px;
                      line-height: 1.4;
                    }

                    main {
                      box-sizing: border-box;
                      width: 100%;
                      min-height: 100%;
                      padding: ${scanPaddingTop}px ${scanPaddingSides}px;
                      transform: rotate(${caseDefinition.scan.rotationDegrees}deg);
                      transform-origin: center center;
                    }
                  </style>
                </head>
                <body>
                  <main>
                    <p>Referral Date: ${caseDefinition.referralDate}</p>
                    <p>Assessor's phone number: ${caseDefinition.documentPhone}</p>
                  </main>
                </body>
              </html>
            `);
            const rasterScanDataUrl = await buildRasterScanImageDataUrl({
              page: generatorPage,
              colorMode: caseDefinition.scan.colorMode,
              jpegQuality: caseDefinition.scan.jpegQuality,
            });
            const rasterPdfPage = await context.newPage();
            try {
              await rasterPdfPage.setContent(`
                <!doctype html>
                <html lang="en">
                  <head>
                    <meta charset="utf-8" />
                    <title>${caseDefinition.id}</title>
                    <style>
                      @page {
                        size: Letter;
                        margin: 0;
                      }

                      html, body {
                        margin: 0;
                        padding: 0;
                        width: 8.5in;
                        height: 11in;
                        background: white;
                      }

                      img {
                        display: block;
                        width: 8.5in;
                        height: 11in;
                      }
                    </style>
                  </head>
                  <body>
                    <img alt="${caseDefinition.id}" src="${rasterScanDataUrl}" />
                  </body>
                </html>
              `);
              uploadPdfBuffer = await rasterPdfPage.pdf({ format: 'Letter', printBackground: true });
            } finally {
              if (!rasterPdfPage.isClosed()) {
                await rasterPdfPage.close().then(() => undefined);
              }
            }
          } else {
            const pdfBuffer = await generatorPage.pdf({ format: 'Letter', printBackground: true });
            uploadPdfBuffer = pdfBuffer;
          }
          await generatorPage.close();
          const caseEvidence = await runSmokeCase({
            caseId: caseDefinition.id,
            uploadFileName: buildIehpSmokeUploadFileName(Date.now(), 'pdf'),
            mimeType: 'application/pdf',
            sourceFileBuffer: uploadPdfBuffer,
            expectedReferralDate: caseDefinition.referralDate,
          });
          console.log(JSON.stringify(caseEvidence, null, 2));
          passedCases.push(caseEvidence);
        } finally {
          if (!generatorPage.isClosed()) {
            await generatorPage.close().then(() => undefined);
          }
        }
      }

      const skillsBehaviorsCaseEvidence = await runSkillsBehaviorsProofCase();
      console.log(JSON.stringify(skillsBehaviorsCaseEvidence, null, 2));
      passedCases.push(skillsBehaviorsCaseEvidence);

      const skillsBehaviorsVerifiedCases = passedCases.filter(
        (caseEvidence) => caseEvidence.skillsBehaviorsProofResult !== null,
      ).length;
      if (skillsBehaviorsVerifiedCases !== 1) {
        throw new Error(
          `IEHP PDF mini matrix expected exactly one Skills & Behaviors verified case but found ${skillsBehaviorsVerifiedCases}.`,
        );
      }

      const aggregateEvidence = {
        ok: true,
        mode: 'pdf-mini-matrix',
        totalCases: IEHP_PDF_MINI_MATRIX_CASES.length + 1,
        passedCases: passedCases.length,
        cleanupVerifiedCases: passedCases.length,
        skillsBehaviorsVerifiedCases,
      };
      console.log(JSON.stringify(aggregateEvidence, null, 2));
      return;
    }

    if (isSkillsBehaviorsProofMode) {
      const proofCaseEvidence = await runSkillsBehaviorsProofCase();
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: 'skills-behaviors-proof',
            caseId: proofCaseEvidence.caseId,
            templateType: proofCaseEvidence.templateType,
            status: proofCaseEvidence.status,
            draftPrograms: proofCaseEvidence.draftPrograms,
            draftGoals: proofCaseEvidence.draftGoals,
            skillsBehaviorsAssertion: proofCaseEvidence.skillsBehaviorsProofResult,
            cleanupVerified: proofCaseEvidence.cleanupVerified,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (isGeneratedDocxParityMode) {
      const generatedDocxParityEvidence = await runGeneratedDocxParityCase();
      console.log(JSON.stringify(generatedDocxParityEvidence, null, 2));
      return;
    }

    const defaultCaseEvidence = await runSmokeCase({
      caseId: 'default-docx',
      uploadFileName: buildIehpSmokeUploadFileName(),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sourceFileBuffer: defaultSourceFileBuffer!,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          templateType: 'iehp_fba',
          status: defaultCaseEvidence.status,
          draftPrograms: defaultCaseEvidence.draftPrograms,
          draftGoals: defaultCaseEvidence.draftGoals,
          assessorPhoneAssertion: defaultCaseEvidence.assessorPhoneAssertion,
          screenshot: defaultCaseEvidence.screenshot,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.env.VITEST !== 'true';

if (isDirectRun) {
  run().catch((error) => {
    console.error('Playwright IEHP assessment import smoke failed', error);
    process.exit(1);
  });
}
