import { chromium } from 'playwright';

import { loadPlaywrightEnv } from './lib/load-playwright-env';
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  loginAndAssertSession,
  preflightCredentials,
} from './lib/playwright-smoke';

async function run() {
  loadPlaywrightEnv();
  const headless = process.env.HEADLESS !== 'false';
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  const base = process.env.PW_BASE_URL ?? 'https://app.allincompassing.ai';
  const credentials = preflightCredentials([
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
  ]);

  try {
    await loginAndAssertSession(page, base, credentials.email, credentials.password);
    await assertRouteAccessible(page, base, '/dashboard');
    console.log('Playwright auth smoke passed');
  } catch (error) {
    const screenshot = await captureFailureScreenshot(page, 'playwright-auth-smoke-failure');
    console.error(`Auth smoke failed. Screenshot: ${screenshot}`);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch(async (err) => {
  console.error('Playwright auth smoke failed', err);
  process.exit(1);
});


