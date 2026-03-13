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
      if (current === value || current.length > 0) {
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
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.waitForSelector("input[type='password']", { timeout: 10000 });
  await page.getByText(LOGIN_HEADING_PATTERN).first().waitFor({ timeout: 5000 }).catch(() => undefined);

  await fillWithFallbacks(
    [
      page.getByLabel(/email address/i),
      page.getByLabel(/^email$/i),
      page.locator("form input[autocomplete='email']"),
      page.locator("form input[type='email']"),
      page.locator("form input[name*='email' i]"),
      page.locator("input#email"),
      page.locator("input:not([type='password'])"),
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
    const offLoginPath = !/\/login(\?|$)/i.test(new URL(currentUrl).pathname);
    const hasToken = await hasSupabaseAuthToken(page);
    if (offLoginPath || hasToken) {
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
): Promise<void> => {
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const pathname = new URL(page.url()).pathname.toLowerCase();
  if (pathname.includes("/login") || pathname.includes("/unauthorized")) {
    throw new Error(`Authenticated user cannot access required route ${routePath}. Current path: ${pathname}`);
  }
};
