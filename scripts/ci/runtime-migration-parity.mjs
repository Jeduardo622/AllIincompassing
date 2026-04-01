import { execSync } from "node:child_process";
import { Pool } from "pg";

export const collectAddedMigrationVersions = ({ baseSha, headSha, cwd = process.cwd() }) => {
  const trimmedBase = String(baseSha ?? "").trim();
  const trimmedHead = String(headSha ?? "").trim();

  if (!trimmedBase || !trimmedHead) {
    return [];
  }

  const output = execSync(
    `git diff --name-only --diff-filter=A ${trimmedBase} ${trimmedHead}`,
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  const versions = new Set();
  for (const line of output.split(/\r?\n/)) {
    const file = line.trim();
    if (!file.startsWith("supabase/migrations/") || !file.endsWith(".sql")) {
      continue;
    }
    const name = file.split("/").pop() ?? "";
    const version = name.split("_")[0] ?? "";
    if (/^\d+$/.test(version)) {
      versions.add(version);
    }
  }

  return [...versions].sort();
};

export const resolveMissingVersions = (requiredVersions, appliedVersions) => {
  const applied = new Set(appliedVersions);
  return requiredVersions.filter((version) => !applied.has(version));
};

export const fetchAppliedVersions = async ({ connectionString }) => {
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
      .filter((value) => value.length > 0);
  } finally {
    client.release();
    await pool.end();
  }
};
