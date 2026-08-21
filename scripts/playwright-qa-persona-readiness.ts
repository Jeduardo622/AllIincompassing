import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type Page, type Request } from "playwright";

import {
  QA_PERSONAS,
  type QaPersonaRole,
  resolvePersonaCredentials,
} from "./provision-persistent-qa-personas";
import {
  hasSupabaseAuthToken,
  loginAndAssertSession,
  routeMatchesPathname,
} from "./lib/playwright-smoke";

export const WIN_43_ISSUE = "WIN-43";
export const DEFAULT_PLAYWRIGHT_BASE_URL = "https://app.allincompassing.ai";
export const QA_PERSONA_READINESS_MANIFEST_ENV = "QA_PERSONA_READINESS_MANIFEST_PATH";
export const PERSONA_READINESS_TIMEOUT_MS = 120_000;

export type ReadinessStatus = "allowed_ok" | "denied_ok" | "failed";
export type ReadinessStage = "browser_setup" | "login" | "allowed_route" | "denied_route" | "sign_out";

export type ReadinessManifestEntry = {
  role: QaPersonaRole;
  route: string;
  settledPath: string;
  title: string;
  timingMs: number;
  status: ReadinessStatus;
  stage: ReadinessStage;
};

type ReadinessManifest = {
  ok: boolean;
  issue: typeof WIN_43_ISSUE;
  generatedAt: string;
  results: ReadinessManifestEntry[];
};

export type PersonaRouteAssertion = {
  role: QaPersonaRole;
  allowedRoute: string;
  deniedRoute: string;
};

export type RenderedRouteState = {
  hasErrorBoundary: boolean;
  hasPendingGuard: boolean;
  hasRouteContentContainer: boolean;
  hasMeaningfulRouteContent: boolean;
  hasMeaningfulMain: boolean;
  hasMeaningfulBody: boolean;
};

export const QA_PERSONA_ROUTE_ASSERTIONS: readonly PersonaRouteAssertion[] = [
  { role: "bt", allowedRoute: "/account", deniedRoute: "/payroll" },
  { role: "therapist", allowedRoute: "/schedule", deniedRoute: "/monitoring" },
  { role: "bcba", allowedRoute: "/account", deniedRoute: "/payroll" },
  { role: "midtier", allowedRoute: "/schedule", deniedRoute: "/payroll" },
  { role: "admin_schedule", allowedRoute: "/schedule", deniedRoute: "/payroll" },
  { role: "client", allowedRoute: "/documentation", deniedRoute: "/payroll" },
  { role: "admin", allowedRoute: "/account", deniedRoute: "/super-admin/feature-flags" },
  { role: "super_admin", allowedRoute: "/account", deniedRoute: "/family" },
] as const;

const STATIC_SAFE_PATHS = new Set([
  "/",
  "/account",
  "/documentation",
  "/family",
  "/login",
  "/monitoring",
  "/payroll",
  "/schedule",
  "/super-admin/feature-flags",
  "/unauthorized",
]);

const STATIC_SAFE_TITLES = new Set([
  "My Account | AllIncompassing",
  "Documentation | AllIncompassing",
  "Schedule | AllIncompassing",
  "Unauthorized | AllIncompassing",
]);

const SYNTHETIC_ROUTE_RPC_PATHS = new Set([
  "/rest/v1/rpc/get_dropdown_data",
  "/rest/v1/rpc/get_schedule_data_batch",
  "/rest/v1/rpc/get_sessions_optimized",
  "/rest/v1/rpc/get_supervision_session_note_action_count",
]);

const SYNTHETIC_APP_READ_ACTIONS = new Map([
  ["/api/payroll-administration", "get_administration"],
  ["/api/payroll-approvals", "review_queue"],
  ["/api/payroll-time-events", "get_day"],
]);

const getEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

export const resolvePlaywrightBaseUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  assertApprovedBaseUrl(env.PW_BASE_URL?.trim() || DEFAULT_PLAYWRIGHT_BASE_URL);

export const assertApprovedBaseUrl = (value: string): string => {
  const candidate = new URL(value);
  const approved = new URL(DEFAULT_PLAYWRIGHT_BASE_URL);
  if (candidate.origin !== approved.origin
    || candidate.pathname.replace(/\/+$/, "")
    || candidate.search
    || candidate.hash
    || candidate.username
    || candidate.password) {
    throw new Error("PW_BASE_URL must be the approved production origin.");
  }
  return candidate.origin;
};

export const resolveSupabaseAuthOrigin = (env: NodeJS.ProcessEnv = process.env): string => {
  const candidate = new URL(getEnv("SUPABASE_URL", env));
  if (candidate.protocol !== "https:" || candidate.username || candidate.password) {
    throw new Error("SUPABASE_URL must provide an approved HTTPS Auth origin.");
  }
  return candidate.origin;
};

export const sanitizeTitle = (value: string): string =>
  STATIC_SAFE_TITLES.has(value.replace(/\s+/g, " ").trim())
    ? value.replace(/\s+/g, " ").trim()
    : "";

export const sanitizeSettledPath = (value: string): string => {
  const normalized = value.toLowerCase().replace(/\/+$/, "") || "/";
  return STATIC_SAFE_PATHS.has(normalized) ? normalized : "redacted";
};

const safePathname = (page: Page): string => {
  try {
    return sanitizeSettledPath(new URL(page.url()).pathname);
  } catch {
    return "unknown";
  }
};

const safeTitle = async (page: Page): Promise<string> => {
  try {
    return sanitizeTitle(await page.title());
  } catch {
    return "";
  }
};

export const buildManifestEntry = (input: ReadinessManifestEntry): ReadinessManifestEntry => ({
  ...input,
  settledPath: sanitizeSettledPath(input.settledPath),
  title: sanitizeTitle(input.title),
  timingMs: Math.max(0, Math.round(input.timingMs)),
});

export const isRenderedRouteReady = (
  state: RenderedRouteState,
  requireRouteContent: boolean,
): boolean => !state.hasErrorBoundary
  && !state.hasPendingGuard
  && (requireRouteContent
    ? state.hasRouteContentContainer && state.hasMeaningfulRouteContent
    : state.hasMeaningfulMain || state.hasMeaningfulBody);

const writeManifest = (manifest: ReadinessManifest, env: NodeJS.ProcessEnv): void => {
  const manifestPath = getEnv(QA_PERSONA_READINESS_MANIFEST_ENV, env);
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

const buildManifest = (results: ReadinessManifestEntry[]): ReadinessManifest => ({
  ok: results.length === QA_PERSONAS.length * 2 && results.every((entry) => entry.status !== "failed"),
  issue: WIN_43_ISSUE,
  generatedAt: new Date().toISOString(),
  results: [...results],
});

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Persona readiness exceeded its bounded runtime.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const waitForPath = async (
  page: Page,
  expectedRoute: string,
  expectedOrigin: string,
  timeoutMs = 20_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentUrl = new URL(page.url());
    if (currentUrl.origin === expectedOrigin
      && routeMatchesPathname(currentUrl.pathname, expectedRoute)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Route did not settle on ${expectedRoute}.`);
};

const readRenderedRouteState = async (page: Page): Promise<RenderedRouteState> => page.evaluate(() => {
  const normalize = (value: string | null | undefined): string => value?.replace(/\s+/g, " ").trim() ?? "";
  const main = document.querySelector("main, [role='main']");
  const routeContent = document.querySelector("[data-route-content]");
  const errorHeading = Array.from(document.querySelectorAll("h1"))
    .some((heading) => normalize(heading.textContent) === "Something went wrong");
  const pendingLabel = Array.from(document.querySelectorAll("[role='status'][aria-label]"))
    .some((element) => /^(Checking (role )?access|Loading page content|Restoring your secure session)/i
      .test(element.getAttribute("aria-label") ?? ""));

  return {
    hasErrorBoundary: errorHeading
      || Boolean(document.querySelector("[data-testid='error-boundary'], .error-boundary")),
    hasPendingGuard: pendingLabel
      || Boolean(document.querySelector("[data-testid='protected-shell-pending']")),
    hasRouteContentContainer: Boolean(routeContent),
    hasMeaningfulRouteContent: Boolean(normalize(routeContent?.textContent)),
    hasMeaningfulMain: Boolean(normalize(main?.textContent)),
    hasMeaningfulBody: Boolean(normalize(document.body?.innerText)),
  };
});

const waitForRenderedRoute = async (
  page: Page,
  requireRouteContent: boolean,
  timeoutMs = 10_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isRenderedRouteReady(await readRenderedRouteState(page), requireRouteContent)) return;
    await page.waitForTimeout(250);
  }
  throw new Error("Route did not render a stable non-error document state.");
};

export type ProtectedRequestAction = "continue" | "fulfill_synthetic_read" | "block";
export type SyntheticReadResponse = { status: number; contentType: string; body: string };

export const classifyProtectedRequest = (
  request: Pick<Request, "method" | "url" | "postData">,
  approvedAuthOrigin: string,
  approvedAppOrigin: string,
): ProtectedRequestAction => {
  const method = request.method().toUpperCase();
  const requestUrl = new URL(request.url());
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return [approvedAuthOrigin, approvedAppOrigin].includes(requestUrl.origin) ? "continue" : "block";
  }
  if (method === "POST" && requestUrl.origin === approvedAuthOrigin) {
    if (["/auth/v1/token", "/auth/v1/logout"].includes(requestUrl.pathname)) return "continue";
    if (SYNTHETIC_ROUTE_RPC_PATHS.has(requestUrl.pathname)) return "fulfill_synthetic_read";
  }
  if (method === "POST" && requestUrl.origin === approvedAppOrigin) {
    const expectedAction = SYNTHETIC_APP_READ_ACTIONS.get(requestUrl.pathname);
    if (expectedAction) {
      try {
        const payload = JSON.parse(request.postData() ?? "") as { action?: unknown };
        if (payload.action === expectedAction) return "fulfill_synthetic_read";
      } catch {
        return "block";
      }
    }
  }
  return "block";
};

export const syntheticReadResponseFor = (url: string): SyntheticReadResponse => {
  const pathname = new URL(url).pathname;
  if (pathname === "/rest/v1/rpc/get_schedule_data_batch") {
    return {
      status: 200,
      contentType: "application/json",
      body: '{"sessions":[],"therapists":[],"clients":[]}',
    };
  }
  if (pathname === "/rest/v1/rpc/get_dropdown_data") {
    return {
      status: 200,
      contentType: "application/json",
      body: '{"therapists":[],"clients":[],"locations":[]}',
    };
  }
  if (SYNTHETIC_ROUTE_RPC_PATHS.has(pathname)) {
    return {
      status: 200,
      contentType: "application/json",
      body: pathname.endsWith("/get_supervision_session_note_action_count") ? "0" : "[]",
    };
  }
  if (pathname === "/api/payroll-time-events") {
    return { status: 200, contentType: "application/json", body: '{"state":"feature_disabled"}' };
  }
  if (pathname === "/api/payroll-approvals") {
    return {
      status: 200,
      contentType: "application/json",
      body: '{"state":"feature_disabled","selectedLocalDate":"2000-01-01","capabilities":{"canReviewAssigned":false,"canApproveAssigned":false,"canViewCompensation":false,"hasOrgPayrollAccess":false},"queue":[]}',
    };
  }
  if (pathname === "/api/payroll-administration") {
    return { status: 503, contentType: "application/json", body: '{"error":"readiness_synthetic_disabled"}' };
  }
  throw new Error("Unsupported synthetic read path.");
};

const installApplicationMutationGuard = async (
  page: Page,
  approvedAuthOrigin: string,
  approvedAppOrigin: string,
): Promise<() => void> => {
  let blockedMutation = false;
  await page.route("**/*", async (route) => {
    const action = classifyProtectedRequest(route.request(), approvedAuthOrigin, approvedAppOrigin);
    if (action === "fulfill_synthetic_read") {
      await route.fulfill(syntheticReadResponseFor(route.request().url()));
      return;
    }
    if (action === "block") {
      blockedMutation = true;
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return () => {
    if (blockedMutation) throw new Error("Authenticated route attempted a forbidden mutation request.");
  };
};

const checkAllowedRoute = async (
  page: Page,
  baseUrl: string,
  config: PersonaRouteAssertion,
): Promise<ReadinessManifestEntry> => {
  const startedAt = Date.now();
  await page.goto(`${baseUrl}${config.allowedRoute}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await waitForPath(page, config.allowedRoute, new URL(baseUrl).origin);
  await waitForRenderedRoute(page, true);
  return buildManifestEntry({
    role: config.role,
    route: config.allowedRoute,
    settledPath: safePathname(page),
    title: await safeTitle(page),
    timingMs: Date.now() - startedAt,
    status: "allowed_ok",
    stage: "allowed_route",
  });
};

const checkDeniedRoute = async (
  page: Page,
  baseUrl: string,
  config: PersonaRouteAssertion,
): Promise<ReadinessManifestEntry> => {
  const startedAt = Date.now();
  await page.goto(`${baseUrl}${config.deniedRoute}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await waitForPath(page, "/unauthorized", new URL(baseUrl).origin);
  await waitForRenderedRoute(page, false);
  return buildManifestEntry({
    role: config.role,
    route: config.deniedRoute,
    settledPath: safePathname(page),
    title: await safeTitle(page),
    timingMs: Date.now() - startedAt,
    status: "denied_ok",
    stage: "denied_route",
  });
};

const signOutAndAssertRevoked = async (
  page: Page,
  baseUrl: string,
  allowedRoute: string,
): Promise<void> => {
  await page.goto(`${baseUrl}${allowedRoute}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForPath(page, allowedRoute, new URL(baseUrl).origin);
  await waitForRenderedRoute(page, true);

  const [response] = await Promise.all([
    page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === "POST" && new URL(candidate.url()).pathname.endsWith("/auth/v1/logout");
    }, { timeout: 20_000 }),
    page.getByRole("button", { name: /^sign out$/i }).click({ timeout: 10_000 }),
  ]);
  if (!response.ok()) throw new Error("Supabase session revocation request failed.");
  await waitForPath(page, "/login", new URL(baseUrl).origin);
  if (await hasSupabaseAuthToken(page)) throw new Error("Browser auth token remained after sign out.");
};

const failureEntry = async (
  role: QaPersonaRole,
  route: string,
  stage: ReadinessStage,
  startedAt: number,
  page?: Page,
): Promise<ReadinessManifestEntry> => buildManifestEntry({
  role,
  route,
  settledPath: page ? safePathname(page) : "unknown",
  title: page ? await safeTitle(page) : "",
  timingMs: Date.now() - startedAt,
  status: "failed",
  stage,
});

const assertionFor = (role: QaPersonaRole): PersonaRouteAssertion => {
  const assertion = QA_PERSONA_ROUTE_ASSERTIONS.find((entry) => entry.role === role);
  if (!assertion) throw new Error(`Unsupported QA readiness role: ${role}`);
  return assertion;
};

export const runReadiness = async (env: NodeJS.ProcessEnv = process.env): Promise<ReadinessManifest> => {
  const baseUrl = resolvePlaywrightBaseUrl(env);
  const approvedAuthOrigin = resolveSupabaseAuthOrigin(env);
  const results: ReadinessManifestEntry[] = [];
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: env.HEADLESS !== "false" });
    for (const persona of QA_PERSONAS) {
      const config = assertionFor(persona.role);
      const context = await browser.newContext({ serviceWorkers: "block" }).catch(() => undefined);
      const page = context ? await context.newPage().catch(() => undefined) : undefined;
      let stage: ReadinessStage = "login";
      let startedAt = Date.now();

      try {
        if (!context || !page) throw new Error("Browser context unavailable.");
        await withTimeout((async () => {
          const credentials = resolvePersonaCredentials(persona, env);
          const assertNoApplicationMutation = await installApplicationMutationGuard(
            page,
            approvedAuthOrigin,
            new URL(baseUrl).origin,
          );
          await loginAndAssertSession(
            page,
            baseUrl,
            credentials.email,
            credentials.password,
            { expectedOrigin: new URL(baseUrl).origin },
          );
          stage = "allowed_route";
          startedAt = Date.now();
          results.push(await checkAllowedRoute(page, baseUrl, config));
          stage = "denied_route";
          startedAt = Date.now();
          results.push(await checkDeniedRoute(page, baseUrl, config));
          stage = "sign_out";
          startedAt = Date.now();
          await signOutAndAssertRevoked(page, baseUrl, config.allowedRoute);
          assertNoApplicationMutation();
        })(), PERSONA_READINESS_TIMEOUT_MS);
      } catch {
        results.push(await failureEntry(
          persona.role,
          stage === "denied_route" ? config.deniedRoute : config.allowedRoute,
          stage,
          startedAt,
          page,
        ));
      } finally {
        await context?.close().catch(() => undefined);
        writeManifest(buildManifest(results), env);
      }
    }
  } catch {
    results.push(await failureEntry("bt", "/", "browser_setup", Date.now()));
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const manifest = buildManifest(results);
  writeManifest(manifest, env);
  return manifest;
};

export const main = async (): Promise<void> => {
  if (!(await runReadiness(process.env)).ok) throw new Error("Playwright QA persona readiness failed.");
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
  && process.env.VITEST !== "true";

if (isDirectRun) {
  main().catch(() => {
    console.error(JSON.stringify({
      ok: false,
      error: "Playwright QA persona readiness failed; inspect the sanitized manifest and protected run logs.",
    }));
    process.exit(1);
  });
}
