/**
 * Agent loop completion audit. Does not emit followup_message (no auto-chains).
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
    logDirEnsure();
    const line = JSON.stringify({
      hook: "stop",
      ts: new Date().toISOString(),
      status: typeof input.status === "string" ? input.status : null,
      loop_count: typeof input.loop_count === "number" ? input.loop_count : null,
    });
    appendFileSync(join(LOG_DIR, "stop.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
