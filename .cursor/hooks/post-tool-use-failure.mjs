/**
 * Audit: one NDJSON line per failed edit-style tool use (fail-open).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStdinJson } from "./lib/read-stdin-json.mjs";
import { redactErrorSnippet } from "./lib/redact-secrets.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const LOG_DIR = join(__dirname, "logs");

function logDirEnsure() {
  mkdirSync(LOG_DIR, { recursive: true });
}

function main() {
  return readStdinJson().then((input) => {
    const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
    const errRaw = input.error ?? input.tool_error ?? input.failure_message ?? input.message;
    const line = JSON.stringify({
      hook: "postToolUseFailure",
      ts: new Date().toISOString(),
      tool_name: toolName || null,
      error: redactErrorSnippet(errRaw),
    });
    logDirEnsure();
    appendFileSync(join(LOG_DIR, "tool-use-failure.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
