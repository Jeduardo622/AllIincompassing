import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const LOG_PATH = path.join(ROOT, "vitest-output.log");
const POLICY_PATH = path.join(ROOT, "tests", "reliability", "policy.json");
const QUARANTINE_PATH = path.join(ROOT, "tests", "reliability", "quarantine.json");
const OUTPUT_PATH = path.join(ROOT, "reports", "test-reliability-latest.json");

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const run = async () => {
  const policy = await readJson(POLICY_PATH);
  const quarantine = await readJson(QUARANTINE_PATH);

  let log = "";
  try {
    log = await readFile(LOG_PATH, "utf8");
  } catch {
    // report still emitted when no log is available
  }

  const failLines = (log.match(/\bFAIL\b/g) ?? []).length;
  const warnLines = (log.match(/\bWARN\b/g) ?? []).length;
  const timeoutMentions = (log.match(/timeout/gi) ?? []).length;
  const active = (quarantine.entries ?? []).filter((entry) => entry.status === "active");

  const payload = {
    generatedAt: new Date().toISOString(),
    slo: policy.slo,
    budgets: {
      maxActiveQuarantinedTests: policy.maxActiveQuarantinedTests,
      maxFlakyFailureRatePct: policy.maxFlakyFailureRatePct,
    },
    quarantine: {
      activeCount: active.length,
      activeIds: active.map((entry) => entry.id),
    },
    observedFromLog: {
      failTokens: failLines,
      warnTokens: warnLines,
      timeoutMentions,
      logPresent: Boolean(log),
    },
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Test reliability report written to ${path.relative(ROOT, OUTPUT_PATH)}`);
};

run().catch((error) => {
  console.error("Failed to generate test reliability report.");
  console.error(error);
  process.exitCode = 1;
});

