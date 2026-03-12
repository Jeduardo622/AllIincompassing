import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CI_WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "ci.yml");
const PREVIEW_DOC_PATH = path.join(ROOT, "docs", "PREVIEW_SMOKE.md");
const STAGING_DOC_PATH = path.join(ROOT, "docs", "STAGING_OPERATIONS.md");

const requiredCiCommands = ["npm run build", "npm run test:routes:tier0"];
const requiredPreviewDocSnippets = ["npm run build", "npm run test:routes:tier0", "npm run preview:build", "npm run preview:smoke"];
const forbiddenPreviewDocSnippets = ["PRODUCTION_READINESS_RUNBOOK.md", "dedicated `preview` job", "preview-smoke-junit.log"];

const run = async () => {
  const [ciWorkflow, previewDoc, stagingDoc] = await Promise.all([
    readFile(CI_WORKFLOW_PATH, "utf8"),
    readFile(PREVIEW_DOC_PATH, "utf8"),
    readFile(STAGING_DOC_PATH, "utf8"),
  ]);

  const failures = [];

  for (const command of requiredCiCommands) {
    if (!ciWorkflow.includes(command)) {
      failures.push(`CI workflow is missing expected command: ${command}`);
    }
  }

  for (const snippet of requiredPreviewDocSnippets) {
    if (!previewDoc.includes(snippet)) {
      failures.push(`Preview smoke doc is missing expected snippet: ${snippet}`);
    }
  }

  for (const snippet of forbiddenPreviewDocSnippets) {
    if (previewDoc.includes(snippet)) {
      failures.push(`Preview smoke doc contains stale snippet: ${snippet}`);
    }
  }

  if (!stagingDoc.includes(".github/workflows/ci.yml")) {
    failures.push("Staging operations doc is missing a reference to .github/workflows/ci.yml.");
  }

  if (failures.length > 0) {
    console.error("Runbook/CI alignment check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Runbook/CI alignment check passed.");
};

run().catch((error) => {
  console.error("Runbook/CI alignment check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
