import path from "node:path";
import { chromium } from "playwright";

import {
  assertRedactedQaFixture,
  buildClinicalQaRoute,
  evaluateClinicalQaChecklist,
  requireClinicalQaClientId,
  selectClinicalQaCredentials,
} from "./lib/clinical-data-parity-agent";
import { loadPlaywrightEnv, resolvePlaywrightBaseUrl } from "./lib/load-playwright-env";
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  ensureArtifactsDir,
  loginAndAssertSession,
} from "./lib/playwright-smoke";

const run = async (): Promise<void> => {
  loadPlaywrightEnv();

  const baseUrl = resolvePlaywrightBaseUrl().replace(/\/$/, "");
  const credentials = selectClinicalQaCredentials([
    {
      email: process.env.PW_CLINICAL_QA_EMAIL,
      password: process.env.PW_CLINICAL_QA_PASSWORD,
      label: "PW_CLINICAL_QA_EMAIL + PW_CLINICAL_QA_PASSWORD",
    },
    {
      email: process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      label: "PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD",
    },
  ]);
  const clientId = requireClinicalQaClientId(process.env.PW_CLINICAL_QA_CLIENT_ID);
  const routePath = buildClinicalQaRoute({
    clientId,
    routePath: process.env.PW_CLINICAL_QA_ROUTE,
  });
  const sourceFixture = assertRedactedQaFixture(
    process.env.PW_CLINICAL_QA_SOURCE_FILE,
    "PW_CLINICAL_QA_SOURCE_FILE",
  );
  const outputFixture = assertRedactedQaFixture(
    process.env.PW_CLINICAL_QA_OUTPUT_FILE,
    "PW_CLINICAL_QA_OUTPUT_FILE",
  );

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
  const context = await browser.newContext();
  const page = await context.newPage();
  const latestDir = ensureArtifactsDir();

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    await assertRouteAccessible(page, baseUrl, routePath, { timeoutMs: 20_000 });

    const pageText = await page.locator("body").innerText({ timeout: 10_000 });
    const checklist = evaluateClinicalQaChecklist(pageText);
    const screenshotPath = path.join(latestDir, `clinical-data-parity-agent-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const payload = {
      ok: true,
      mode: "browser-only-redacted-clinical-data-parity",
      baseUrl,
      routePath,
      credential: credentials.label,
      fixtures: {
        sourceConfigured: Boolean(sourceFixture),
        outputConfigured: Boolean(outputFixture),
      },
      checklist,
      screenshot: screenshotPath,
      disclaimer: "QA evidence only. This is not BCBA approval or clinical sign-off.",
    };

    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    const screenshot = await captureFailureScreenshot(page, "clinical-data-parity-agent-failure");
    console.error(
      JSON.stringify(
        {
          ok: false,
          mode: "browser-only-redacted-clinical-data-parity",
          message: "Clinical data parity agent failed.",
          credential: credentials.label,
          routePath,
          screenshot,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
};

run().catch((error) => {
  console.error("Clinical data parity agent crashed", error);
  process.exit(1);
});
