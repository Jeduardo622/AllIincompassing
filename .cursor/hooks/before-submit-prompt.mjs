/**
 * Audit-only prompt gate: never blocks submission; logs high-signal secret-like
 * shapes to .cursor/hooks/logs/ (gitignored). Hook crashes are fail-open.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStdinJson } from "./lib/read-stdin-json.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const LOG_DIR = join(__dirname, "logs");

const PATTERNS = [
  { id: "pem_private_key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i },
  { id: "stripe_secret_key", re: /\bsk_(live|test)_[0-9a-zA-Z]{8,}\b/i },
  { id: "github_pat", re: /\bgh[psu]_[0-9a-zA-Z]{20,}\b/i },
  { id: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
];

function logDirEnsure() {
  mkdirSync(LOG_DIR, { recursive: true });
}

function main() {
  return readStdinJson().then((input) => {
    const prompt = typeof input.prompt === "string" ? input.prompt : "";
    const hits = [];
    for (const { id, re } of PATTERNS) {
      if (re.test(prompt)) hits.push(id);
    }
    if (hits.length > 0) {
      logDirEnsure();
      const line = JSON.stringify({
        hook: "beforeSubmitPrompt",
        ts: new Date().toISOString(),
        hits,
        promptLength: prompt.length,
        attachmentCount: Array.isArray(input.attachments) ? input.attachments.length : 0,
      });
      appendFileSync(join(LOG_DIR, "prompt-audit.ndjson"), `${line}\n`, "utf8");
    }
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  });
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
});
