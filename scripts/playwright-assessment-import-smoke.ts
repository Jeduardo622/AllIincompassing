import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

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
  object_path: string;
  status: 'uploaded' | 'extracting' | 'extracted' | 'drafted' | 'approved' | 'rejected' | 'extraction_failed';
  extraction_error?: string | null;
};

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

const deleteAssessmentDocument = async (
  baseUrl: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<void> => {
  const response = await fetch(
    `${baseUrl}/api/assessment-documents?assessment_document_id=${encodeURIComponent(assessmentDocumentId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cleanup failed for ${assessmentDocumentId}: ${response.status} ${body}`);
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
    resolveSupabaseUrl(),
    resolveSupabaseAnonKey(),
    credentials.email,
    credentials.password,
  );

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();
  const latestDir = ensureArtifactsDir();

  let createdAssessment: AssessmentDocumentRecord | null = null;

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    await page.goto(`${baseUrl}/clients/${clientId}?tab=programs-goals`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.getByText('FBA Upload + AI Workflow').waitFor({ timeout: 20_000 });

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
      if (createdAssessment && !['uploaded', 'extracting'].includes(createdAssessment.status)) {
        break;
      }
      await pause(2_000);
    }

    if (!createdAssessment) {
      throw new Error(`Uploaded assessment document ${uploadFileName} was not found in the queue.`);
    }
    if (createdAssessment.status !== 'extracted') {
      throw new Error(
        `Assessment import smoke ended with ${createdAssessment.status}${
          createdAssessment.extraction_error ? `: ${createdAssessment.extraction_error}` : ''
        }`,
      );
    }

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
    throw error;
  } finally {
    if (createdAssessment) {
      await deleteAssessmentDocument(baseUrl, accessToken, createdAssessment.id).catch((cleanupError) => {
        console.error('Assessment import smoke cleanup failed', cleanupError);
      });
    }
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('Playwright assessment import smoke failed', error);
  process.exit(1);
});
