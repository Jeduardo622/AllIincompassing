import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, "docs", "migrations", "migration-baseline.txt");

const METADATA_FIELDS = ["@migration-intent:", "@migration-dependencies:", "@migration-rollback:"];

const parseBaseline = async () => {
  const raw = await readFile(BASELINE_PATH, "utf8");
  return new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
};

const getAddedFiles = async () => {
  const { execSync } = await import("node:child_process");
  const results = new Set();

  const collect = (cmd) => {
    try {
      const out = execSync(cmd, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("supabase/migrations/") && line.endsWith(".sql"))
        .forEach((line) => results.add(line));
    } catch {
      // Ignore unavailable git contexts and keep best-effort discovery.
    }
  };

  let mergeBase = "";
  try {
    mergeBase = execSync("git merge-base HEAD origin/main", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    mergeBase = "";
  }

  if (mergeBase) {
    collect(`git diff --name-only --diff-filter=A ${mergeBase} HEAD`);
  }
  collect("git diff --name-only --diff-filter=A HEAD~1 HEAD");
  collect("git diff --name-only --diff-filter=A");
  collect("git diff --cached --name-only --diff-filter=A");
  collect("git ls-files --others --exclude-standard supabase/migrations/*.sql");

  return Array.from(results);
};

const extractCanonicalToken = (fileName) => {
  const stem = fileName.replace(/^\d+_/, "").replace(/\.sql$/, "");
  return stem.replace(/^\d{14,}_/, "");
};

const validateMetadata = async (migrationPath) => {
  const raw = await readFile(path.join(ROOT, migrationPath), "utf8");
  const header = raw.split(/\r?\n/).slice(0, 25).join("\n").toLowerCase();
  return METADATA_FIELDS.every((field) => header.includes(field));
};

const run = async () => {
  const baseline = await parseBaseline();
  const added = await getAddedFiles();

  if (added.length === 0) {
    console.log("Migration governance check passed (no new migration files detected).");
    return;
  }

  const baselineTokens = new Map();
  for (const name of baseline) {
    baselineTokens.set(extractCanonicalToken(path.basename(name)), name);
  }

  const errors = [];

  for (const migrationPath of added) {
    const fileName = path.basename(migrationPath);
    const canonical = extractCanonicalToken(fileName);

    if (!baseline.has(migrationPath)) {
      const hasMetadata = await validateMetadata(migrationPath);
      if (!hasMetadata) {
        errors.push(
          `${migrationPath} missing required metadata header fields: ${METADATA_FIELDS.join(", ")}`,
        );
      }
    }

    const duplicateOf = baselineTokens.get(canonical);
    if (duplicateOf) {
      errors.push(
        `${migrationPath} duplicates canonical token "${canonical}" already present in ${duplicateOf}. Use forward-fix naming.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("Migration governance check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Migration governance check passed (${added.length} new migration file(s) validated).`);
};

run().catch((error) => {
  console.error("Migration governance check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
