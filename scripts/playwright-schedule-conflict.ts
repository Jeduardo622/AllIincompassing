import { chromium, type Page } from 'playwright';

import { loadPlaywrightEnv } from './lib/load-playwright-env';
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  hasSupabaseAuthToken,
  loginAndAssertSession,
} from './lib/playwright-smoke';

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
  const credentialCandidates = [
    {
      email: process.env.PW_SCHEDULE_EMAIL,
      password: process.env.PW_SCHEDULE_PASSWORD,
      label: 'PW_SCHEDULE_EMAIL + PW_SCHEDULE_PASSWORD',
    },
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
    {
      email: process.env.PW_THERAPIST_EMAIL ?? process.env.PLAYWRIGHT_THERAPIST_EMAIL,
      password: process.env.PW_THERAPIST_PASSWORD ?? process.env.PLAYWRIGHT_THERAPIST_PASSWORD,
      label: 'PW_THERAPIST_EMAIL + PW_THERAPIST_PASSWORD',
    },
  ].filter((entry) => Boolean(entry.email && entry.password));

  if (credentialCandidates.length === 0) {
    throw new Error(
      'Missing schedule credentials. Set PW_SCHEDULE_EMAIL/PW_SCHEDULE_PASSWORD or admin/therapist Playwright credentials.',
    );
  }

  const browser = await chromium.launch({ headless });
  const attemptFailures: string[] = [];
  let authenticatedEmail: string | undefined;
  let context: import('playwright').BrowserContext | undefined;
  let page: Page | undefined;

  try {
    for (const candidate of credentialCandidates) {
      if (!candidate.email || !candidate.password) {
        continue;
      }
      if (/client/i.test(candidate.email)) {
        attemptFailures.push(`${candidate.label}: rejected because account appears to be a client persona.`);
        continue;
      }
      const attemptContext = await browser.newContext();
      const attemptPage = await attemptContext.newPage();
      try {
        await loginAndAssertSession(attemptPage, base, candidate.email, candidate.password);
        await assertRouteAccessible(attemptPage, base, '/schedule');
        const tokenDetected = await hasSupabaseAuthToken(attemptPage);
        if (!tokenDetected) {
          throw new Error('Supabase auth token missing after successful login.');
        }
        authenticatedEmail = candidate.email;
        context = attemptContext;
        page = attemptPage;
        break;
      } catch (error) {
        attemptFailures.push(
          `${candidate.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await attemptContext.close();
      }
    }

    if (!authenticatedEmail || !context || !page) {
      throw new Error(
        `No provided credential set can access /schedule. Attempts: ${attemptFailures.join(' || ')}`,
      );
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
    await page.waitForSelector('text=Schedule', { timeout: 15000 });
    await openSessionModal(page);

    const therapistId = await ensureOption(page, '#therapist-select');
    const clientId = await ensureOption(page, '#client-select');
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

    const conflictNotice = page
      .getByText(/session not saved|scheduling conflicts|slot already taken/i)
      .first();
    await conflictNotice.waitFor({ state: 'visible', timeout: 5000 });
    await page
      .getByText(/slot already taken|not available|no alternative times/i)
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });

    await page.waitForTimeout(250);
    const therapistValue = await page.locator('#therapist-select').inputValue();
    const clientValue = await page.locator('#client-select').inputValue();
    const currentStartValue = await startTimeInput.inputValue();
    const currentEndValue = await endTimeInput.inputValue();

    if (!therapistValue) {
      throw new Error('Therapist selection cleared after conflict');
    }
    if (!clientValue) {
      throw new Error('Client selection cleared after conflict');
    }
    if (!currentStartValue) {
      throw new Error('Start time cleared after conflict');
    }
    if (!currentEndValue) {
      throw new Error('End time cleared after conflict');
    }

    console.log('Playwright schedule conflict retry hint verified');
  } catch (error) {
    const shotPath = page
      ? await captureFailureScreenshot(page, 'playwright-schedule-conflict-failure')
      : 'N/A';
    console.error('Conflict retry hint regression failed. Screenshot:', shotPath);
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

