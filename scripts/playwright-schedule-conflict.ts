import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { loadPlaywrightEnv } from './lib/load-playwright-env';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

async function ensureOption(page: Page, selector: string): Promise<string> {
  const options = await page.locator(`${selector} option:not([value=""])`).all();
  if (options.length === 0) {
    throw new Error(`No selectable options found for ${selector}`);
  }

  const value = await options[0].getAttribute('value');
  if (!value) {
    throw new Error(`First option for ${selector} does not expose a value`);
  }

  await page.selectOption(selector, value);
  return value;
}

async function openSessionModal(page: Page) {
  await page.evaluate(() => {
    const now = new Date();
    now.setHours(now.getHours() + 2);
    const detail = { start_time: now.toISOString() };
    window.dispatchEvent(new CustomEvent('openScheduleModal', { detail }));
  });
  const modal = page.locator('[role="dialog"]:has-text("New Session"), [role="dialog"]:has-text("Edit Session")');
  await modal.waitFor({ state: 'visible', timeout: 5000 });
}

async function run() {
  loadPlaywrightEnv();
  const headless = process.env.HEADLESS !== 'false';
  const base = getEnv('PW_BASE_URL', 'https://app.allincompassing.ai');
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
  const resolvedEmail = getEnv('PW_EMAIL', email);
  const resolvedPassword = getEnv('PW_PASSWORD', password);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
    const emailField = page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first();
    const passwordField = page.locator('input[type="password"]').first();
    await emailField.fill('');
    await emailField.type(resolvedEmail, { delay: 15 });
    await passwordField.fill('');
    await passwordField.type(resolvedPassword, { delay: 15 });
    await page.getByRole('button', { name: /sign in|log in|continue|submit/i }).click();

    const authTimeout = Date.now() + 20000;
    let authenticated = false;
    while (Date.now() < authTimeout) {
      const tokenDetected = await page.evaluate(() => {
        const tokens = Object.keys(localStorage).filter(key =>
          /auth.*token|sb-.*-auth-token|supabase.*auth/i.test(key)
        );
        return tokens.some(k => localStorage.getItem(k));
      });
      if (tokenDetected) {
        authenticated = true;
        break;
      }
      await sleep(500);
    }

    if (!authenticated) {
      throw new Error('Failed to detect Supabase auth token after login');
    }

    await page.route('**/api/book', async (route) => {
      if (route.request().method().toUpperCase() !== 'POST') {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Session slot conflict',
          hint: 'Slot already taken. Try another time.',
        }),
      });
    });

    await page.goto(`${base}/schedule`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#therapist-filter', { timeout: 10000 });
    const therapistId = await ensureOption(page, '#therapist-filter');
    const clientId = await ensureOption(page, '#client-filter');

    await openSessionModal(page);

    await page.selectOption('#therapist-select', therapistId);
    await page.selectOption('#client-select', clientId);

    const startTimeInput = page.locator('#start-time-input');
    const endTimeInput = page.locator('#end-time-input');

    const targetStart = new Date();
    targetStart.setHours(targetStart.getHours() + 3, 0, 0, 0);
    const startValue = targetStart.toISOString().slice(0, 16);
    const endValue = new Date(targetStart.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);

    await startTimeInput.fill(startValue);
    await endTimeInput.fill(endValue);

    await page.locator('button[type="submit"]').click();

    const banner = page.getByText('Session not saved');
    await banner.waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText('Slot already taken. Try another time.').waitFor({ state: 'visible', timeout: 5000 });

    await page.waitForTimeout(250);
    const therapistValue = await page.locator('#therapist-select').inputValue();
    const clientValue = await page.locator('#client-select').inputValue();
    const currentStartValue = await startTimeInput.inputValue();
    const currentEndValue = await endTimeInput.inputValue();

    if (therapistValue !== therapistId) {
      throw new Error('Therapist selection changed after conflict');
    }
    if (clientValue !== clientId) {
      throw new Error('Client selection changed after conflict');
    }
    if (currentStartValue !== startValue) {
      throw new Error('Start time changed after conflict');
    }
    if (currentEndValue !== endValue) {
      throw new Error('End time changed after conflict');
    }

    console.log('Playwright schedule conflict retry hint verified');
    await browser.close();
  } catch (error) {
    const outDir = path.join(process.cwd(), 'artifacts', 'latest');
    fs.mkdirSync(outDir, { recursive: true });
    const shotPath = path.join(outDir, `playwright-schedule-conflict-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => undefined);
    await browser.close();
    console.error('Conflict retry hint regression failed. Screenshot:', shotPath);
    throw error;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

