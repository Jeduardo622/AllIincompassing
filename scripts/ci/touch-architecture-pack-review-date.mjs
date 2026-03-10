import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const META_PATH = path.join(ROOT, "docs", "architecture", "pack-metadata.json");

const formatDate = (date) => date.toISOString().slice(0, 10);

const run = async () => {
  const raw = await readFile(META_PATH, "utf8");
  const metadata = JSON.parse(raw);
  const today = formatDate(new Date());

  metadata.lastReviewedAt = today;

  await writeFile(META_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`Updated architecture pack review date to ${today}.`);
};

run().catch((error) => {
  console.error("Failed to update architecture pack review date.");
  console.error(error);
  process.exitCode = 1;
});
