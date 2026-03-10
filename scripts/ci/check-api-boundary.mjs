import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NETLIFY_FUNCTIONS_DIR = path.join(ROOT, "netlify", "functions");
const POLICY_PATH = path.join(ROOT, "docs", "api", "netlify-function-allowlist.json");

const loadPolicy = async () => {
  const raw = await readFile(POLICY_PATH, "utf8");
  return JSON.parse(raw);
};

const run = async () => {
  const policy = await loadPolicy();
  const entries = await readdir(NETLIFY_FUNCTIONS_DIR, { withFileTypes: true });

  const tsFunctions = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name);

  const known = new Set([
    ...(policy.bootstrapFunctions ?? []),
    ...(policy.legacyCompatibilityFunctions ?? []),
    ...(policy.boundaryExceptions ?? []),
  ]);

  const unauthorized = tsFunctions.filter((fileName) => !known.has(fileName));

  if (unauthorized.length > 0) {
    console.error("Unauthorized Netlify business function(s) detected.");
    for (const fileName of unauthorized) {
      console.error(`- netlify/functions/${fileName}`);
    }
    console.error(
      "Supabase Edge is authoritative for business APIs. Add an approved boundary exception or migrate to edge functions.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `API boundary check passed (${tsFunctions.length} Netlify functions accounted for by explicit policy).`,
  );
};

run().catch((error) => {
  console.error("API boundary check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});

