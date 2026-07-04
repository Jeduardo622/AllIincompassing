import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { cleanupAssessmentImportArtifacts } from './lib/assessment-import-cleanup';
import {
  buildIehpSmokeCleanupFailureMessage,
  buildIehpSmokeCleanupFailureManifestPayload,
  buildIehpSmokeUploadFileName,
  resolveIehpSmokeSampleFile,
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

const DEFAULT_BASE_URL = 'https://app.allincompassing.ai';
const EXTRACTION_TIMEOUT_MS = 120_000;

type SupabaseClientFactory = typeof createClient;
type SmokeAuthResult = { accessToken: string };
type CredentialCandidate = {
  email?: string;
  password?: string;
  label: string;
};

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
): Promise<{ accessToken: string; clientId: string; credentials: { email: string; password: string; label: string } }> => {
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
        .select('id')
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

      return {
        accessToken: authResult.accessToken,
        clientId: client.id,
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

async function run() {
  loadPlaywrightEnv();

  const baseUrl = (process.env.PW_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();
  const sampleFilePath = resolveIehpSmokeSampleFile({ cwd: process.cwd() });
  const sourceFileBuffer = readFileSync(sampleFilePath);
  const uploadFileName = buildIehpSmokeUploadFileName();
  const credentialCandidates = [
    {
      email: process.env.PW_SUPERADMIN_EMAIL,
      password: process.env.PW_SUPERADMIN_PASSWORD,
      label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
    },
  ];
  preflightCredentials(credentialCandidates);
  const { accessToken, clientId, credentials } = await selectConfiguredSmokeClient(
    supabaseUrl,
    supabaseAnonKey,
    credentialCandidates,
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

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    await page.goto(`${baseUrl}/clients/${clientId}?tab=programs-goals`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    await page.locator('#programs-goals-fba-template').selectOption('iehp_fba');
    await page.getByText('IEHP FBA Upload Workflow').waitFor({ timeout: 20_000 });
    await page.locator('#programs-goals-fba-file-upload').setInputFiles({
      name: uploadFileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: sourceFileBuffer,
    });
    await page.getByRole('button', { name: /Upload IEHP FBA/i }).click();
    await page.getByText('Uploading and processing your FBA. This can take a moment.').waitFor({ timeout: 20_000 });

    const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const documents = await fetchAssessmentDocuments(baseUrl, accessToken, clientId);
      createdAssessment =
        documents.find((document) => document.file_name === uploadFileName && document.template_type === 'iehp_fba') ??
        null;
      if (createdAssessment && !['uploaded', 'extracting', 'extraction_running'].includes(createdAssessment.status)) {
        break;
      }
      await pause(2_000);
    }

    if (!createdAssessment) {
      cleanupFailure = new Error('IEHP smoke could not rediscover the uploaded assessment for cleanup.');
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
      throw new Error(`IEHP import smoke expected zero drafts but found ${programCount} program(s) and ${goalCount} goal(s).`);
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.getByRole('button', { name: new RegExp(uploadFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
      .first()
      .waitFor({ timeout: 20_000 });

    const screenshotPath = path.join(latestDir, `iehp-assessment-import-smoke-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          templateType: 'iehp_fba',
          status: createdAssessment.status,
          draftPrograms: programCount,
          draftGoals: goalCount,
          screenshot: screenshotPath,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const screenshot = await captureFailureScreenshot(page, 'playwright-iehp-assessment-import-smoke-failure');
    console.error(`IEHP assessment import smoke failed. Screenshot: ${screenshot}`);
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
        console.error('IEHP assessment import smoke cleanup failed.');
      });
    }
    await context.close();
    await browser.close();
    if (cleanupFailure) {
      try {
        cleanupFailureManifestPath = writeCleanupFailureManifest({
          latestDir,
          cleanupError: cleanupFailure,
          cleanupTargetKnown: Boolean(createdAssessment),
          runError: runFailure,
        });
        console.error(`IEHP assessment import smoke cleanup manifest written to ${cleanupFailureManifestPath}`);
      } catch (manifestError) {
        cleanupFailureManifestError =
          manifestError instanceof Error ? manifestError : new Error(String(manifestError));
        console.error('IEHP assessment import smoke could not write cleanup manifest', cleanupFailureManifestError);
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
