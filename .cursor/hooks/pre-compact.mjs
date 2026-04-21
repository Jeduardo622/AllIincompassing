/**
 * Audit: context compaction observed — keys only, no payload (fail-open).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStdinJson } from "./lib/read-stdin-json.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const LOG_DIR = join(__dirname, "logs");

function logDirEnsure() {
  mkdirSync(LOG_DIR, { recursive: true });
}

function main() {
  return readStdinJson().then((input) => {
    const keys = input && typeof input === "object" ? Object.keys(input).sort() : [];
    const line = JSON.stringify({
      hook: "preCompact",
      ts: new Date().toISOString(),
      input_key_count: keys.length,
      input_keys: keys.slice(0, 40),
    });
    logDirEnsure();
    appendFileSync(join(LOG_DIR, "pre-compact.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
