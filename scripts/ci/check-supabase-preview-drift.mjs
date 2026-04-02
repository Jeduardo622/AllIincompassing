import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const ROOT = process.cwd();
const DEFAULT_MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

export const parseMigrationVersion = (fileName) => {
  const match = String(fileName).match(/^(\d+)(?:_.*)?\.sql$/);
  return match ? match[1] : "";
};

export const collectLocalMigrationVersions = async ({
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
} = {}) => {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const versions = new Set();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) {
      continue;
    }
    const version = parseMigrationVersion(entry.name);
    if (version) {
      versions.add(version);
    }
  }

  return [...versions].sort();
};

export const resolveMigrationDrift = ({ localVersions, remoteVersions }) => {
  const local = new Set(localVersions);
  const remote = new Set(remoteVersions);
  const localOnly = [...local].filter((version) => !remote.has(version)).sort();
  const remoteOnly = [...remote].filter((version) => !local.has(version)).sort();

  return {
    localOnly,
    remoteOnly,
    hasDrift: localOnly.length > 0 || remoteOnly.length > 0,
  };
};

const fetchRemoteMigrationVersions = async ({ connectionString }) => {
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
      "select version from supabase_migrations.schema_migrations",
    );
    return rows
      .map((row) => String(row.version ?? "").trim())
      .filter((value) => value.length > 0)
      .sort();
  } finally {
    client.release();
    await pool.end();
  }
};

const formatSample = (versions, max = 10) => {
  if (versions.length === 0) {
    return "none";
  }
  const sample = versions.slice(0, max).join(", ");
  return versions.length > max ? `${sample}, ...` : sample;
};

const fail = (message) => {
  console.error(`❌ Supabase preview drift check failed: ${message}`);
  process.exit(1);
};

const run = async () => {
  const connectionString = (process.env.SUPABASE_DB_URL ?? "").trim();
  const strictMode = process.env.CI_SUPABASE_PREVIEW_DRIFT_REQUIRED === "true";

  if (!connectionString) {
    console.log(
      "Supabase preview drift check skipped: SUPABASE_DB_URL is not configured in this environment.",
    );
    return;
  }

  const localVersions = await collectLocalMigrationVersions();
  let remoteVersions = [];
  try {
    remoteVersions = await fetchRemoteMigrationVersions({ connectionString });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (strictMode) {
      fail(
        `unable to query supabase_migrations.schema_migrations while strict mode is enabled: ${reason}`,
      );
    }
    console.warn(`⚠️ Supabase preview drift check skipped: could not query remote migration ledger (${reason}).`);
    return;
  }
  const drift = resolveMigrationDrift({ localVersions, remoteVersions });

  if (!drift.hasDrift) {
    console.log(
      `Supabase preview drift check passed (${localVersions.length} migration version(s) aligned).`,
    );
    return;
  }

  console.warn("⚠️ Supabase preview drift detected between repo migrations and remote ledger.");
  console.warn(`- local-only versions (${drift.localOnly.length}): ${formatSample(drift.localOnly)}`);
  console.warn(`- remote-only versions (${drift.remoteOnly.length}): ${formatSample(drift.remoteOnly)}`);
  console.warn(
    "- This drift can surface as non-blocking external `Supabase Preview` failures with: `Remote migration versions not found in local migrations directory.`",
  );
  console.warn(
    "- Operator action: reconcile migration history in Supabase/GitHub integration without inventing SQL or mutating production state blindly.",
  );

  if (strictMode) {
    fail(
      "drift detected while CI_SUPABASE_PREVIEW_DRIFT_REQUIRED=true. Resolve migration ledger drift first.",
    );
  }
};

const isDirectExecution = () => {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }
  return path.resolve(scriptPath) === fileURLToPath(import.meta.url);
};

if (isDirectExecution()) {
  run().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
