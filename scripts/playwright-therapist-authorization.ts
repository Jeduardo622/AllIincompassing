import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { loadPlaywrightEnv } from './lib/load-playwright-env';

const artifactRoot = path.resolve(process.cwd(), 'artifacts');
const latestDir = path.join(artifactRoot, 'latest');

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  ensureDir(artifactRoot);
  ensureDir(latestDir);

  const headless = process.env.HEADLESS !== 'false';
  const baseUrl = process.env.PW_BASE_URL ?? 'https://app.allincompassing.ai';
  const therapistEmail = process.env.PW_THERAPIST_EMAIL ?? process.env.PLAYWRIGHT_THERAPIST_EMAIL;
  const therapistPassword =
    process.env.PW_THERAPIST_PASSWORD ?? process.env.PLAYWRIGHT_THERAPIST_PASSWORD;
  const foreignClientId =
    process.env.PW_FOREIGN_CLIENT_ID ?? process.env.PLAYWRIGHT_FOREIGN_CLIENT_ID;
  const foreignTherapistId =
    process.env.PW_FOREIGN_THERAPIST_ID ?? process.env.PLAYWRIGHT_FOREIGN_THERAPIST_ID;

  if (!therapistEmail || !therapistPassword) {
    throw new Error('Missing therapist credentials. Set PW_THERAPIST_EMAIL/PW_THERAPIST_PASSWORD.');
  }
  if (!foreignClientId || !foreignTherapistId) {
    throw new Error(
      'Missing foreign entity ids. Set PW_FOREIGN_CLIENT_ID and PW_FOREIGN_THERAPIST_ID.',
    );
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  const timestamp = Date.now();
  const evidence: Record<string, unknown> = {
    executedAt: new Date().toISOString(),
    baseUrl,
    therapistEmail,
    foreignClientId,
    foreignTherapistId,
  };

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first().fill('');
    await page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first().type(therapistEmail);
    await page.getByLabel(/password/i).or(page.locator('input[type="password"]')).first().fill('');
    await page
      .getByLabel(/password/i)
      .or(page.locator('input[type="password"]'))
      .first()
      .type(therapistPassword);
    await page
      .getByRole('button', { name: /sign in|log in|continue|submit/i })
      .or(page.locator('form button[type="submit"]'))
      .first()
      .click();
    await page.waitForURL(/\/(schedule|clients|dashboard|family)/, { timeout: 20000 });

    // Attempt to view another therapist's client
    await page.goto(`${baseUrl}/clients/${foreignClientId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const clientGuard = await page
      .locator('text=/You are not assigned to this client/i')
      .or(page.locator('text=/not authorized/i'))
      .first();
    await clientGuard.waitFor({ timeout: 10000 });

    // Attempt to view another therapist record
    await page.goto(`${baseUrl}/therapists/${foreignTherapistId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const therapistGuard = await page
      .locator('text=/You can only view your own therapist profile/i')
      .or(page.locator('text=/not authorized/i'))
      .first();
    await therapistGuard.waitFor({ timeout: 10000 });

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
    const failurePath = path.join(
      latestDir,
      `playwright-therapist-authorization-failure-${timestamp}.png`,
    );
    await page.screenshot({ path: failurePath, fullPage: true }).catch(() => undefined);
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

