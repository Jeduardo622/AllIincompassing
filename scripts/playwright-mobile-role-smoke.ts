import { chromium, devices } from 'playwright';

import { loadPlaywrightEnv } from './lib/load-playwright-env';

const login = async (page: import('playwright').Page, baseUrl: string, email: string, password: string) => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first().fill(email);
  await page.getByLabel(/password/i).or(page.locator('input[type="password"]')).first().fill(password);
  await page
    .getByRole('button', { name: /sign in|log in|continue|submit/i })
    .or(page.locator('form button[type="submit"]'))
    .first()
    .click();
  await page.waitForURL(/\/(schedule|clients|dashboard|family|monitoring)/, { timeout: 20000 });
};

async function run(): Promise<void> {
  loadPlaywrightEnv();

  const baseUrl = process.env.PW_BASE_URL ?? 'https://app.allincompassing.ai';
  const adminEmail = process.env.PW_ADMIN_EMAIL ?? process.env.PW_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL;
  const adminPassword =
    process.env.PW_ADMIN_PASSWORD ?? process.env.PW_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD;
  const therapistEmail = process.env.PW_THERAPIST_EMAIL ?? process.env.PLAYWRIGHT_THERAPIST_EMAIL;
  const therapistPassword =
    process.env.PW_THERAPIST_PASSWORD ?? process.env.PLAYWRIGHT_THERAPIST_PASSWORD;

  if (!adminEmail || !adminPassword || !therapistEmail || !therapistPassword) {
    throw new Error(
      'Missing credentials. Set admin and therapist credentials via PW_ADMIN_*/PW_THERAPIST_* env vars.',
    );
  }

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const mobile = devices['iPhone 13'];

  try {
    // Admin smoke: can reach monitoring route on mobile.
    const adminContext = await browser.newContext({
      ...mobile,
    });
    const adminPage = await adminContext.newPage();
    await login(adminPage, baseUrl, adminEmail, adminPassword);
    await adminPage.goto(`${baseUrl}/monitoring`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForSelector('text=Real-Time Performance Monitoring', { timeout: 15000 });
    await adminContext.close();

    // Therapist smoke: blocked from monitoring and can access schedule.
    const therapistContext = await browser.newContext({
      ...mobile,
    });
    const therapistPage = await therapistContext.newPage();
    await login(therapistPage, baseUrl, therapistEmail, therapistPassword);
    await therapistPage.goto(`${baseUrl}/schedule`, { waitUntil: 'domcontentloaded' });
    await therapistPage.waitForSelector('main, [role="main"], h1', { timeout: 15000 });
    await therapistPage.goto(`${baseUrl}/monitoring`, { waitUntil: 'domcontentloaded' });
    await therapistPage.waitForURL(/\/unauthorized/, { timeout: 15000 });
    await therapistContext.close();

    console.log('Playwright mobile role smoke passed');
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error('Playwright mobile role smoke failed', error);
  process.exitCode = 1;
});
