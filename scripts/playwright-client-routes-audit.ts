import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Page } from 'playwright';

import { loadPlaywrightEnv } from './lib/load-playwright-env';

type RouteStatus = 'passed' | 'failed' | 'skipped' | 'blocked';

type RouteAuditResult = {
  route: '/schedule' | '/clients' | '/clients/:clientId';
  status: RouteStatus;
  url: string;
  checks: string[];
  errors: string[];
  screenshotPath?: string;
};

type ClientRoutesAuditReport = {
  target: string;
  timestamp: string;
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
  };
  auth: {
    attempted: boolean;
    success: boolean;
    reason?: string;
  };
  routes: RouteAuditResult[];
  consoleErrors: string[];
  networkErrors: Array<{
    url: string;
    status: number;
    method: string;
    statusText: string;
    responseSnippet?: string;
  }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const resolveAuthEnv = (): { email?: string; password?: string } => {
  const email =
    process.env.PW_EMAIL ??
    process.env.PW_THERAPIST_EMAIL ??
    process.env.PW_SUPERADMIN_EMAIL ??
    process.env.PW_ADMIN_EMAIL ??
    process.env.PLAYWRIGHT_ADMIN_EMAIL ??
    process.env.ADMIN_EMAIL ??
    process.env.ONBOARD_ADMIN_EMAIL;

  const password =
    process.env.PW_PASSWORD ??
    process.env.PW_THERAPIST_PASSWORD ??
    process.env.PW_SUPERADMIN_PASSWORD ??
    process.env.PW_ADMIN_PASSWORD ??
    process.env.PLAYWRIGHT_ADMIN_PASSWORD ??
    process.env.ADMIN_PASSWORD ??
    process.env.ONBOARD_ADMIN_PASSWORD;

  return { email, password };
};

const fillWithFallbacks = async (
  page: Page,
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
      await target.fill('');
      await target.type(value, { delay: 15 });
      const current = await target.inputValue().catch(() => '');
      if (current.length > 0) {
        return;
      }
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`Could not locate or fill ${label} field on login page`);
};

const isOnLoginRoute = (url: string): boolean => {
  try {
    return /\/login(\?|$)/i.test(new URL(url).pathname);
  } catch {
    return url.includes('/login');
  }
};

const login = async (page: Page, baseUrl: string, email: string, password: string): Promise<void> => {
  let loginFormReady = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    const ready = await page
      .locator('form input[type="password"], form input[type="email"], input[type="password"], input[type="email"]')
      .first()
      .waitFor({ state: 'visible', timeout: 7000 })
      .then(() => true)
      .catch(() => false);
    if (ready) {
      loginFormReady = true;
      break;
    }
    await sleep(800);
  }

  if (!loginFormReady) {
    throw new Error('Login form not visible after retries');
  }

  await fillWithFallbacks(
    page,
    [
      page.getByLabel(/email address/i),
      page.getByLabel(/^email$/i),
      page.locator('form input[type="email"]'),
      page.locator('form input[name*="email" i]'),
      page.locator('form input[placeholder*="email" i]'),
      page.locator('input:not([type="password"])'),
    ],
    email,
    'email',
  );

  await fillWithFallbacks(
    page,
    [
      page.getByLabel(/password/i),
      page.locator('form input[type="password"]'),
      page.locator('input[type="password"]'),
    ],
    password,
    'password',
  );

  await page.getByRole('button', { name: /sign in|log in|continue|submit/i }).first().click();

  const timeoutAt = Date.now() + 20000;
  while (Date.now() < timeoutAt) {
    const current = page.url();
    if (!isOnLoginRoute(current)) {
      return;
    }
    await sleep(500);
  }

  throw new Error('Login did not complete within timeout (still on /login).');
};

const screenshotFor = async (
  page: Page,
  artifactsDir: string,
  slug: string,
): Promise<string> => {
  const shotPath = path.join(artifactsDir, `playwright-client-routes-${slug}-${Date.now()}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });
  return shotPath;
};

const runRouteChecks = async (
  page: Page,
  baseUrl: string,
  artifactsDir: string,
): Promise<RouteAuditResult[]> => {
  const results: RouteAuditResult[] = [];

  const scheduleResult: RouteAuditResult = {
    route: '/schedule',
    status: 'failed',
    url: `${baseUrl}/schedule`,
    checks: [],
    errors: [],
  };

  try {
    await page.goto(scheduleResult.url, { waitUntil: 'networkidle' });
    if (isOnLoginRoute(page.url())) {
      throw new Error('Redirected to /login');
    }
    await page.getByRole('heading', { name: /schedule/i }).first().waitFor({ state: 'visible', timeout: 10000 });
    scheduleResult.checks.push('Schedule heading is visible');
    await page.getByRole('button', { name: /day view/i }).first().waitFor({ state: 'visible', timeout: 5000 });
    scheduleResult.checks.push('Day view control is visible');
    await page.getByRole('button', { name: /week view/i }).first().waitFor({ state: 'visible', timeout: 5000 });
    scheduleResult.checks.push('Week view control is visible');
    scheduleResult.status = 'passed';
  } catch (error) {
    scheduleResult.errors.push(error instanceof Error ? error.message : String(error));
    scheduleResult.screenshotPath = await screenshotFor(page, artifactsDir, 'schedule');
  }
  results.push(scheduleResult);

  const clientsResult: RouteAuditResult = {
    route: '/clients',
    status: 'failed',
    url: `${baseUrl}/clients`,
    checks: [],
    errors: [],
  };

  let detailRouteUrl: string | null = null;
  try {
    await page.goto(clientsResult.url, { waitUntil: 'networkidle' });
    if (isOnLoginRoute(page.url())) {
      throw new Error('Redirected to /login');
    }
    await page.getByRole('heading', { name: /^clients$/i }).first().waitFor({ state: 'visible', timeout: 10000 });
    clientsResult.checks.push('Clients heading is visible');
    await page.getByLabel(/search clients/i).first().waitFor({ state: 'visible', timeout: 5000 });
    clientsResult.checks.push('Search clients input is visible');

    const clientDetailLinks = page
      .locator('a[href^="/clients/"]')
      .filter({ hasNotText: 'Onboard Client' })
      .filter({ hasNot: page.locator('text=/clients/new/i') });
    const count = await clientDetailLinks.count();
    for (let i = 0; i < count; i += 1) {
      const href = await clientDetailLinks.nth(i).getAttribute('href');
      if (href && /^\/clients\/(?!new$)[^/]+$/i.test(href)) {
        detailRouteUrl = `${baseUrl}${href}`;
        break;
      }
    }

    clientsResult.checks.push(
      detailRouteUrl ? 'Found at least one client details link' : 'No client details link found (empty state)',
    );
    clientsResult.status = 'passed';
  } catch (error) {
    clientsResult.errors.push(error instanceof Error ? error.message : String(error));
    clientsResult.screenshotPath = await screenshotFor(page, artifactsDir, 'clients');
  }
  results.push(clientsResult);

  const detailsResult: RouteAuditResult = {
    route: '/clients/:clientId',
    status: 'skipped',
    url: detailRouteUrl ?? `${baseUrl}/clients/:clientId`,
    checks: [],
    errors: [],
  };

  if (!detailRouteUrl) {
    detailsResult.errors.push('Skipped: no client row/link available from /clients to open details.');
  } else {
    try {
      await page.goto(detailRouteUrl, { waitUntil: 'networkidle' });
      if (isOnLoginRoute(page.url())) {
        throw new Error('Redirected to /login');
      }
      await page.getByRole('heading', { name: /client records:/i }).first().waitFor({ state: 'visible', timeout: 10000 });
      detailsResult.checks.push('Client details heading is visible');
      await page.getByRole('button', { name: /profile \/ notes & issues/i }).first().waitFor({ state: 'visible', timeout: 5000 });
      detailsResult.checks.push('Profile tab is visible');
      await page.getByRole('button', { name: /session notes \/ physical auth/i }).first().waitFor({ state: 'visible', timeout: 5000 });
      detailsResult.checks.push('Session Notes tab is visible');
      detailsResult.status = 'passed';
    } catch (error) {
      detailsResult.status = 'failed';
      detailsResult.errors.push(error instanceof Error ? error.message : String(error));
      detailsResult.screenshotPath = await screenshotFor(page, artifactsDir, 'client-details');
    }
  }
  results.push(detailsResult);

  return results;
};

async function run(): Promise<void> {
  loadPlaywrightEnv();

  const baseUrl = process.env.PW_BASE_URL ?? 'https://app.allincompassing.ai';
  const { email, password } = resolveAuthEnv();
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  const artifactsDir = path.resolve('artifacts', 'latest');
  const reportsDir = path.resolve('reports', 'evidence');
  const docsAuditDir = path.resolve('docs', 'audits');
  const reportFileName = `client-routes-e2e-audit-${safeTimestamp}.json`;
  const reportPath = path.join(reportsDir, reportFileName);
  const docsReportPath = path.join(docsAuditDir, reportFileName);

  await ensureDir(artifactsDir);
  await ensureDir(reportsDir);
  await ensureDir(docsAuditDir);

  const consoleErrors: string[] = [];
  const networkErrors: Array<{
    url: string;
    status: number;
    method: string;
    statusText: string;
    responseSnippet?: string;
  }> = [];
  const blockedForAuth = !email || !password;

  let report: ClientRoutesAuditReport;

  if (blockedForAuth) {
    report = {
      target: baseUrl,
      timestamp,
      summary: { passed: 0, failed: 0, skipped: 0, blocked: 3 },
      auth: {
        attempted: false,
        success: false,
        reason: 'Missing credentials. Set PW_EMAIL/PW_PASSWORD (or supported fallbacks).',
      },
      routes: [
        {
          route: '/schedule',
          status: 'blocked',
          url: `${baseUrl}/schedule`,
          checks: [],
          errors: ['Audit blocked: no credentials available in environment.'],
        },
        {
          route: '/clients',
          status: 'blocked',
          url: `${baseUrl}/clients`,
          checks: [],
          errors: ['Audit blocked: no credentials available in environment.'],
        },
        {
          route: '/clients/:clientId',
          status: 'blocked',
          url: `${baseUrl}/clients/:clientId`,
          checks: [],
          errors: ['Audit blocked: no credentials available in environment.'],
        },
      ],
      consoleErrors,
      networkErrors,
    };
  } else {
    const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });
    page.on('response', async (response) => {
      const status = response.status();
      if (status >= 400) {
        let responseSnippet: string | undefined;
        try {
          const body = await response.text();
          responseSnippet = body.slice(0, 400);
        } catch {
          responseSnippet = undefined;
        }
        networkErrors.push({
          url: response.url(),
          status,
          method: response.request().method(),
          statusText: response.statusText(),
          responseSnippet,
        });
      }
    });

    let authSuccess = false;
    let authReason: string | undefined;
    let routes: RouteAuditResult[] = [];
    try {
      await login(page, baseUrl, email, password);
      authSuccess = true;
      routes = await runRouteChecks(page, baseUrl, artifactsDir);
    } catch (error) {
      authReason = error instanceof Error ? error.message : String(error);
      const screenshotPath = await screenshotFor(page, artifactsDir, 'auth-failure').catch(() => undefined);
      routes = [
        {
          route: '/schedule',
          status: 'blocked',
          url: `${baseUrl}/schedule`,
          checks: [],
          errors: [`Audit blocked: authentication failed (${authReason}).`],
          screenshotPath,
        },
        {
          route: '/clients',
          status: 'blocked',
          url: `${baseUrl}/clients`,
          checks: [],
          errors: [`Audit blocked: authentication failed (${authReason}).`],
          screenshotPath,
        },
        {
          route: '/clients/:clientId',
          status: 'blocked',
          url: `${baseUrl}/clients/:clientId`,
          checks: [],
          errors: [`Audit blocked: authentication failed (${authReason}).`],
          screenshotPath,
        },
      ];
    } finally {
      await browser.close();
    }

    report = {
      target: baseUrl,
      timestamp,
      summary: {
        passed: routes.filter((r) => r.status === 'passed').length,
        failed: routes.filter((r) => r.status === 'failed').length,
        skipped: routes.filter((r) => r.status === 'skipped').length,
        blocked: routes.filter((r) => r.status === 'blocked').length,
      },
      auth: {
        attempted: true,
        success: authSuccess,
        reason: authReason,
      },
      routes,
      consoleErrors,
      networkErrors,
    };
  }

  const body = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, body, 'utf-8');
  await fs.writeFile(docsReportPath, body, 'utf-8');

  console.log(`Client routes E2E audit report saved: ${reportPath}`);
  console.log(`Client routes E2E audit report copied: ${docsReportPath}`);
  console.log(`Summary -> passed=${report.summary.passed}, failed=${report.summary.failed}, skipped=${report.summary.skipped}, blocked=${report.summary.blocked}`);
  if (!report.auth.success) {
    console.log(`Auth note: ${report.auth.reason ?? 'Authentication failed.'}`);
  }
}

run().catch((error) => {
  console.error('Client routes E2E audit failed', error);
  process.exit(1);
});
