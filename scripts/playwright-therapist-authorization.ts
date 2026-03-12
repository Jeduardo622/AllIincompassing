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

const hasSupabaseAuthToken = async (page: import('playwright').Page): Promise<boolean> => {
  return page.evaluate(() => {
    const regex = /auth.*token|sb-.*-auth-token|supabase.*auth/i;
    const localKeys = Object.keys(window.localStorage);
    const sessionKeys = Object.keys(window.sessionStorage);
    const localHasToken = localKeys.some((key) => regex.test(key) && Boolean(window.localStorage.getItem(key)));
    const sessionHasToken = sessionKeys.some((key) => regex.test(key) && Boolean(window.sessionStorage.getItem(key)));
    return localHasToken || sessionHasToken;
  });
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
    await page.waitForTimeout(500);
    await page.waitForSelector('text=Sign in to AllIncompassing', { timeout: 5000 }).catch(() => undefined);
    const fillWithFallbacks = async (
      candidates: Array<ReturnType<typeof page.locator>>,
      value: string,
      label: string,
    ): Promise<void> => {
      for (const cand of candidates) {
        try {
          const count = await cand.count();
          if (count === 0) {
            continue;
          }
          const target = cand.first();
          await target.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
          await target.scrollIntoViewIfNeeded();
          await target.fill('');
          await target.type(value, { delay: 20 });
          const current = await target.inputValue().catch(() => '');
          if (current === value || current.length > 0) {
            return;
          }
        } catch {
          // try next candidate
        }
      }
      throw new Error(`Could not locate or fill ${label} field on login page`);
    };

    await fillWithFallbacks(
      [
        page.getByLabel(/email address/i),
        page.getByLabel(/^email$/i),
        page.locator('form input[type="email"]'),
        page.locator('form input[name*="email" i]'),
        page.locator('form input[placeholder*="email" i]'),
        page.locator('form input:not([type="password"])'),
        page.locator('input:not([type="password"])'),
      ],
      therapistEmail,
      'email',
    );

    await fillWithFallbacks(
      [
        page.getByLabel(/password/i),
        page.locator('input[type="password"]'),
        page.locator('input[name~="password" i]'),
        page.locator('input[placeholder*="password" i]'),
      ],
      therapistPassword,
      'password',
    );

    await page
      .getByRole('button', { name: /sign in|log in|continue|submit/i })
      .or(page.locator('form button[type="submit"]'))
      .first()
      .click();

    const waitUntil = Date.now() + 20000;
    let loginSucceeded = false;
    while (Date.now() < waitUntil) {
      const currentUrl = page.url();
      const offLoginPath = !/\/login(\?|$)/i.test(new URL(currentUrl).pathname);
      const hasToken = await hasSupabaseAuthToken(page);
      if (offLoginPath || hasToken) {
        loginSucceeded = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!loginSucceeded) {
      const loginErrors = await page
        .locator('[role="alert"], .error, .toast, [data-testid*="error"], [class*="error"]')
        .allInnerTexts()
        .catch(() => []);
      if (loginErrors.length > 0) {
        throw new Error(`Login failed: ${loginErrors.join(' | ')}`);
      }
      throw new Error('Login did not complete. Check PW_THERAPIST_EMAIL/PW_THERAPIST_PASSWORD in .env.codex.');
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

