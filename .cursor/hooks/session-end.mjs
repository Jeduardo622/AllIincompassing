/**
 * Audit: agent session ended — scalar metadata only (fail-open).
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
    const reason =
      typeof input.reason === "string"
        ? input.reason
        : typeof input.status === "string"
          ? input.status
          : typeof input.end_reason === "string"
            ? input.end_reason
            : null;
    const line = JSON.stringify({
      hook: "sessionEnd",
      ts: new Date().toISOString(),
      reason,
      status: typeof input.status === "string" ? input.status : null,
    });
    logDirEnsure();
    appendFileSync(join(LOG_DIR, "session-end.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
