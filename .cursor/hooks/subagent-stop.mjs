/**
 * Audit: subagent / task stopped — metadata only, no followup_message (fail-open).
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
    const subagentType =
      typeof input.subagent_type === "string"
        ? input.subagent_type
        : typeof input.subagentType === "string"
          ? input.subagentType
          : typeof input.type === "string"
            ? input.type
            : null;
    const status = typeof input.status === "string" ? input.status : null;
    const loopCount = typeof input.loop_count === "number" ? input.loop_count : typeof input.loopCount === "number" ? input.loopCount : null;
    const line = JSON.stringify({
      hook: "subagentStop",
      ts: new Date().toISOString(),
      subagent_type: subagentType,
      status,
      loop_count: loopCount,
    });
    logDirEnsure();
    appendFileSync(join(LOG_DIR, "subagent-stop.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
