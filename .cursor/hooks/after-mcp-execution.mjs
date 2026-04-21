/**
 * Audit: MCP call completed — metadata only (fail-open).
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
    const server =
      typeof input.server === "string"
        ? input.server
        : typeof input.mcp_server === "string"
          ? input.mcp_server
          : typeof input.server_name === "string"
            ? input.server_name
            : "";
    const toolName =
      typeof input.tool_name === "string"
        ? input.tool_name
        : typeof input.toolName === "string"
          ? input.toolName
          : "";
    const durationMs =
      typeof input.duration_ms === "number"
        ? input.duration_ms
        : typeof input.durationMs === "number"
          ? input.durationMs
          : typeof input.elapsed_ms === "number"
            ? input.elapsed_ms
            : null;
    const line = JSON.stringify({
      hook: "afterMCPExecution",
      ts: new Date().toISOString(),
      server: server || null,
      tool_name: toolName || null,
      duration_ms: durationMs,
    });
    logDirEnsure();
    appendFileSync(join(LOG_DIR, "mcp-after.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
