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

async function getOptionValues(page: Page, selector: string): Promise<string[]> {
  const options = await page.locator(`${selector} option:not([value=""])`).all();
  const values: string[] = [];
  for (const option of options) {
    const value = await option.getAttribute('value');
    if (value) {
      values.push(value);
    }
  }
  return values;
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

    let interceptedBookingPosts = 0;
    await page.route('**/api/book*', async (route) => {
      if (route.request().method().toUpperCase() !== 'POST') {
        await route.continue();
        return;
      }
      interceptedBookingPosts += 1;

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

    const therapistValues = await getOptionValues(page, '#therapist-select');
    const clientValues = await getOptionValues(page, '#client-select');
    if (therapistValues.length === 0 || clientValues.length === 0) {
      throw new Error('No therapist/client options available for schedule conflict smoke.');
    }

    let therapistId: string | null = null;
    let clientId: string | null = null;
    let programId: string | null = null;
    let goalId: string | null = null;

    for (const therapistOption of therapistValues) {
      await page.selectOption('#therapist-select', therapistOption);
      for (const clientOption of clientValues) {
        await page.selectOption('#client-select', clientOption);
        await page.waitForTimeout(600);
        const availablePrograms = await getOptionValues(page, '#program-select');
        if (availablePrograms.length === 0) {
          continue;
        }
        await page.selectOption('#program-select', availablePrograms[0]);
        await page.waitForTimeout(300);
        const availableGoals = await getOptionValues(page, '#goal-select');
        if (availableGoals.length === 0) {
          continue;
        }
        await page.selectOption('#goal-select', availableGoals[0]);
        therapistId = therapistOption;
        clientId = clientOption;
        programId = availablePrograms[0];
        goalId = availableGoals[0];
        break;
      }
      if (therapistId && clientId && programId && goalId) {
        break;
      }
    }

    if (!therapistId || !clientId || !programId || !goalId) {
      throw new Error(
        'Could not find a therapist/client combination with at least one active program and goal.',
      );
    }

    const startTimeInput = page.locator('#start-time-input');
    const endTimeInput = page.locator('#end-time-input');

    const targetStart = new Date();
    targetStart.setHours(targetStart.getHours() + 3, 0, 0, 0);
    const startValue = targetStart.toISOString().slice(0, 16);
    const endValue = new Date(targetStart.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);

    await startTimeInput.fill(startValue);
    await endTimeInput.fill(endValue);

    await page.locator('button[type="submit"]').click();

    const bookingResponseSeen = await page.waitForResponse((response) => {
      return response.request().method().toUpperCase() === 'POST'
        && response.url().includes('/api/book');
    }, { timeout: 8000 }).then(() => true).catch(() => false);

    if (!bookingResponseSeen || interceptedBookingPosts === 0) {
      throw new Error('Schedule conflict smoke did not observe a POST /api/book request from the modal submit.');
    }

    await page.waitForTimeout(600);
    const therapistValue = await page.locator('#therapist-select').inputValue();
    const clientValue = await page.locator('#client-select').inputValue();
    const programValue = await page.locator('#program-select').inputValue();
    const goalValue = await page.locator('#goal-select').inputValue();
    const currentStartValue = await startTimeInput.inputValue();
    const currentEndValue = await endTimeInput.inputValue();

    if (!therapistValue) {
      throw new Error('Therapist selection cleared after conflict');
    }
    if (!clientValue) {
      throw new Error('Client selection cleared after conflict');
    }
    if (!programValue) {
      throw new Error('Program selection cleared after conflict');
    }
    if (!goalValue) {
      throw new Error('Goal selection cleared after conflict');
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

