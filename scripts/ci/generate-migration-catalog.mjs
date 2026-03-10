import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const OUT_PATH = path.join(ROOT, "docs", "migrations", "migration-catalog.md");

const classify = (name) => {
  const lower = name.toLowerCase();
  if (/_\d{14,}_/.test(lower) || lower.includes("copy") || lower.includes("batch")) {
    return "duplicate/backfill";
  }
  if (
    lower.includes("fix") ||
    lower.includes("hotfix") ||
    lower.includes("restore") ||
    lower.includes("regrant") ||
    lower.includes("cleanup") ||
    lower.includes("align") ||
    lower.includes("consolidate")
  ) {
    return "corrective";
  }
  if (lower.startsWith("2025")) {
    return "legacy-only";
  }
  return "canonical";
};

const run = async () => {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  const counts = {
    canonical: 0,
    "duplicate/backfill": 0,
    corrective: 0,
    "legacy-only": 0,
  };

  const rows = files.map((file) => {
    const classification = classify(file);
    counts[classification] += 1;
    return `| ${file} | ${classification} |`;
  });

  const markdown = [
    "# Migration Catalog",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Classification Summary",
    "",
    `- canonical: ${counts.canonical}`,
    `- duplicate/backfill: ${counts["duplicate/backfill"]}`,
    `- corrective: ${counts.corrective}`,
    `- legacy-only: ${counts["legacy-only"]}`,
    "",
    "## Detailed Index",
    "",
    "| Migration file | Classification |",
    "|---|---|",
    ...rows,
    "",
  ].join("\n");

  await writeFile(OUT_PATH, markdown, "utf8");
  console.log(`Migration catalog written to ${path.relative(ROOT, OUT_PATH)}`);
};

run().catch((error) => {
  console.error("Failed to generate migration catalog.");
  console.error(error);
  process.exitCode = 1;
});

