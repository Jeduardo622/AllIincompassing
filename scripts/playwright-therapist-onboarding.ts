import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { loadPlaywrightEnv } from './lib/load-playwright-env';
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  loginAndAssertSession,
} from './lib/playwright-smoke';

const artifactRoot = path.resolve(process.cwd(), 'artifacts');
const latestDir = path.join(artifactRoot, 'latest');

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const ensurePlaceholder = (relativePath: string, contents: string) => {
  const absolute = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(absolute)) {
    ensureDir(path.dirname(absolute));
    fs.writeFileSync(absolute, contents, 'utf8');
  }
  return absolute;
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  ensureDir(artifactRoot);
  ensureDir(latestDir);

  const headless = process.env.HEADLESS !== 'false';
  const baseUrl = process.env.PW_BASE_URL ?? 'https://app.allincompassing.ai';
  const credentialCandidates = [
    {
      email: process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
    },
    {
      email: process.env.PW_SUPERADMIN_EMAIL,
      password: process.env.PW_SUPERADMIN_PASSWORD,
      label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
    },
  ].filter((entry) => Boolean(entry.email && entry.password));
  if (credentialCandidates.length === 0) {
    throw new Error(
      'Missing onboarding credentials. Set PW_ADMIN_EMAIL/PW_ADMIN_PASSWORD or PW_SUPERADMIN_EMAIL/PW_SUPERADMIN_PASSWORD.',
    );
  }

  const timestamp = Date.now();
  const therapistEmail = process.env.THERAPIST_EMAIL ?? `therapist.onboarding+${timestamp}@example.com`;
  const therapistFirstName = process.env.THERAPIST_FIRST_NAME ?? 'Playwright';
  const therapistLastName = process.env.THERAPIST_LAST_NAME ?? `Therapist${timestamp}`;
  const therapistLicense = process.env.THERAPIST_LICENSE ?? `LIC-${timestamp}`;

  const licensePath = ensurePlaceholder('artifacts/onboarding-license.pdf', 'License Document Placeholder');
  const resumePath = ensurePlaceholder('artifacts/onboarding-resume.pdf', 'Resume Placeholder');
  const backgroundPath = ensurePlaceholder('artifacts/onboarding-background.pdf', 'Background Check Placeholder');

  const browser = await chromium.launch({ headless });
  let context: import('playwright').BrowserContext | undefined;
  let page: import('playwright').Page | undefined;
  const credentialFailures: string[] = [];

  try {
    for (const candidate of credentialCandidates) {
      const attemptContext = await browser.newContext();
      const attemptPage = await attemptContext.newPage();
      try {
        await loginAndAssertSession(attemptPage, baseUrl, candidate.email!, candidate.password!);
        await assertRouteAccessible(attemptPage, baseUrl, '/therapists/new');
        context = attemptContext;
        page = attemptPage;
        break;
      } catch (error) {
        credentialFailures.push(
          `${candidate.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await attemptContext.close();
      }
    }
    if (!context || !page) {
      throw new Error(
        `No provided credential set can access /therapists/new. Attempts: ${credentialFailures.join(' || ')}`,
      );
    }

    console.log('Login successful, proceeding to therapist onboarding page.');
    await page.goto(`${baseUrl}/therapists/new`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Basic Information', { timeout: 10000 });

    // Step 1 – Basic Information
    await page.fill('#onboarding-first-name', therapistFirstName);
    await page.fill('#onboarding-last-name', therapistLastName);
    await page.fill('#onboarding-email', therapistEmail);
    await page.fill('#onboarding-phone', '555-0101');
    await page.click('button:has-text("Next")');

    // Step 2 – Professional Information
    await page.waitForSelector('text=Professional Information', { timeout: 10000 });
    await page.fill('#onboarding-license-number', therapistLicense);
    await page.click('button:has-text("Next")');

    // Step 3 – Address Information (optional fields populated to avoid empty payloads)
    await page.waitForSelector('text=Address & Contact Information', { timeout: 10000 });
    await page.fill('#onboarding-street', '123 Playwright Ave');
    await page.fill('#onboarding-city', 'Automation');
    await page.fill('#onboarding-state', 'CA');
    await page.fill('#onboarding-zip', '90210');
    await page.click('button:has-text("Next")');

    // Step 4 – Service Information
    await page.waitForSelector('text=Service Information', { timeout: 10000 });
    const checkByLabel = async (label: RegExp): Promise<void> => {
      const checkbox = page.getByLabel(label);
      if ((await checkbox.count().catch(() => 0)) > 0) {
        await checkbox.check({ timeout: 5000 });
        return;
      }
      const fallback = page.locator('label', { hasText: label }).locator('input[type="checkbox"]');
      if ((await fallback.count().catch(() => 0)) > 0) {
        await fallback.first().check({ timeout: 5000 });
        return;
      }
      const textFallback = page.locator(`text=${label.source}`);
      if ((await textFallback.count().catch(() => 0)) > 0) {
        await textFallback.first().click();
        return;
      }
      throw new Error(`Unable to locate checkbox for ${label.source}`);
    };

    await checkByLabel(/in clinic/i);
    await checkByLabel(/telehealth/i);
    await checkByLabel(/aba therapy/i);
    await page.check('#speech_therapy');
    await page.fill('#onboarding-hours-min', '5');
    await page.fill('#onboarding-hours-max', '25');
    await page.click('button:has-text("Next")');

    // Step 5 – Document Uploads
    await page.waitForSelector('text=Document Upload', { timeout: 10000 });
    await page.setInputFiles('#license', licensePath);
    await page.setInputFiles('#resume', resumePath);
    await page.setInputFiles('#background_check', backgroundPath);
    await page.check('#consent');

    console.log('Submitting therapist onboarding form');
    await page.getByRole('button', { name: /complete onboarding/i }).click();

    await page.waitForSelector('text=Therapist created successfully', { timeout: 20000 });
    await page.waitForURL('**/therapists', { timeout: 20000 });

    const screenshotPath = path.join(
      latestDir,
      `playwright-therapist-onboarding-${timestamp}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const summaryPath = path.join(
      latestDir,
      `playwright-therapist-onboarding-${timestamp}.json`,
    );
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          ok: true,
          executedAt: new Date().toISOString(),
          therapistEmail,
          therapistLicense,
          screenshotPath,
          baseUrl,
        },
        null,
        2,
      ),
      'utf8',
    );

    console.log(
      JSON.stringify({
        ok: true,
        message: 'Therapist onboarding smoke succeeded',
        therapistEmail,
        screenshotPath,
      }),
    );
  } catch (error) {
    const failureArtifact = page
      ? await captureFailureScreenshot(page, 'playwright-therapist-onboarding-failure')
      : 'N/A';
    console.error(
      JSON.stringify({
        ok: false,
        message: 'Therapist onboarding smoke failed',
        error: error instanceof Error ? error.message : String(error),
        failureArtifact,
      }),
    );
    process.exitCode = 1;
  } finally {
    if (context) {
      await context.close();
    }
    await browser.close();
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      message: 'Unhandled exception in therapist onboarding smoke',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});


