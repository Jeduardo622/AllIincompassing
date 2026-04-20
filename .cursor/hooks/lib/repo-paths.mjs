/**
 * @param {string} p
 */
export function normalizeRepoSlashes(p) {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * Block reads/writes of committed-style env files. Allows dev-local files:
 * `.env.local`, `.env.example`, `.env.sample`.
 * @param {string} filePath
 */
export function isProtectedEnvPath(filePath) {
  const norm = normalizeRepoSlashes(filePath);
  const base = norm.split("/").pop() ?? "";
  if (base === ".env.example" || base === ".env.sample" || base === ".env.local") {
    return false;
  }
  if (base === ".env") return true;
  if (base.startsWith(".env.")) return true;
  return false;
}

/**
 * AGENTS.md high-risk path hints (substring match on normalized path).
 * @param {string} filePath
 */
export function isHighRiskRepoPath(filePath) {
  const n = normalizeRepoSlashes(filePath);
  if (n.endsWith("/netlify.toml") || n.endsWith("netlify.toml")) return true;
  const needles = [
    "supabase/migrations/",
    "supabase/functions/",
    "src/server/",
    "src/lib/auth",
    "src/lib/runtimeconfig",
    "scripts/ci/",
    ".github/workflows/",
  ];
  return needles.some((s) => n.includes(s));
}

/**
 * @param {unknown} toolInput
 */
export function extractTargetPath(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (toolInput);
  const keys = ["file_path", "path", "target_file", "filePath", "absolute_path"];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
