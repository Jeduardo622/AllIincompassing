import {
  collectAddedMigrations,
  fetchAppliedMigrations,
  resolveMissingMigrations,
} from "./runtime-migration-parity.mjs";

const baseSha = process.env.MIGRATION_PARITY_BASE_SHA ?? process.env.GITHUB_EVENT_BEFORE ?? "";
const headSha = process.env.MIGRATION_PARITY_HEAD_SHA ?? process.env.GITHUB_SHA ?? "HEAD";
const connectionString = process.env.SUPABASE_DB_URL ?? "";

const fail = (message) => {
  console.error(`❌ Runtime migration parity check failed: ${message}`);
  process.exit(1);
};

const run = async () => {
  const required = collectAddedMigrations({ baseSha, headSha });

  if (required.length === 0) {
    console.log("Runtime migration parity check passed (no newly added migrations in merge range).");
    return;
  }

  if (!connectionString.trim()) {
    fail("SUPABASE_DB_URL is required when newly added migrations are detected.");
  }

  const applied = await fetchAppliedMigrations({ connectionString });
  const missing = resolveMissingMigrations(required, applied);

  if (missing.length > 0) {
    const detail = missing.map((m) => `${m.version}/${m.name}`).join(", ");
    fail(
      `missing migration(s) in runtime DB: ${detail}; required from merge range (version or logical name must match schema_migrations).`,
    );
  }

  console.log(
    `Runtime migration parity check passed (${required.length} migration(s) verified in runtime DB by version or name).`,
  );
};

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
