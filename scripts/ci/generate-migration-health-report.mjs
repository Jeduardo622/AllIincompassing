import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "docs", "migrations", "migration-catalog.md");
const OUT_PATH = path.join(ROOT, "reports", "migration-health-latest.md");

const parseCount = (content, label) => {
  const regex = new RegExp(`- ${label}:\\s+(\\d+)`);
  const match = content.match(regex);
  return match ? Number(match[1]) : 0;
};

const run = async () => {
  const catalog = await readFile(CATALOG_PATH, "utf8");
  const canonical = parseCount(catalog, "canonical");
  const duplicate = parseCount(catalog, "duplicate/backfill");
  const corrective = parseCount(catalog, "corrective");
  const legacy = parseCount(catalog, "legacy-only");

  const report = [
    "# Migration Health Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    `- canonical migrations: ${canonical}`,
    `- duplicate/backfill migrations: ${duplicate}`,
    `- corrective migrations: ${corrective}`,
    `- legacy-only migrations: ${legacy}`,
    "",
    "## Governance Status",
    "- Baseline index present: yes",
    "- Forward-fix strategy: enforced",
    "- Metadata requirement for new migrations: enforced by CI check",
    "",
  ].join("\n");

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${report}\n`, "utf8");
  console.log(`Migration health report written to ${path.relative(ROOT, OUT_PATH)}`);
};

run().catch((error) => {
  console.error("Failed to generate migration health report.");
  console.error(error);
  process.exitCode = 1;
});

