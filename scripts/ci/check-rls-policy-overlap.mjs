import { runPostgresQuery } from "../lib/postgres-query.js";

const SENSITIVE_TABLES = [
  "admin_actions",
  "profiles",
  "session_transcripts",
  "session_transcript_segments",
];

const MAX_PERMISSIVE_POLICIES_PER_COMMAND = 2;
const parseBooleanFlag = (value, fallback) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return /^(1|true|yes)$/i.test(value);
};
const rlsOverlapRequired = parseBooleanFlag(process.env.CI_RLS_OVERLAP_REQUIRED, process.env.CI === "true");

const run = async () => {
  const hasDbUrl = Boolean(
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DATABASE_URL,
  );
  if (!hasDbUrl) {
    if (rlsOverlapRequired) {
      console.error(
        "Sensitive-table RLS overlap check failed: no database connection string configured in CI. Set SUPABASE_DB_URL or DATABASE_URL.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("Sensitive-table RLS overlap check skipped (no database connection string configured).");
    return;
  }

  const tablesList = SENSITIVE_TABLES.map((tableName) => `'${tableName}'`).join(", ");
  const rows = await runPostgresQuery(`
    select
      tablename,
      cmd,
      count(*) filter (where permissive = 'PERMISSIVE') as permissive_count
    from pg_policies
    where schemaname = 'public'
      and tablename in (${tablesList})
    group by tablename, cmd
    order by tablename, cmd;
  `);

  const violations = rows.filter((row) => Number(row.permissive_count ?? 0) > MAX_PERMISSIVE_POLICIES_PER_COMMAND);
  if (violations.length > 0) {
    console.error("Sensitive-table RLS overlap check failed.");
    for (const row of violations) {
      console.error(
        `- public.${row.tablename} (${row.cmd}) has ${row.permissive_count} permissive policies; max allowed is ${MAX_PERMISSIVE_POLICIES_PER_COMMAND}.`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Sensitive-table RLS overlap check passed (${rows.length} command scopes scanned across ${SENSITIVE_TABLES.length} tables).`,
  );
};

run().catch((error) => {
  console.error("Sensitive-table RLS overlap check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
