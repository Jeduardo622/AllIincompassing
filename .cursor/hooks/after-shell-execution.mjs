/**
 * Audit: shell completion with redacted command (fail-open).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStdinJson } from "./lib/read-stdin-json.mjs";
import { redactCommandLine } from "./lib/redact-secrets.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const LOG_DIR = join(__dirname, "logs");

function logDirEnsure() {
  mkdirSync(LOG_DIR, { recursive: true });
}

function pickScalar(input, keys) {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function main() {
  return readStdinJson().then((input) => {
    const command = typeof input.command === "string" ? input.command : "";
    const cwd =
      typeof input.cwd === "string"
        ? input.cwd
        : typeof input.working_directory === "string"
          ? input.working_directory
          : typeof input.workingDirectory === "string"
            ? input.workingDirectory
            : "";
    const exitCode = pickScalar(input, ["exit_code", "exitCode", "code"]);
    const line = JSON.stringify({
      hook: "afterShellExecution",
      ts: new Date().toISOString(),
      command_redacted: redactCommandLine(command),
      exit_code: exitCode,
      cwd: cwd ? redactCommandLine(cwd, 300) : null,
    });
    logDirEnsure();
    appendFileSync(join(LOG_DIR, "shell-after.ndjson"), `${line}\n`, "utf8");
    process.stdout.write("{}");
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write("{}");
  process.exit(0);
});
