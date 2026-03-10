import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NETLIFY_DIR = path.join(ROOT, "netlify", "functions");
const NETLIFY_TOML = path.join(ROOT, "netlify.toml");
const SRC_DIR = path.join(ROOT, "src");
const REPORT_PATH = path.join(ROOT, "reports", "api-cutover-status.md");

const isTs = (name) => name.endsWith(".ts");

const readText = async (filePath) => readFile(filePath, "utf8");

const listFilesRecursive = async (dirPath) => {
  const out = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
};

const isClientRuntimeSource = (filePath) => {
  const normalized = filePath.split(path.sep).join("/");
  const srcRoot = SRC_DIR.split(path.sep).join("/");
  if (!normalized.startsWith(`${srcRoot}/`)) return false;
  if (normalized.includes("/src/server/")) return false;
  if (normalized.includes("/__tests__/")) return false;
  if (normalized.endsWith(".test.ts") || normalized.endsWith(".test.tsx")) return false;
  return normalized.endsWith(".ts") || normalized.endsWith(".tsx");
};

const parseRedirects = (content) => {
  const redirects = [];
  const lines = content.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[[redirects]]") {
      if (current) redirects.push(current);
      current = { from: null, to: null };
      continue;
    }
    if (!current) continue;
    const fromMatch = trimmed.match(/^from\s*=\s*"([^"]+)"$/);
    if (fromMatch) current.from = fromMatch[1];
    const toMatch = trimmed.match(/^to\s*=\s*"([^"]+)"$/);
    if (toMatch) current.to = toMatch[1];
  }
  if (current) redirects.push(current);
  return redirects.filter((r) => r.from && r.to);
};

const classifyShim = (content) => {
  const hasServerImport = content.includes("../../src/server/api/");
  const hasRequestWrap = content.includes("new Request(");
  const hasForward = content.includes("toNetlifyResponse");
  return hasServerImport && hasRequestWrap && hasForward;
};

const run = async () => {
  const [netlifyToml, srcFiles] = await Promise.all([readText(NETLIFY_TOML), listFilesRecursive(SRC_DIR)]);
  const clientRuntimeFiles = srcFiles.filter((file) => isClientRuntimeSource(file));
  const redirects = parseRedirects(netlifyToml);
  const srcTextChunks = await Promise.all(clientRuntimeFiles.map((file) => readText(file)));
  const srcAll = srcTextChunks.join("\n");

  const functionEntries = await readdir(NETLIFY_DIR, { withFileTypes: true });
  const netlifyFunctions = functionEntries
    .filter((entry) => entry.isFile() && isTs(entry.name))
    .map((entry) => entry.name)
    .sort();

  const rows = [];

  for (const fileName of netlifyFunctions) {
    if (fileName === "runtime-config.ts") {
      continue;
    }
    const functionBody = await readText(path.join(NETLIFY_DIR, fileName));
    const functionBase = fileName.replace(/\.ts$/, "");
    const apiPath = `/api/${functionBase}`;
    const redirect = redirects.find((r) => r.from === apiPath || r.to.includes(`/.netlify/functions/${functionBase}`));
    const isShim = classifyShim(functionBody);
    const appReferencesApiPath = srcAll.includes(`"${apiPath}"`) || srcAll.includes(`'${apiPath}'`) || srcAll.includes(`\`${apiPath}`);
    const retireReady = !redirect && !appReferencesApiPath;

    rows.push({
      fileName,
      apiPath,
      isShim,
      hasRedirect: Boolean(redirect),
      hasAppCallsites: appReferencesApiPath,
      retireReady,
    });
  }

  const retireReadyCount = rows.filter((r) => r.retireReady).length;
  const migratingCount = rows.length - retireReadyCount;

  const lines = [
    "# API Cutover Status Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Decision rule:",
    "- `retire-ready` only when no Netlify redirect exists and no app `/api/*` callsite remains.",
    "- otherwise `migrating`.",
    "",
    `Summary: ${retireReadyCount} retire-ready, ${migratingCount} still migrating.`,
    "",
    "| Function | API path | Thin shim | Redirect present | App callsites present | Classification |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) =>
      `| ${r.fileName} | ${r.apiPath} | ${r.isShim ? "yes" : "no"} | ${r.hasRedirect ? "yes" : "no"} | ${r.hasAppCallsites ? "yes" : "no"} | ${r.retireReady ? "retire-ready" : "migrating"} |`,
    ),
    "",
  ];

  await writeFile(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)} (${rows.length} function(s) analyzed).`);
};

run().catch((error) => {
  console.error("Failed to generate API cutover status report.");
  console.error(error);
  process.exitCode = 1;
});
