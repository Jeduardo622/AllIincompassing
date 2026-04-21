/**
 * Best-effort redaction for hook audit logs (commands and error snippets).
 * @param {string} s
 */
export function redactSensitiveStrings(s) {
  if (typeof s !== "string" || s.length === 0) return "";
  let out = s;
  out = out.replace(/\b-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, "[REDACTED_PEM]");
  out = out.replace(/\bsk_(live|test)_[0-9a-zA-Z]+\b/gi, "[REDACTED_STRIPE]");
  out = out.replace(/\bgh[psu]_[0-9a-zA-Z]+\b/gi, "[REDACTED_GITHUB_TOKEN]");
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GOOGLE_KEY]");
  out = out.replace(/\bxox[baprs]-[0-9A-Za-z-]+\b/gi, "[REDACTED_SLACK]");
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
  return out;
}

/**
 * @param {string} cmd
 * @param {number} [maxLen]
 */
export function redactCommandLine(cmd, maxLen = 600) {
  const redacted = redactSensitiveStrings(typeof cmd === "string" ? cmd : "");
  return redacted.length > maxLen ? `${redacted.slice(0, maxLen)}…` : redacted;
}

/**
 * @param {unknown} err
 * @param {number} [maxLen]
 */
export function redactErrorSnippet(err, maxLen = 400) {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : err != null
          ? String(err)
          : "";
  const redacted = redactSensitiveStrings(raw);
  return redacted.length > maxLen ? `${redacted.slice(0, maxLen)}…` : redacted;
}
