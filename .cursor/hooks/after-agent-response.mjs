/**
 * Lightweight lifecycle audit: one NDJSON line per response (text size only).
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
    const text = typeof input.text === "string" ? input.text : "";
    logDirEnsure();
    const line = JSON.stringify({
      hook: "afterAgentResponse",
      ts: new Date().toISOString(),
      textLength: text.length,
    });
    appendFileSync(join(LOG_DIR, "agent-response.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
