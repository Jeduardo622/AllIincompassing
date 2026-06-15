import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";

import {
  assertRedactedQaFixture,
  assertSupportedClinicalQaSourceTextFixture,
  buildClinicalQaReportMarkdown,
  buildClinicalQaRoute,
  buildClinicalQaTextEvidenceSections,
  captureClinicalQaGeneratedOutputArtifact,
  deriveClinicalQaExpectationsFromSourceText,
  evaluateClinicalDataParity,
  evaluateClinicalQaChecklist,
  type ClinicalQaEvidenceSection,
  parseClinicalQaExpectations,
  readClinicalQaOutputFixtureText,
  readClinicalQaSourceFixtureText,
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

const collectClinicalQaEvidenceSections = async (page: Page): Promise<ClinicalQaEvidenceSection[]> =>
  page.evaluate(`
    (() => {
      const normalize = (value) => (value ?? "").replace(/\\s+/g, " ").trim();
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const sectionEntries = new Map();
      const addSection = (label, text) => {
        const normalizedLabel = normalize(label);
        const normalizedText = normalize(text);
        if (!normalizedLabel || !normalizedText) {
          return;
        }
        sectionEntries.set(\`\${normalizedLabel.toLowerCase()}::\${normalizedText.slice(0, 300)}\`, {
          label: normalizedLabel,
          text: normalizedText,
        });
      };

      for (const element of document.querySelectorAll('main, article, section, [role="region"], [role="tabpanel"]')) {
        if (!isVisible(element)) {
          continue;
        }
        const heading = element.querySelector("h1,h2,h3,h4,h5,h6");
        const label =
          element.getAttribute("aria-label") ??
          element.getAttribute("data-testid") ??
          heading?.textContent ??
          element.getAttribute("role") ??
          element.tagName.toLowerCase();
        addSection(label, element.textContent ?? "");
      }

      for (const heading of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
        if (!isVisible(heading)) {
          continue;
        }
        const container = heading.closest('section, article, [role="region"], [role="tabpanel"]') ?? heading.parentElement;
        addSection(heading.textContent ?? "", container?.textContent ?? heading.textContent ?? "");
      }

      return Array.from(sectionEntries.values());
    })()
  `);

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
  const expectationsFixture = assertRedactedQaFixture(
    process.env.PW_CLINICAL_QA_EXPECTATIONS_FILE,
    "PW_CLINICAL_QA_EXPECTATIONS_FILE",
  );
  const expectations = expectationsFixture
    ? parseClinicalQaExpectations(await readFile(expectationsFixture, "utf8"), expectationsFixture)
    : sourceFixture
      ? deriveClinicalQaExpectationsFromSourceText(
          await readClinicalQaSourceFixtureText(assertSupportedClinicalQaSourceTextFixture(sourceFixture)),
        )
      : [];
  const expectationsSource = expectationsFixture ? "expectations-file" : sourceFixture ? "source-text" : "none";
  const outputFixtureText = outputFixture ? await readClinicalQaOutputFixtureText(outputFixture) : null;
  const generatedOutputSelector = process.env.PW_CLINICAL_QA_GENERATED_OUTPUT_SELECTOR?.trim() || null;

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
  const context = await browser.newContext();
  const page = await context.newPage();
  const latestDir = ensureArtifactsDir();

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    await assertRouteAccessible(page, baseUrl, routePath, { timeoutMs: 20_000 });

    const runId = Date.now();
    const capturedGeneratedOutput = generatedOutputSelector
      ? await captureClinicalQaGeneratedOutputArtifact({
          page,
          selector: generatedOutputSelector,
          latestDir,
          runId,
        })
      : null;
    const outputText = capturedGeneratedOutput?.text ?? outputFixtureText;
    const outputEvidenceSections = outputText ? buildClinicalQaTextEvidenceSections(outputText) : [];
    const pageText = await page.locator("body").innerText({ timeout: 10_000 });
    const evidenceSections = await collectClinicalQaEvidenceSections(page);
    const checklist = evaluateClinicalQaChecklist(pageText);
    const dataParityFindings = evaluateClinicalDataParity(pageText, expectations, evidenceSections);
    const outputDataParityFindings = outputText
      ? evaluateClinicalDataParity(
          outputText,
          expectations,
          outputEvidenceSections,
        )
      : [];
    const screenshotPath = path.join(latestDir, `clinical-data-parity-agent-${runId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const reportJsonPath = path.join(latestDir, `clinical-data-parity-agent-${runId}.json`);
    const reportMarkdownPath = path.join(latestDir, `clinical-data-parity-agent-${runId}.md`);
    const generatedAt = new Date().toISOString();
    const disclaimer = "QA evidence only. This is not BCBA approval or clinical sign-off.";

    const payload = {
      ok: true,
      mode: "browser-only-redacted-clinical-data-parity",
      baseUrl,
      routePath,
      credential: credentials.label,
      fixtures: {
        sourceConfigured: Boolean(sourceFixture),
        outputConfigured: Boolean(outputFixture),
        generatedOutputCaptureConfigured: Boolean(generatedOutputSelector),
        expectationsConfigured: Boolean(expectationsFixture),
        expectationsSource,
        outputSource: capturedGeneratedOutput ? "generated-output-capture" : outputFixture ? "output-fixture" : "none",
      },
      generatedOutputArtifact: capturedGeneratedOutput
        ? {
            path: capturedGeneratedOutput.artifactPath,
            generatedFileType: capturedGeneratedOutput.generatedFileType,
            filename: capturedGeneratedOutput.filename,
          }
        : null,
      evidenceSections: evidenceSections.map((section) => ({
        label: section.label,
        textLength: section.text.length,
      })),
      outputEvidenceSections: outputEvidenceSections.map((section) => ({
        label: section.label,
        textLength: section.text.length,
      })),
      checklist,
      dataParityFindings,
      outputDataParityFindings,
      humanReviewBlockers: dataParityFindings.filter(
        (finding) => finding.status === "fail" && finding.humanReviewBlocker,
      ),
      outputHumanReviewBlockers: outputDataParityFindings.filter(
        (finding) => finding.status === "fail" && finding.humanReviewBlocker,
      ),
      screenshot: screenshotPath,
      reportJson: reportJsonPath,
      reportMarkdown: reportMarkdownPath,
      generatedAt,
      disclaimer,
    };
    const markdown = buildClinicalQaReportMarkdown({
      generatedAt,
      baseUrl,
      routePath,
      credentialLabel: credentials.label,
      screenshotPath,
      checklist,
      dataParityFindings,
      outputDataParityFindings,
      outputFindingsHeading: capturedGeneratedOutput
        ? "Generated Output Parity Findings"
        : "Output Fixture Parity Findings",
      disclaimer,
    });

    await writeFile(reportJsonPath, JSON.stringify(payload, null, 2));
    await writeFile(reportMarkdownPath, markdown);

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
