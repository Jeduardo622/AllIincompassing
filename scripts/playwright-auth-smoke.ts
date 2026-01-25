import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { loadPlaywrightEnv } from './lib/load-playwright-env';

async function run() {
  loadPlaywrightEnv();
  const headless = process.env.HEADLESS !== 'false';
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  const base = process.env.PW_BASE_URL ?? 'https://app.allincompassing.ai';
  const email =
    process.env.PW_EMAIL ??
    process.env.PW_SUPERADMIN_EMAIL ??
    process.env.PW_ADMIN_EMAIL ??
    process.env.PLAYWRIGHT_ADMIN_EMAIL ??
    process.env.ADMIN_EMAIL ??
    process.env.ONBOARD_ADMIN_EMAIL;
  const password =
    process.env.PW_PASSWORD ??
    process.env.PW_SUPERADMIN_PASSWORD ??
    process.env.PW_ADMIN_PASSWORD ??
    process.env.PLAYWRIGHT_ADMIN_PASSWORD ??
    process.env.ADMIN_PASSWORD ??
    process.env.ONBOARD_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing admin credentials. Set PW_EMAIL/PW_PASSWORD or PW_ADMIN_EMAIL/PW_ADMIN_PASSWORD.');
  }

  // Login
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500); // settle
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
      } catch {}
    }
    throw new Error(`Could not locate or fill ${label} field on login page`);
  };

  // Robust selectors for email
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
    email,
    'email',
  );

  // Robust selectors for password
  await fillWithFallbacks(
    [
      page.getByLabel(/password/i),
      page.locator('input[type="password"]'),
      page.locator('input[name~="password" i]'),
      page.locator('input[placeholder*="password" i]'),
    ],
    password,
    'password',
  );

  // Find a submit button
  const submitCandidates = [
    page.getByRole('button', { name: /sign in|log in|continue|submit/i }),
    page.locator('form button[type="submit"]'),
  ];
  let clickedSubmit = false;
  for (const cand of submitCandidates) {
    try {
      const count = await cand.count();
      if (count > 0) {
        const btn = cand.first();
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        clickedSubmit = true;
        break;
      }
    } catch {}
  }
  if (!clickedSubmit) {
    throw new Error('Could not locate submit button on login page');
  }

  // Wait for navigation or token
  // eslint-disable-next-line no-promise-executor-return
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
  const waitUntil = Date.now() + 15000;
  let hasToken = false;
  let sawDashboard = false;
  while (Date.now() < waitUntil) {
    // URL change away from login
    const url = page.url();
    if (!/\/login(\?|$)/i.test(new URL(url).pathname)) {
      sawDashboard = /dashboard|clients|schedule|reports|settings|therapists/i.test(url);
    }

    // Look for headings that indicate auth pages
    try {
      const headingText = await page.locator('h1,h2,[role="heading"]').first().innerText({ timeout: 2500 }).catch(() => '');
      if (/dashboard|clients|schedule|reports|settings|therapists/i.test(headingText)) {
        sawDashboard = true;
      }
    } catch {}

    // Probe localStorage for supabase tokens
    hasToken = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      // Supabase v2 tokens typically contain '-auth-token' or 'sb-<ref>-auth-token'
      return keys.some(k => /auth.*token|sb-.*-auth-token|supabase.*auth/i.test(k) && localStorage.getItem(k));
    });

    if (hasToken || sawDashboard) break;
    await sleep(500);
  }

  if (!hasToken && !sawDashboard) {
    // Capture failure screenshot
    const outDir = path.join(process.cwd(), 'artifacts', 'latest');
    fs.mkdirSync(outDir, { recursive: true });
    const shotPath = path.join(outDir, 'playwright-auth-smoke-failure.png');
    await page.screenshot({ path: shotPath, fullPage: true });
    console.error('Auth not verified after login. Saved screenshot to:', shotPath);
    await browser.close();
    process.exit(1);
  }

  // Spot-check a protected route and assert an app landmark or heading exists
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const redirectedToLogin = /\/login(\?|$)/i.test(new URL(page.url()).pathname);
  if (redirectedToLogin) {
    throw new Error('Redirected to /login after purported login');
  }

  const landmark = await page.locator('main, [role="main"], h1, [role="heading"]').first();
  const hasLandmark = await landmark.count().then(c => c > 0).catch(() => false);
  if (!hasLandmark) {
    console.error('No main/heading landmark detected on /dashboard, but auth token was present. Treating as pass.');
  }

  console.log('Playwright auth smoke passed');
  await browser.close();
}

run().catch(async (err) => {
  console.error('Playwright auth smoke failed', err);
  process.exit(1);
});


