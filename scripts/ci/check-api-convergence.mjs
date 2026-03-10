import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const POLICY_PATH = path.join(ROOT, "docs", "api", "netlify-function-allowlist.json");
const STATUS_PATH = path.join(ROOT, "docs", "api", "endpoint-convergence-status.json");
const EXCEPTIONS_PATH = path.join(ROOT, "docs", "api", "runtime-exceptions.json");
const NETLIFY_TOML = path.join(ROOT, "netlify.toml");
const NETLIFY_FUNCTIONS_DIR = path.join(ROOT, "netlify", "functions");
const SRC_DIR = path.join(ROOT, "src");

const REQUIRED_ENTRY_FIELDS = [
  "functionFile",
  "publicApiPath",
  "edgeTarget",
  "wave",
  "status",
  "owner",
];

const VALID_STATUSES = new Set(["legacy_shim", "migrating", "cutover_ready", "retired"]);
const VALID_WAVES = new Set(["A", "B", "C"]);

const loadJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

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
  if (!normalized.startsWith(`${SRC_DIR.split(path.sep).join("/")}/`)) {
    return false;
  }
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

const run = async () => {
  const policy = await loadJson(POLICY_PATH);
  const status = await loadJson(STATUS_PATH);
  const [netlifyTomlText, srcFiles, netlifyFnEntries, exceptionsDoc] = await Promise.all([
    readFile(NETLIFY_TOML, "utf8"),
    listFilesRecursive(SRC_DIR),
    readdir(NETLIFY_FUNCTIONS_DIR, { withFileTypes: true }),
    loadJson(EXCEPTIONS_PATH),
  ]);
  const clientRuntimeFiles = srcFiles.filter((file) => isClientRuntimeSource(file));
  const redirects = parseRedirects(netlifyTomlText);
  const srcText = (await Promise.all(clientRuntimeFiles.map((f) => readFile(f, "utf8")))).join("\n");
  const currentFunctionFiles = new Set(
    netlifyFnEntries.filter((e) => e.isFile() && e.name.endsWith(".ts")).map((e) => e.name),
  );

  const legacy = new Set(policy.legacyCompatibilityFunctions ?? []);
  const exceptions = Array.isArray(exceptionsDoc.exceptions) ? exceptionsDoc.exceptions : [];
  const exceptionsByFile = new Map(
    exceptions
      .filter((entry) => entry && typeof entry.functionFile === "string")
      .map((entry) => [entry.functionFile, entry]),
  );
  const entries = Array.isArray(status.entries) ? status.entries : [];
  const errors = [];
  const now = new Date();

  const byFile = new Map();
  for (const entry of entries) {
    for (const field of REQUIRED_ENTRY_FIELDS) {
      if (!entry[field]) {
        errors.push(`Convergence entry missing required field "${field}" for ${entry.functionFile ?? "<unknown>"}.`);
      }
    }
    if (entry.status && !VALID_STATUSES.has(entry.status)) {
      errors.push(`Invalid status "${entry.status}" on ${entry.functionFile}.`);
    }
    if (entry.wave && !VALID_WAVES.has(entry.wave)) {
      errors.push(`Invalid wave "${entry.wave}" on ${entry.functionFile}.`);
    }
    if (byFile.has(entry.functionFile)) {
      errors.push(`Duplicate convergence entry for ${entry.functionFile}.`);
    }
    byFile.set(entry.functionFile, entry);
  }

  for (const fileName of legacy) {
    if (!byFile.has(fileName)) {
      errors.push(`Missing convergence tracker entry for legacy compatibility function ${fileName}.`);
    }
  }

  for (const [fileName, entry] of byFile.entries()) {
    if (!legacy.has(fileName) && entry.status !== "retired") {
      errors.push(
        `Convergence tracker lists ${fileName} as active (${entry.status}) but it is not in legacyCompatibilityFunctions.`,
      );
    }
    if (entry.status === "retired" && legacy.has(fileName)) {
      errors.push(
        `Convergence tracker marks ${fileName} as retired, but it is still present in legacyCompatibilityFunctions.`,
      );
    }
    if (entry.status === "retired") {
      const functionBase = fileName.replace(/\.ts$/, "");
      const apiPath = `/api/${functionBase}`;
      const hasRedirect = redirects.some(
        (r) => r.from === apiPath || (typeof r.to === "string" && r.to.includes(`/.netlify/functions/${functionBase}`)),
      );
      const hasCallsites =
        srcText.includes(`"${apiPath}"`) ||
        srcText.includes(`'${apiPath}'`) ||
        srcText.includes(`\`${apiPath}`) ||
        srcText.includes(`\`${apiPath}?`);
      const functionStillExists = currentFunctionFiles.has(fileName);

      if (functionStillExists) {
        errors.push(`Retired function ${fileName} still exists under netlify/functions/.`);
      }
      if (hasRedirect) {
        errors.push(`Retired function ${fileName} still has a Netlify redirect for ${apiPath}.`);
      }
      if (hasCallsites) {
        errors.push(`Retired function ${fileName} still has app callsites referencing ${apiPath}.`);
      }
    }

    if (entry.status !== "retired") {
      const exception = exceptionsByFile.get(fileName);
      if (!exception) {
        errors.push(`Active legacy shim ${fileName} is missing a runtime exception entry in docs/api/runtime-exceptions.json.`);
      } else {
        if (!exception.owner || typeof exception.owner !== "string") {
          errors.push(`Runtime exception for ${fileName} is missing owner.`);
        }
        if (!exception.reason || typeof exception.reason !== "string") {
          errors.push(`Runtime exception for ${fileName} is missing reason.`);
        }
        if (!exception.expiresAt || typeof exception.expiresAt !== "string") {
          errors.push(`Runtime exception for ${fileName} is missing expiresAt.`);
        } else {
          const expiry = new Date(exception.expiresAt);
          if (!Number.isFinite(expiry.getTime())) {
            errors.push(`Runtime exception for ${fileName} has invalid expiresAt: "${exception.expiresAt}".`);
          } else if (expiry < now) {
            errors.push(`Runtime exception for ${fileName} expired on ${exception.expiresAt}.`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("API convergence check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const retired = entries.filter((entry) => entry.status === "retired").length;
  console.log(
    `API convergence check passed (${entries.length} tracked entries, ${retired} retired, ${legacy.size} legacy compatibility shims).`,
  );
};

run().catch((error) => {
  console.error("API convergence check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
