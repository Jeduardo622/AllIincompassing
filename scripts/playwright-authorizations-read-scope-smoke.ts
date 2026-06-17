/**
 * Production (or PW_BASE_URL) smoke: therapist is blocked from /authorizations while
 * org admin can reach /authorizations and expose REST authorizations row counts.
 * Does not mutate data.
 *
 * Env: PW_BASE_URL, PW_THERAPIST_*, PW_ADMIN_* (see scripts/lib/load-playwright-env.ts).
 */
import { chromium } from "playwright";

import { loadPlaywrightEnv, resolvePlaywrightBaseUrl } from "./lib/load-playwright-env";
import { loginAndAssertSession, preflightCredentials } from "./lib/playwright-smoke";

type BlockedPayload = { persona: string; url: string; access: "blocked" };
type CountPayload = {
  persona: string;
  url: string;
  access: "allowed";
  authorizationsRows: number;
  restStatus?: number;
};
type SmokePayload = BlockedPayload | CountPayload;

const assertBlockedFromAuthorizations = async (
  page: import("playwright").Page,
  baseUrl: string,
  persona: string,
): Promise<BlockedPayload> => {
  await page.goto(`${baseUrl.replace(/\/$/, "")}/authorizations`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForURL(/\/unauthorized(?:[/?#]|$)/i, { timeout: 30_000 });

  return {
    persona,
    url: page.url(),
    access: "blocked",
  };
};

const countAuthorizationsFromPage = async (
  page: import("playwright").Page,
  baseUrl: string,
  persona: string,
): Promise<CountPayload> => {
  const authzResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/rest/v1/authorizations") &&
      !response.url().includes("/authorization_services") &&
      response.request().method() === "GET",
    { timeout: 45_000 },
  );

  await page.goto(`${baseUrl.replace(/\/$/, "")}/authorizations`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  let restStatus: number | undefined;
  let rows = 0;
  try {
    const resp = await authzResponsePromise;
    restStatus = resp.status();
    const body: unknown = await resp.json().catch(() => null);
    if (Array.isArray(body)) {
      rows = body.length;
    }
  } catch {
    await page.waitForTimeout(3000);
  }

  const path = new URL(page.url()).pathname.toLowerCase();
  if (path.includes("/login") || path.includes("/unauthorized")) {
    throw new Error(`${persona}: landed on ${page.url()} instead of authorizations`);
  }

  return {
    persona,
    url: page.url(),
    access: "allowed",
    authorizationsRows: rows,
    restStatus,
  };
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  const headless = process.env.HEADLESS !== "false";
  const baseUrl = resolvePlaywrightBaseUrl();

  const therapistCreds = preflightCredentials([
    {
      email: process.env.PW_THERAPIST_EMAIL,
      password: process.env.PW_THERAPIST_PASSWORD,
      label: "PW_THERAPIST_EMAIL + PW_THERAPIST_PASSWORD",
    },
  ]);
  const adminCreds = preflightCredentials([
    {
      email: process.env.PW_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD,
      label: "PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD",
    },
  ]);

  const browser = await chromium.launch({ headless });
  const results: SmokePayload[] = [];

  try {
    const ctxT = await browser.newContext();
    const pageT = await ctxT.newPage();
    try {
      await loginAndAssertSession(pageT, baseUrl, therapistCreds.email, therapistCreds.password);
      results.push(await assertBlockedFromAuthorizations(pageT, baseUrl, "therapist"));
    } finally {
      await ctxT.close();
    }

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    try {
      await loginAndAssertSession(pageA, baseUrl, adminCreds.email, adminCreds.password);
      results.push(await countAuthorizationsFromPage(pageA, baseUrl, "org_admin"));
    } finally {
      await ctxA.close();
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          results,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ ok: false, baseUrl, error: message }));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
