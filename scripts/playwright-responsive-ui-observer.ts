import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import {
  OBSERVER_VIEWPORTS,
  type LayoutMetrics,
  type ObserverArgs,
  type ObserverViewport,
  buildEvidenceCard,
  classifyLayout,
  parseObserverArgs,
  sanitizeObserverFailures,
  sha256,
} from './lib/responsive-ui-observer';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NAVIGATION_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 5_000;
const EXTRA_SETTLE_MS = 250;
const INTERACTIVE_CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[contenteditable="true"]',
].join(', ');

export const RESPONSIVE_CAPTURE_REDACTION_CSS = `
  *, *::before, *::after {
    color: transparent !important;
    caret-color: transparent !important;
    text-shadow: none !important;
    background-image: none !important;
  }
  img, picture, video, canvas, svg, iframe, object, embed {
    visibility: hidden !important;
  }
`;

type ObserverRunSummary = {
  ok: boolean;
  baseUrl: string;
  results: Array<{
    routeId: string;
    viewportName: ObserverViewport['name'];
    result: 'pass' | 'fail';
    failureCodes: string[];
    screenshotPath: string;
    evidencePath: string;
  }>;
};

export const buildFatalObserverSummary = (_error: unknown): ObserverRunSummary => ({
  ok: false,
  baseUrl: '',
  results: [],
});

type ObserverDependencies = {
  launchBrowser: () => Promise<Browser>;
  ensureDir: (dirPath: string) => Promise<void>;
  writeBinary: (filePath: string, payload: Uint8Array) => Promise<void>;
  writeText: (filePath: string, payload: string) => Promise<void>;
};

type RouteObservation = {
  routeId: string;
  viewportName: ObserverViewport['name'];
  result: 'pass' | 'fail';
  failureCodes: string[];
  screenshotPath: string;
  evidencePath: string;
};

const defaultDependencies: ObserverDependencies = {
  launchBrowser: () => chromium.launch({ headless: true }),
  ensureDir: (dirPath) => mkdir(dirPath, { recursive: true }),
  writeBinary: (filePath, payload) => writeFile(filePath, payload),
  writeText: (filePath, payload) => writeFile(filePath, payload, 'utf8'),
};

const artifactAbsolutePath = (relativePath: string): string => path.resolve(relativePath);

const isSameOrigin = (value: string, origin: string): boolean => {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
};

export const collectLayoutMetrics = async (page: Page): Promise<LayoutMetrics> =>
  page.evaluate((interactiveControlSelector) => {
    const horizontalOverflow = Math.ceil(
      Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      ),
    ) > Math.ceil(window.innerWidth);

    const visibleControls = Array.from(
      document.querySelectorAll<HTMLElement>(
        interactiveControlSelector,
      ),
    )
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0;
      });

    const clippedFixedControls = visibleControls
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (style.position === 'fixed' || style.position === 'sticky') && (
          rect.left < 0
          || rect.top < 0
          || rect.right > window.innerWidth
          || rect.bottom > window.innerHeight
        );
      })
      .map((_, index) => `fixed-control-${index + 1}`);

    const visibleTouchTargets = visibleControls.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });

    return {
      horizontalOverflow,
      clippedFixedControls,
      visibleTouchTargets,
    };
  }, INTERACTIVE_CONTROL_SELECTOR);

export const redactPageForCapture = async (page: Page): Promise<void> => {
  await page.addStyleTag({ content: RESPONSIVE_CAPTURE_REDACTION_CSS });
};

const observeRouteAtViewport = async (
  browser: Browser,
  parsedArgs: ObserverArgs,
  route: string,
  viewport: ObserverViewport,
  deps: ObserverDependencies,
): Promise<RouteObservation> => {
  const baseOrigin = new URL(parsedArgs.baseUrl).origin;
  const targetUrl = `${parsedArgs.baseUrl}${route}`;
  const failures: string[] = [];
  let metrics: LayoutMetrics = {
    horizontalOverflow: false,
    clippedFixedControls: [],
    visibleTouchTargets: [],
  };

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.name === 'mobile',
    hasTouch: viewport.name === 'mobile',
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
  });

  try {
    await context.route('**/*', async (routeHandler) => {
      const request = routeHandler.request();
      const requestUrl = request.url();
      const method = request.method().toUpperCase();

      if (!ALLOWED_METHODS.has(method)) {
        failures.push('method blocked: non-read method');
        await routeHandler.abort('blockedbyclient');
        return;
      }

      if (!isSameOrigin(requestUrl, baseOrigin)) {
        failures.push('external origin request blocked');
        await routeHandler.abort('blockedbyclient');
        return;
      }

      await routeHandler.continue();
    });

    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        failures.push('console error detected');
      }
    });
    page.on('pageerror', () => {
      failures.push('pageerror detected');
    });
    page.on('requestfailed', (request) => {
      if (isSameOrigin(request.url(), baseOrigin)) {
        failures.push('request failed on same origin');
      }
    });

    try {
      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      if (!response || response.status() >= 400) {
        failures.push('http response failed');
      }
    } catch {
      failures.push('navigation failed');
    }

    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
    await page.waitForTimeout(EXTRA_SETTLE_MS);
    try {
      metrics = await collectLayoutMetrics(page);
      failures.push(...classifyLayout(metrics, viewport.name));
    } catch {
      failures.push('layout evaluation failed');
    }

    await redactPageForCapture(page);
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: 'png',
    });
    const screenshotHash = sha256(screenshotBuffer);

    const evidenceSeed = buildEvidenceCard({
      route,
      viewportName: viewport.name,
      result: failures.length > 0 ? 'fail' : 'pass',
      failures,
      metrics,
      screenshotHash,
      evidenceHash: 'sha256:pending',
    });
    const evidenceHash = sha256(JSON.stringify(evidenceSeed));
    const evidenceCard = buildEvidenceCard({
      route,
      viewportName: viewport.name,
      result: failures.length > 0 ? 'fail' : 'pass',
      failures,
      metrics,
      screenshotHash,
      evidenceHash,
    });

    const screenshotPath = artifactAbsolutePath(evidenceCard.screenshotPath);
    const evidencePath = artifactAbsolutePath(evidenceCard.evidencePath);
    await deps.writeBinary(screenshotPath, screenshotBuffer);
    await deps.writeText(evidencePath, `${JSON.stringify(evidenceCard, null, 2)}\n`);

    return {
      routeId: evidenceCard.routeId,
      viewportName: viewport.name,
      result: failures.length > 0 ? 'fail' : 'pass',
      failureCodes: sanitizeObserverFailures(failures),
      screenshotPath: evidenceCard.screenshotPath,
      evidencePath: evidenceCard.evidencePath,
    };
  } finally {
    await context.close();
  }
};

export const runResponsiveUiObserver = async (
  argv: string[] = process.argv,
  deps: ObserverDependencies = defaultDependencies,
): Promise<ObserverRunSummary> => {
  const parsedArgs = parseObserverArgs(argv);
  await deps.ensureDir(artifactAbsolutePath('artifacts/responsive-ui-observer'));

  const browser = await deps.launchBrowser();
  try {
    const results: RouteObservation[] = [];
    for (const route of parsedArgs.routes) {
      for (const viewport of OBSERVER_VIEWPORTS) {
        results.push(await observeRouteAtViewport(browser, parsedArgs, route, viewport, deps));
      }
    }

    return {
      ok: results.every((result) => result.result === 'pass'),
      baseUrl: parsedArgs.baseUrl,
      results,
    };
  } finally {
    await browser.close();
  }
};

const printMachineSafeSummary = (summary: ObserverRunSummary): void => {
  console.log(
    JSON.stringify({
      ok: summary.ok,
      baseUrl: summary.baseUrl,
      results: summary.results,
    }),
  );
};

const isMainModule = (): boolean =>
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule()) {
  runResponsiveUiObserver().then(
    (summary) => {
      printMachineSafeSummary(summary);
      if (!summary.ok) {
        process.exitCode = 1;
      }
    },
    (error: unknown) => {
      console.error(JSON.stringify(buildFatalObserverSummary(error)));
      process.exitCode = 1;
    },
  );
}
