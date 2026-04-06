import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

const LOGIN_HEADING_PATTERN = /sign in to allincompassing/i;
const AUTH_TOKEN_KEY_PATTERN = /auth.*token|sb-.*-auth-token|supabase.*auth/i;

export const ensureArtifactsDir = (): string => {
  const latestDir = path.resolve(process.cwd(), "artifacts", "latest");
  if (!fs.existsSync(latestDir)) {
    fs.mkdirSync(latestDir, { recursive: true });
  }
  return latestDir;
};

export const captureFailureScreenshot = async (
  page: Page,
  prefix: string,
): Promise<string> => {
  const latestDir = ensureArtifactsDir();
  const screenshotPath = path.join(latestDir, `${prefix}-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  return screenshotPath;
};

export const hasSupabaseAuthToken = async (page: Page): Promise<boolean> => {
  return page.evaluate((pattern) => {
    const regex = new RegExp(pattern, "i");
    const localKeys = Object.keys(window.localStorage);
    const sessionKeys = Object.keys(window.sessionStorage);
    const localHasToken = localKeys.some((key) => regex.test(key) && Boolean(window.localStorage.getItem(key)));
    const sessionHasToken = sessionKeys.some((key) => regex.test(key) && Boolean(window.sessionStorage.getItem(key)));
    return localHasToken || sessionHasToken;
  }, AUTH_TOKEN_KEY_PATTERN.source);
};

export const fillWithFallbacks = async (
  candidates: Array<ReturnType<Page["locator"]>>,
  value: string,
  label: string,
): Promise<void> => {
  const expected = value.trim();
  const expectCaseInsensitive = label.toLowerCase() === "email";
  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      if (count === 0) {
        continue;
      }
      const target = candidate.first();
      await target.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
      await target.scrollIntoViewIfNeeded();
      await target.fill("");
      await target.type(value, { delay: 20 });
      const current = await target.inputValue().catch(() => "");
      const normalizedCurrent = current.trim();
      const matches = expectCaseInsensitive
        ? normalizedCurrent.toLowerCase() === expected.toLowerCase()
        : normalizedCurrent === expected;
      if (matches) {
        return;
      }
    } catch {
      // Try next selector
    }
  }
  throw new Error(`Could not locate or fill ${label} field on login page.`);
};

export const preflightCredentials = (pairs: Array<{ email?: string; password?: string; label: string }>) => {
  for (const pair of pairs) {
    if (pair.email && pair.password) {
      return { email: pair.email, password: pair.password, label: pair.label };
    }
  }
  const options = pairs.map((pair) => pair.label).join(" | ");
  throw new Error(`Missing required credentials. Provide one of: ${options}`);
};

export const assertUuid = (value: string | undefined, label: string): string => {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  const uuidV4Like = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidV4Like.test(value)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
  return value;
};

export const loginAndAssertSession = async (
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const currentPath = new URL(page.url()).pathname.toLowerCase();
  if (!/\/login(?:\/|$)/i.test(currentPath) && (await hasSupabaseAuthToken(page))) {
    return;
  }
  await page.waitForSelector("input[type='password']", { timeout: 20000 });
  await page.getByText(LOGIN_HEADING_PATTERN).first().waitFor({ timeout: 5000 }).catch(() => undefined);

  await fillWithFallbacks(
    [
      page.getByLabel(/email address/i),
      page.getByLabel(/^email$/i),
      page.locator("form input[autocomplete='email']"),
      page.locator("form input[type='email']"),
      page.locator("form input[name*='email' i]"),
      page.locator("input[autocomplete='email']"),
      page.locator("input[type='email']"),
      page.locator("input[name*='email' i]"),
      page.locator("input[placeholder*='email' i]"),
      page.locator("input#email"),
    ],
    email,
    "email",
  );

  await fillWithFallbacks(
    [
      page.getByLabel(/password/i),
      page.locator("input[type='password']"),
      page.locator("input[name~='password' i]"),
      page.locator("input[placeholder*='password' i]"),
      page.locator("input#password"),
    ],
    password,
    "password",
  );

  const submitButton = page
    .getByRole("button", { name: /sign in|log in|continue|submit/i })
    .or(page.locator("form button[type='submit']"))
    .first();
  await submitButton.click();

  const waitUntil = Date.now() + 20000;
  let authenticated = false;
  while (Date.now() < waitUntil) {
    const currentUrl = page.url();
    const pathname = new URL(currentUrl).pathname.toLowerCase();
    const offLoginPath = !/\/login(\?|$)/i.test(pathname);
    const unauthorizedPath = pathname.includes("/unauthorized");
    const hasToken = await hasSupabaseAuthToken(page);
    if ((offLoginPath && !unauthorizedPath) || hasToken) {
      authenticated = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  if (!authenticated) {
    const loginErrors = await page
      .locator("[role='alert'], .error, .toast, [data-testid*='error'], [class*='error']")
      .allInnerTexts()
      .catch(() => []);
    const errorDetail = loginErrors.length > 0 ? ` UI errors: ${loginErrors.join(" | ")}` : "";
    throw new Error(`Login did not complete for ${email}.${errorDetail}`);
  }
};

export const assertRouteAccessible = async (
  page: Page,
  baseUrl: string,
  routePath: string,
  options?: {
    readySelector?: string;
    timeoutMs?: number;
  },
): Promise<void> => {
  const readySelector = options?.readySelector;
  const timeoutMs = options?.timeoutMs ?? 15000;
  const maxAttempts = 3;
  let lastPath = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.goto(`${baseUrl}${routePath}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const pathname = new URL(page.url()).pathname.toLowerCase();
    lastPath = pathname;

    const routePathNormalized = routePath.toLowerCase();
    const onExpectedRoute =
      pathname === routePathNormalized ||
      pathname.startsWith(`${routePathNormalized}/`) ||
      pathname.startsWith(`${routePathNormalized}?`);

    if (!pathname.includes("/login") && !pathname.includes("/unauthorized") && onExpectedRoute) {
      if (readySelector) {
        const ready = await page.locator(readySelector).first().isVisible().catch(() => false);
        if (!ready && attempt < maxAttempts) {
          await page.waitForTimeout(1000);
          continue;
        }
        if (!ready) {
          throw new Error(
            `Route ${routePath} loaded but readiness selector was not visible: ${readySelector}`,
          );
        }
      }
      return;
    }

    // Give auth/profile hydration a bounded chance before hard-failing.
    if (attempt < maxAttempts && pathname.includes("/unauthorized")) {
      await page.waitForTimeout(1500);
      continue;
    }
    break;
  }

  if (lastPath.includes("/login") || lastPath.includes("/unauthorized")) {
    throw new Error(`Authenticated user cannot access required route ${routePath}. Current path: ${lastPath}`);
  }
  throw new Error(`Failed to reach expected route ${routePath}. Current path: ${lastPath}`);
};

export const waitForSelectOptions = async (
  page: Page,
  selector: string,
  options?: { timeoutMs?: number; minOptions?: number },
): Promise<string[]> => {
  const timeoutMs = options?.timeoutMs ?? 15000;
  const minOptions = options?.minOptions ?? 1;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const values = await page.evaluate((targetSelector) => {
      const select = document.querySelector(targetSelector) as HTMLSelectElement | null;
      if (!select) {
        return [] as string[];
      }
      return Array.from(select.options)
        .map((option) => option.value)
        .filter((value) => value.trim().length > 0);
    }, selector);

    if (values.length >= minOptions) {
      return values;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for selectable options in ${selector}`);
};
