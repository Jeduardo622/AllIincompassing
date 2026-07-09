import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUTPUT_DIR = path.join(process.cwd(), "artifacts", "latest", "readiness");
const JSON_PATH = path.join(OUTPUT_DIR, "connector-health-readiness.json");
const MARKDOWN_PATH = path.join(OUTPUT_DIR, "connector-health-readiness.md");
const TIMEOUT_MS = Number(process.env.CONNECTOR_HEALTH_TIMEOUT_MS ?? "10000");

const normalize = (value) => (typeof value === "string" ? value.trim() : "");

const disabled = (name) => normalize(process.env[`CONNECTOR_HEALTH_${name}_DISABLED`]).toLowerCase() === "true";

const status = (name, value, detail) => ({
  name,
  status: value,
  detail,
  checkedAt: new Date().toISOString(),
});

const runCommand = async (command, args) => {
  try {
    await execFileAsync(command, args, {
      cwd: process.cwd(),
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
};

const github = async () => {
  if (disabled("GITHUB")) return status("GitHub", "intentionally_disabled", "Disabled by CONNECTOR_HEALTH_GITHUB_DISABLED=true.");
  const authOk = await runCommand("gh", ["auth", "status"]);
  if (!authOk) return status("GitHub", "unauthenticated", "gh auth status failed.");
  const repoOk = await runCommand("gh", ["repo", "view", "--json", "nameWithOwner"]);
  return repoOk
    ? status("GitHub", "live", "gh auth and read-only repo view succeeded.")
    : status("GitHub", "not_validated", "gh auth succeeded but repo view failed.");
};

const fetchJson = async (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

const supabase = async () => {
  if (disabled("SUPABASE")) return status("Supabase", "intentionally_disabled", "Disabled by CONNECTOR_HEALTH_SUPABASE_DISABLED=true.");
  const token = normalize(process.env.SUPABASE_ACCESS_TOKEN);
  const projectRef = normalize(process.env.SUPABASE_PROJECT_REF);
  if (!token || !projectRef) return status("Supabase", "missing", "Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF for read-only project validation.");
  try {
    const response = await fetchJson(`https://api.supabase.com/v1/projects/${projectRef}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) return status("Supabase", "live", "Read-only project lookup succeeded.");
    if (response.status === 401 || response.status === 403) return status("Supabase", "unauthenticated", `Project lookup returned ${response.status}.`);
    return status("Supabase", "not_validated", `Project lookup returned ${response.status}.`);
  } catch (error) {
    return status("Supabase", "not_validated", error instanceof Error ? error.message : String(error));
  }
};

const netlify = async () => {
  if (disabled("NETLIFY")) return status("Netlify", "intentionally_disabled", "Disabled by CONNECTOR_HEALTH_NETLIFY_DISABLED=true.");
  const token = normalize(process.env.NETLIFY_AUTH_TOKEN);
  if (!token) return status("Netlify", "missing", "Set NETLIFY_AUTH_TOKEN for read-only site validation.");
  try {
    const response = await fetchJson("https://api.netlify.com/api/v1/sites?per_page=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) return status("Netlify", "live", "Read-only sites lookup succeeded.");
    if (response.status === 401 || response.status === 403) return status("Netlify", "unauthenticated", `Sites lookup returned ${response.status}.`);
    return status("Netlify", "not_validated", `Sites lookup returned ${response.status}.`);
  } catch (error) {
    return status("Netlify", "not_validated", error instanceof Error ? error.message : String(error));
  }
};

const linear = async () => {
  if (disabled("LINEAR")) return status("Linear", "intentionally_disabled", "Disabled by CONNECTOR_HEALTH_LINEAR_DISABLED=true.");
  const token = normalize(process.env.LINEAR_API_KEY);
  if (!token) return status("Linear", "missing", "Set LINEAR_API_KEY for read-only viewer validation.");
  try {
    const response = await fetchJson("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "{ viewer { id } }" }),
    });
    if (response.ok) return status("Linear", "live", "Read-only viewer query succeeded.");
    if (response.status === 401 || response.status === 403) return status("Linear", "unauthenticated", `Viewer query returned ${response.status}.`);
    return status("Linear", "not_validated", `Viewer query returned ${response.status}.`);
  } catch (error) {
    return status("Linear", "not_validated", error instanceof Error ? error.message : String(error));
  }
};

const postman = async () => {
  if (disabled("POSTMAN")) return status("Postman", "intentionally_disabled", "Disabled by CONNECTOR_HEALTH_POSTMAN_DISABLED=true.");
  const token = normalize(process.env.POSTMAN_API_KEY);
  if (!token) return status("Postman", "missing", "Set POSTMAN_API_KEY for read-only /me validation.");
  try {
    const response = await fetchJson("https://api.getpostman.com/me", {
      headers: { "X-Api-Key": token },
    });
    if (response.ok) return status("Postman", "live", "Read-only /me lookup succeeded.");
    if (response.status === 401 || response.status === 403) return status("Postman", "unauthenticated", `/me lookup returned ${response.status}.`);
    return status("Postman", "not_validated", `/me lookup returned ${response.status}.`);
  } catch (error) {
    return status("Postman", "not_validated", error instanceof Error ? error.message : String(error));
  }
};

const checks = await Promise.all([github(), supabase(), netlify(), linear(), postman()]);
const blocking = checks.filter((item) => item.status === "unauthenticated");
const report = {
  report: "connector-health-readiness",
  generatedAt: new Date().toISOString(),
  statuses: ["live", "unauthenticated", "missing", "intentionally_disabled", "not_validated"],
  result: blocking.length === 0 ? "pass" : "fail",
  checks,
};

const markdownLines = [
  "# Connector Health Readiness",
  "",
  `- result: \`${report.result}\``,
  `- generatedAt: \`${report.generatedAt}\``,
  "",
  "| Connector | Status | Detail |",
  "|---|---|---|",
  ...checks.map((item) => `| ${item.name} | \`${item.status}\` | ${item.detail} |`),
  "",
  "Only read-only checks are used. Tokens and secret values are never written to this artifact.",
  "",
];

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(MARKDOWN_PATH, markdownLines.join("\n"), "utf8");

console.log(`Wrote ${JSON_PATH}`);
console.log(`Wrote ${MARKDOWN_PATH}`);
console.log(`Connector health readiness result: ${report.result}`);

if (process.argv.includes("--fail-on-unauthenticated") && report.result !== "pass") {
  process.exitCode = 1;
}
