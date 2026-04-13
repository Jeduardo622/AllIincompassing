import { execSync } from "node:child_process";
import { Pool } from "pg";

/**
 * @typedef {{ version: string; name: string }} MigrationEntry
 */

/**
 * Collects migrations added between two SHAs. Each file `TIMESTAMP_name.sql` yields
 * `{ version: TIMESTAMP, name }` so runtime parity can match hosted rows even when
 * Dashboard/MCP apply records a different timestamp than the repo filename (same logical `name`).
 */
export const collectAddedMigrations = ({ baseSha, headSha, cwd = process.cwd() }) => {
  const trimmedBase = String(baseSha ?? "").trim();
  const trimmedHead = String(headSha ?? "").trim();

  if (!trimmedBase || !trimmedHead) {
    return [];
  }

  const output = execSync(`git diff --name-only --diff-filter=A ${trimmedBase} ${trimmedHead}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  /** @type {MigrationEntry[]} */
  const entries = [];
  for (const line of output.split(/\r?\n/)) {
    const file = line.trim();
    if (!file.startsWith("supabase/migrations/") || !file.endsWith(".sql")) {
      continue;
    }
    const base = file.split("/").pop() ?? "";
    const withoutSql = base.replace(/\.sql$/i, "");
    const underscore = withoutSql.indexOf("_");
    if (underscore === -1) {
      continue;
    }
    const version = withoutSql.slice(0, underscore);
    const name = withoutSql.slice(underscore + 1);
    if (!/^\d+$/.test(version) || !name) {
      continue;
    }
    entries.push({ version, name });
  }

  const key = (m) => `${m.version}::${m.name}`;
  const seen = new Set();
  return entries.filter((m) => {
    const k = key(m);
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
};

export const collectAddedMigrationVersions = ({ baseSha, headSha, cwd = process.cwd() }) => {
  const migrations = collectAddedMigrations({ baseSha, headSha, cwd });
  return [...new Set(migrations.map((m) => m.version))].sort();
};

export const resolveMissingVersions = (requiredVersions, appliedVersions) => {
  const applied = new Set(appliedVersions);
  return requiredVersions.filter((version) => !applied.has(version));
};

/**
 * Required migration is satisfied if runtime has the same version, or the same logical name
 * (covers MCP/Dashboard apply timestamps differing from repo filename prefix).
 */
export const resolveMissingMigrations = (/** @type {MigrationEntry[]} */ required, /** @type {MigrationEntry[]} */ applied) => {
  return required.filter((r) => {
    const satisfied = applied.some(
      (a) =>
        a.version === r.version ||
        (r.name.length > 0 && a.name.length > 0 && a.name === r.name),
    );
    return !satisfied;
  });
};

export const fetchAppliedMigrations = async ({ connectionString }) => {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 60_000,
    idleTimeoutMillis: 0,
  });

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "select version, coalesce(name, '') as name from supabase_migrations.schema_migrations",
    );
    return rows.map((row) => ({
      version: String(row.version ?? "").trim(),
      name: String(row.name ?? "").trim(),
    }));
  } finally {
    client.release();
    await pool.end();
  }
};

export const fetchAppliedVersions = async ({ connectionString }) => {
  const migrations = await fetchAppliedMigrations({ connectionString });
  return migrations.map((m) => m.version).filter((v) => v.length > 0);
};
