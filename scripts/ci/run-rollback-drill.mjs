import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "artifacts", "latest", "rollback-drill");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "report.json");

const REQUIRED_CHECKS = [
  {
    name: "staging runbook references rollback promotion",
    file: "docs/STAGING_OPERATIONS.md",
    includes: ["rollback", "docs/INCIDENT_RESPONSE.md"],
  },
  {
    name: "incident runbook includes rollback procedures",
    file: "docs/INCIDENT_RESPONSE.md",
    includes: ["Rollback procedures", "Netlify deploys", "Supabase regressions"],
  },
  {
    name: "supabase branching runbook includes edge deployment contract",
    file: "docs/supabase_branching.md",
    includes: ["npm run ci:deploy:session-edge-bundle", "verify_jwt=true"],
  },
];

const run = async () => {
  const results = [];
  let failures = 0;

  for (const check of REQUIRED_CHECKS) {
    const absolutePath = path.join(ROOT, check.file);
    const content = await readFile(absolutePath, "utf8");
    const missing = check.includes.filter((needle) => !content.includes(needle));
    const passed = missing.length === 0;
    if (!passed) {
      failures += 1;
    }

    results.push({
      name: check.name,
      file: check.file,
      passed,
      missing,
    });
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const payload = {
    timestamp: new Date().toISOString(),
    status: failures === 0 ? "passed" : "failed",
    checks: results,
    failures,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Rollback drill report written: ${OUTPUT_PATH}`);
  if (failures > 0) {
    throw new Error(`Rollback drill failed with ${failures} missing contract assertion(s).`);
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
