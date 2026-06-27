import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { cleanupAssessmentImportArtifacts } from './lib/assessment-import-cleanup';
import { loadPlaywrightEnv } from './lib/load-playwright-env';
import {
  captureFailureScreenshot,
  ensureArtifactsDir,
  loginAndAssertSession,
  preflightCredentials,
} from './lib/playwright-smoke';

type AssessmentDocumentRecord = {
  id: string;
  client_id: string;
  file_name: string;
  bucket_id?: string | null;
  object_path: string;
  status: 'uploaded' | 'extracting' | 'extraction_running' | 'extracted' | 'drafted' | 'approved' | 'rejected' | 'extraction_failed';
  extraction_error?: string | null;
};

type PersistedAssessmentEvidence = {
  checklistCount: number;
  extractedChecklistCount: number;
  extractionCount: number;
  extractedExtractionCount: number;
  structuredSectionCount: number;
  structuredFieldKeys: string[];
  draftProgramCount: number;
  draftGoalCount: number;
};

export const REQUIRED_CALOPTIMA_STRUCTURED_KEYS = [
  'CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS',
  'CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS',
  'CALOPTIMA_FBA_PARENT_GOALS',
] as const;

const DEFAULT_BASE_URL = 'https://app.allincompassing.ai';
const DEFAULT_SAMPLE_FILE = path.resolve(
  process.cwd(),
  '7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf',
);
const EXTRACTION_TIMEOUT_MS = 120_000;

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for assessment import smoke.`);
  }
  return value;
};

const resolveSupabaseUrl = (): string => process.env.VITE_SUPABASE_URL?.trim() || getRequiredEnv('SUPABASE_URL');
const resolveSupabaseAnonKey = (): string =>
  process.env.VITE_SUPABASE_ANON_KEY?.trim() || getRequiredEnv('SUPABASE_ANON_KEY');

const resolveMimeType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') {
    return 'application/pdf';
  }
  if (extension === '.docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'application/octet-stream';
};

const pause = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const writeCleanupFailureManifest = (args: {
  latestDir: string;
  assessment: AssessmentDocumentRecord;
  cleanupError: Error;
  runError?: Error | null;
}): string => {
  const manifestPath = path.join(args.latestDir, `assessment-import-cleanup-failure-${Date.now()}.json`);
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        assessmentDocumentId: args.assessment.id,
        clientId: args.assessment.client_id,
        fileName: args.assessment.file_name,
        bucketId: args.assessment.bucket_id?.trim() || 'client-documents',
        objectPath: args.assessment.object_path,
        cleanupError: args.cleanupError.message,
        runError: args.runError?.message ?? null,
      },
      null,
      2,
    ),
  );
  return manifestPath;
};

const fetchAssessmentDocuments = async (
  baseUrl: string,
  accessToken: string,
  clientId: string,
): Promise<AssessmentDocumentRecord[]> => {
  const response = await fetch(`${baseUrl}/api/assessment-documents?client_id=${encodeURIComponent(clientId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Assessment document query failed with status ${response.status}.`);
  }

  return (await response.json()) as AssessmentDocumentRecord[];
};

const fetchPersistedAssessmentEvidence = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<PersistedAssessmentEvidence> => {
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
  };
  const byAssessment = `assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}`;
  const fetchRows = async <T>(table: string, select: string): Promise<T[]> => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${select}&${byAssessment}`, { headers });
    if (!response.ok) {
      throw new Error(`Failed to load ${table} evidence: ${response.status}`);
    }
    return (await response.json()) as T[];
  };

  const [checklist, extractions, structuredSections, draftPrograms, draftGoals] = await Promise.all([
    fetchRows<{ status: string }>('assessment_checklist_items', 'id,status,placeholder_key'),
    fetchRows<{ status: string }>('assessment_extractions', 'id,status,field_key'),
    fetchRows<{ field_key: string }>('assessment_structured_sections', 'id,status,field_key,section_key'),
    fetchRows<unknown>('assessment_draft_programs', 'id'),
    fetchRows<unknown>('assessment_draft_goals', 'id'),
  ]);

  return {
    checklistCount: checklist.length,
    extractedChecklistCount: checklist.filter((item) => item.status !== 'not_started').length,
    extractionCount: extractions.length,
    extractedExtractionCount: extractions.filter((item) => item.status !== 'not_started').length,
    structuredSectionCount: structuredSections.length,
    structuredFieldKeys: [...new Set(structuredSections.map((section) => section.field_key))].sort(),
    draftProgramCount: draftPrograms.length,
    draftGoalCount: draftGoals.length,
  };
};

export const assertPersistedAssessmentEvidence = (evidence: PersistedAssessmentEvidence): void => {
  if (evidence.checklistCount === 0 || evidence.extractionCount === 0) {
    throw new Error('Assessment import smoke did not persist checklist and extraction rows.');
  }
  if (evidence.extractedChecklistCount === 0 || evidence.extractedExtractionCount === 0) {
    throw new Error('Assessment import smoke did not populate extracted checklist and extraction row statuses.');
  }
  if (evidence.structuredSectionCount === 0 || evidence.draftProgramCount === 0 || evidence.draftGoalCount === 0) {
    throw new Error('Assessment import smoke did not persist structured sections and deterministic drafts.');
  }
  const missingStructuredKeys = REQUIRED_CALOPTIMA_STRUCTURED_KEYS.filter(
    (key) => !evidence.structuredFieldKeys.includes(key),
  );
  if (missingStructuredKeys.length > 0) {
    throw new Error(`Assessment import smoke missing structured field keys: ${missingStructuredKeys.join(', ')}`);
  }
};

const selectClientForSmoke = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  email: string,
  password: string,
): Promise<{ accessToken: string; clientId: string; clientName: string }> => {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !authData.session || !authData.user) {
    throw authError ?? new Error('Could not authenticate assessment import smoke user.');
  }

  const configuredClientId = process.env.PW_ASSESSMENT_CLIENT_ID?.trim();
  if (configuredClientId) {
    const { data: client, error } = await supabase
      .from('clients')
      .select('id, full_name')
      .eq('id', configuredClientId)
      .maybeSingle();
    if (error || !client) {
      throw error ?? new Error(`Configured PW_ASSESSMENT_CLIENT_ID is not accessible: ${configuredClientId}`);
    }
    return {
      accessToken: authData.session.access_token,
      clientId: client.id,
      clientName: client.full_name ?? client.id,
    };
  }

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, full_name')
    .limit(1);
  if (clientsError || !clients || clients.length === 0) {
    throw clientsError ?? new Error('No accessible clients available for assessment import smoke.');
  }

  return {
    accessToken: authData.session.access_token,
    clientId: clients[0].id,
    clientName: clients[0].full_name ?? clients[0].id,
  };
};

async function run() {
  loadPlaywrightEnv();

  const baseUrl = (process.env.PW_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();
  const sampleFilePath = process.env.PW_ASSESSMENT_SAMPLE_FILE?.trim()
    ? path.resolve(process.cwd(), process.env.PW_ASSESSMENT_SAMPLE_FILE.trim())
    : DEFAULT_SAMPLE_FILE;
  const sourceFileBuffer = readFileSync(sampleFilePath);
  const sourceExtension = path.extname(sampleFilePath).toLowerCase();
  const uploadFileName = `${path.basename(sampleFilePath, sourceExtension)}-smoke-${Date.now()}${sourceExtension}`;
  const uploadMimeType = resolveMimeType(sampleFilePath);
  const credentials = preflightCredentials([
    {
      email: process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
    },
  ]);
  const { accessToken, clientId, clientName } = await selectClientForSmoke(
    supabaseUrl,
    supabaseAnonKey,
    credentials.email,
    credentials.password,
  );

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();
  const latestDir = ensureArtifactsDir();

  let createdAssessment: AssessmentDocumentRecord | null = null;
  let cleanupFailure: Error | null = null;
  let runFailure: Error | null = null;
  let cleanupFailureManifestPath: string | null = null;
  let cleanupFailureManifestError: Error | null = null;
  let persistedEvidence: PersistedAssessmentEvidence | null = null;

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    await page.goto(`${baseUrl}/clients/${clientId}?tab=programs-goals`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.getByText(/CalOptima FBA Upload Workflow|FBA Upload \+ AI Workflow/i).waitFor({ timeout: 20_000 });

    await page.locator('#programs-goals-fba-file-upload').setInputFiles({
      name: uploadFileName,
      mimeType: uploadMimeType,
      buffer: sourceFileBuffer,
    });
    await page.getByRole('button', { name: /Upload CalOptima FBA/i }).click();
    await page.getByText('Uploading and processing your FBA. This can take a moment.').waitFor({ timeout: 20_000 });

    const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const documents = await fetchAssessmentDocuments(baseUrl, accessToken, clientId);
      createdAssessment = documents.find((document) => document.file_name === uploadFileName) ?? null;
      if (createdAssessment && !['uploaded', 'extracting', 'extraction_running'].includes(createdAssessment.status)) {
        break;
      }
      await pause(2_000);
    }

    if (!createdAssessment) {
      throw new Error(`Uploaded assessment document ${uploadFileName} was not found in the queue.`);
    }
    if (!['extracted', 'drafted'].includes(createdAssessment.status)) {
      throw new Error(
        `Assessment import smoke ended with ${createdAssessment.status}${
          createdAssessment.extraction_error ? `: ${createdAssessment.extraction_error}` : ''
        }`,
      );
    }
    persistedEvidence = await fetchPersistedAssessmentEvidence(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      createdAssessment.id,
    );
    assertPersistedAssessmentEvidence(persistedEvidence);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.getByRole('button', { name: new RegExp(uploadFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
      .first()
      .waitFor({ timeout: 20_000 });

    const screenshotPath = path.join(latestDir, `assessment-import-smoke-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          clientId,
          clientName,
          assessmentDocumentId: createdAssessment.id,
          fileName: uploadFileName,
          status: createdAssessment.status,
          persistedEvidence,
          screenshot: screenshotPath,
          url: page.url(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const screenshot = await captureFailureScreenshot(page, 'playwright-assessment-import-smoke-failure');
    console.error(`Assessment import smoke failed. Screenshot: ${screenshot}`);
    runFailure = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (createdAssessment) {
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
      }).catch((cleanupError) => {
        cleanupFailure = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
        console.error('Assessment import smoke cleanup failed', cleanupFailure);
      });
    }
    await context.close();
    await browser.close();
    if (cleanupFailure && createdAssessment) {
      try {
        cleanupFailureManifestPath = writeCleanupFailureManifest({
          latestDir,
          assessment: createdAssessment,
          cleanupError: cleanupFailure,
          runError: runFailure,
        });
        console.error(`Assessment import smoke cleanup manifest written to ${cleanupFailureManifestPath}`);
      } catch (manifestError) {
        cleanupFailureManifestError =
          manifestError instanceof Error ? manifestError : new Error(String(manifestError));
        console.error('Assessment import smoke could not write cleanup manifest', cleanupFailureManifestError);
      }
    }
    if (runFailure && cleanupFailure) {
      throw new AggregateError(
        [runFailure, cleanupFailure],
        `Assessment import smoke failed and cleanup also failed: ${runFailure.message}; ${cleanupFailure.message}${
          cleanupFailureManifestPath ? `; cleanup manifest: ${cleanupFailureManifestPath}` : ''
        }${cleanupFailureManifestError ? `; cleanup manifest write failed: ${cleanupFailureManifestError.message}` : ''}`,
      );
    }
    if (runFailure) {
      throw runFailure;
    }
    if (cleanupFailure) {
      throw new Error(
        `${cleanupFailure.message}${
          cleanupFailureManifestPath ? ` (cleanup manifest: ${cleanupFailureManifestPath})` : ''
        }${cleanupFailureManifestError ? ` (cleanup manifest write failed: ${cleanupFailureManifestError.message})` : ''}`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error('Playwright assessment import smoke failed', error);
    process.exit(1);
  });
}
