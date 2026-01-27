import { chromium, type Page } from 'playwright';
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

const ensurePlaceholder = (relativePath: string, contents: string) => {
  const absolute = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(absolute)) {
    ensureDir(path.dirname(absolute));
    fs.writeFileSync(absolute, contents, 'utf8');
  }
  return absolute;
};

const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fillWithFallbacks = async (
  candidates: Array<ReturnType<Page['locator']>>,
  value: string,
  label: string,
): Promise<void> => {
  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      if (count === 0) {
        continue;
      }
      const target = candidate.first();
      await target.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
      await target.scrollIntoViewIfNeeded();
      const isInput = await target.evaluate((el) => el instanceof HTMLInputElement).catch(() => false);
      if (!isInput) {
        continue;
      }
      await target.fill('');
      await target.type(value, { delay: 15 });
      const current = await target.inputValue().catch(() => '');
      if (current === value || current.length > 0) {
        return;
      }
    } catch {}
  }
  throw new Error(`Unable to locate ${label} field on login page.`);
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  ensureDir(artifactRoot);
  ensureDir(latestDir);

  const headless = process.env.HEADLESS !== 'false';
  const baseUrl = process.env.PW_BASE_URL ?? 'https://app.allincompassing.ai';
  const adminEmail =
    process.env.PW_EMAIL ??
    process.env.PW_SUPERADMIN_EMAIL ??
    process.env.PW_ADMIN_EMAIL ??
    process.env.PLAYWRIGHT_ADMIN_EMAIL ??
    process.env.ADMIN_EMAIL ??
    process.env.ONBOARD_ADMIN_EMAIL;
  const adminPassword =
    process.env.PW_PASSWORD ??
    process.env.PW_SUPERADMIN_PASSWORD ??
    process.env.PW_ADMIN_PASSWORD ??
    process.env.PLAYWRIGHT_ADMIN_PASSWORD ??
    process.env.ADMIN_PASSWORD ??
    process.env.ONBOARD_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error('Missing admin credentials. Set PW_EMAIL/PW_PASSWORD or PLAYWRIGHT_ADMIN_EMAIL/PASSWORD.');
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
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Navigating to login → ${baseUrl}/login`);
    const loginUrl = `${baseUrl}/login`;
    let loginReady = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('domcontentloaded');
      try {
        await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 30000 });
        loginReady = true;
        break;
      } catch {
        if (attempt === 0) {
          await waitFor(500);
        }
      }
    }
    if (!loginReady) {
      throw new Error('Login page did not render credential fields in time.');
    }
    await waitFor(200);

    await fillWithFallbacks(
      [
        page.getByLabel(/email address/i),
        page.getByLabel(/^email$/i),
        page.locator('form input[autocomplete="email"]'),
        page.locator('form input[type="email"]'),
        page.locator('form input[placeholder*="email" i]'),
        page.locator('form input[name*="email" i]'),
        page.locator('input[placeholder*="email" i]'),
        page.locator('input:not([type="password"])'),
      ],
      adminEmail,
      'email',
    );

    await fillWithFallbacks(
      [page.locator('input[type="password"]'), page.getByLabel(/password/i)],
      adminPassword,
      'password',
    );

    const submitButton = page
      .getByRole('button', { name: /sign in|log in|continue|submit/i })
      .or(page.locator('form button[type="submit"]'))
      .first();
    await submitButton.click();

    await page.waitForURL(/\/($|dashboard|clients|therapists|settings|schedule)/, {
      timeout: 30000,
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('heading', { name: /dashboard/i }).first().waitFor({ timeout: 15000 }).catch(() => undefined);

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
    const failureArtifact = path.join(
      latestDir,
      `playwright-therapist-onboarding-failure-${Date.now()}.png`,
    );
    await page.screenshot({ path: failureArtifact, fullPage: true }).catch(() => undefined);
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


