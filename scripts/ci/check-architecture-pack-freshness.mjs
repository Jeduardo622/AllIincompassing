import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PACK_PATH = path.join(ROOT, "docs", "architecture", "NEW_ENGINEER_PACK.md");
const META_PATH = path.join(ROOT, "docs", "architecture", "pack-metadata.json");

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const daysBetween = (from, to) => {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
};

const run = async () => {
  const metadata = await readJson(META_PATH);
  const markdown = await readFile(PACK_PATH, "utf8");
  const errors = [];

  const reviewedAt = new Date(metadata.lastReviewedAt);
  const now = new Date();
  if (!Number.isFinite(reviewedAt.getTime())) {
    errors.push(`Invalid docs/architecture/pack-metadata.json lastReviewedAt value: "${metadata.lastReviewedAt}".`);
  } else {
    const age = daysBetween(reviewedAt, now);
    if (age > metadata.maxReviewAgeDays) {
      errors.push(
        `Architecture pack review is stale (${age} days old, max ${metadata.maxReviewAgeDays}). Update lastReviewedAt and docs.`,
      );
    }
  }

  const requiredRefs = Array.isArray(metadata.requiredReferences) ? metadata.requiredReferences : [];
  for (const ref of requiredRefs) {
    if (!markdown.includes(ref)) {
      errors.push(`Architecture pack is missing required reference: ${ref}`);
    }
  }

  if (errors.length > 0) {
    console.error("Architecture pack freshness check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Architecture pack freshness check passed (last reviewed ${metadata.lastReviewedAt}, max age ${metadata.maxReviewAgeDays} days).`,
  );
};

run().catch((error) => {
  console.error("Architecture pack freshness check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
