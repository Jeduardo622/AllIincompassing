/**
 * Audit: subagent / task started — metadata only, never blocks (fail-open).
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
    const subagentId =
      typeof input.subagent_id === "string"
        ? input.subagent_id
        : typeof input.subagentId === "string"
          ? input.subagentId
          : typeof input.id === "string"
            ? input.id
            : null;
    const line = JSON.stringify({
      hook: "subagentStart",
      ts: new Date().toISOString(),
      subagent_type: subagentType,
      subagent_id: subagentId,
    });
    logDirEnsure();
    appendFileSync(join(LOG_DIR, "subagent-start.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
