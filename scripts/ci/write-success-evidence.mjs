import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [evidenceName = "ci-step", status = "unknown"] = process.argv.slice(2);

const outputDir = path.join(process.cwd(), "artifacts", "latest", "evidence");
const outputPath = path.join(outputDir, `${evidenceName}.json`);

const payload = {
  evidence: evidenceName,
  status,
  timestamp: new Date().toISOString(),
  workflow: process.env.GITHUB_WORKFLOW ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  runNumber: process.env.GITHUB_RUN_NUMBER ?? null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  sha: process.env.GITHUB_SHA ?? null,
  ref: process.env.GITHUB_REF ?? null,
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Wrote evidence artifact: ${outputPath}`);
