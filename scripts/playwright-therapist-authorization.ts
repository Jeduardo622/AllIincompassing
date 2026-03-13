import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { loadPlaywrightEnv } from './lib/load-playwright-env';
import {
  assertUuid,
  captureFailureScreenshot,
  hasSupabaseAuthToken,
  loginAndAssertSession,
  preflightCredentials,
} from './lib/playwright-smoke';

const artifactRoot = path.resolve(process.cwd(), 'artifacts');
const latestDir = path.join(artifactRoot, 'latest');

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const AUTH_GUARD_PATTERN =
  /you are not assigned to this client|not authorized|unauthorized|access denied|forbidden|you can only view your own therapist profile/i;

const isUnauthorizedPath = (pathname: string): boolean =>
  pathname.includes('/unauthorized') || pathname.includes('/login');

const assertGuardedRoute = async (page: import('playwright').Page, targetUrl: string): Promise<void> => {
  const forbiddenResponses: Array<{ url: string; status: number }> = [];
  const onResponse = (response: import('playwright').Response) => {
    const status = response.status();
    if (status === 401 || status === 403) {
      forbiddenResponses.push({ url: response.url(), status });
    }
  };

  page.on('response', onResponse);
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  } finally {
    page.off('response', onResponse);
  }

  const currentPath = new URL(page.url()).pathname.toLowerCase();
  if (isUnauthorizedPath(currentPath)) {
    return;
  }

  const guardVisible = await page.getByText(AUTH_GUARD_PATTERN).first().isVisible().catch(() => false);
  if (guardVisible) {
    return;
  }

  if (forbiddenResponses.length > 0) {
    return;
  }

  throw new Error(
    `Expected authorization guard for ${targetUrl}, but none detected. Current URL: ${page.url()}`,
  );
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  ensureDir(artifactRoot);
  ensureDir(latestDir);

  const headless = process.env.HEADLESS !== 'false';
  const baseUrl = process.env.PW_BASE_URL ?? 'https://app.allincompassing.ai';
  const credentials = preflightCredentials([
    {
      email: process.env.PW_THERAPIST_EMAIL ?? process.env.PLAYWRIGHT_THERAPIST_EMAIL,
      password: process.env.PW_THERAPIST_PASSWORD ?? process.env.PLAYWRIGHT_THERAPIST_PASSWORD,
      label: 'PW_THERAPIST_EMAIL + PW_THERAPIST_PASSWORD',
    },
  ]);
  const foreignClientId = assertUuid(
    process.env.PW_FOREIGN_CLIENT_ID ?? process.env.PLAYWRIGHT_FOREIGN_CLIENT_ID,
    'PW_FOREIGN_CLIENT_ID',
  );
  const foreignTherapistId = assertUuid(
    process.env.PW_FOREIGN_THERAPIST_ID ?? process.env.PLAYWRIGHT_FOREIGN_THERAPIST_ID,
    'PW_FOREIGN_THERAPIST_ID',
  );

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  const timestamp = Date.now();
  const evidence: Record<string, unknown> = {
    executedAt: new Date().toISOString(),
    baseUrl,
    therapistEmail: credentials.email,
    foreignClientId,
    foreignTherapistId,
  };

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    const hasToken = await hasSupabaseAuthToken(page);
    if (!hasToken) {
      throw new Error('Supabase auth token missing after therapist login.');
    }

    // Attempt to view another therapist's client
    await assertGuardedRoute(page, `${baseUrl}/clients/${foreignClientId}`);

    // Attempt to view another therapist record
    await assertGuardedRoute(page, `${baseUrl}/therapists/${foreignTherapistId}`);

    const screenshotPath = path.join(
      latestDir,
      `playwright-therapist-authorization-${timestamp}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.screenshotPath = screenshotPath;
    evidence.ok = true;
    fs.writeFileSync(
      path.join(latestDir, `playwright-therapist-authorization-${timestamp}.json`),
      JSON.stringify(evidence, null, 2),
      'utf8',
    );
    console.log(JSON.stringify({ ok: true, message: 'Therapist authorization guardrails verified' }));
  } catch (error) {
    evidence.ok = false;
    evidence.error = error instanceof Error ? error.message : String(error);
    const failurePath = await captureFailureScreenshot(page, 'playwright-therapist-authorization-failure');
    evidence.failurePath = failurePath;
    fs.writeFileSync(
      path.join(latestDir, `playwright-therapist-authorization-${timestamp}.json`),
      JSON.stringify(evidence, null, 2),
      'utf8',
    );
    console.error(
      JSON.stringify({
        ok: false,
        message: 'Therapist authorization guardrails failed',
        error: evidence.error,
        failurePath,
      }),
    );
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

