import {
  collectAddedMigrationVersions,
  fetchAppliedVersions,
  resolveMissingVersions,
} from "./runtime-migration-parity.mjs";

const baseSha = process.env.MIGRATION_PARITY_BASE_SHA ?? process.env.GITHUB_EVENT_BEFORE ?? "";
const headSha = process.env.MIGRATION_PARITY_HEAD_SHA ?? process.env.GITHUB_SHA ?? "HEAD";
const connectionString = process.env.SUPABASE_DB_URL ?? "";

const fail = (message) => {
  console.error(`❌ Runtime migration parity check failed: ${message}`);
  process.exit(1);
};

const run = async () => {
  const requiredVersions = collectAddedMigrationVersions({ baseSha, headSha });

  if (requiredVersions.length === 0) {
    console.log("Runtime migration parity check passed (no newly added migrations in merge range).");
    return;
  }

  if (!connectionString.trim()) {
    fail("SUPABASE_DB_URL is required when newly added migrations are detected.");
  }

  const appliedVersions = await fetchAppliedVersions({ connectionString });
  const missingVersions = resolveMissingVersions(requiredVersions, appliedVersions);

  if (missingVersions.length > 0) {
    fail(
      `missing migration version(s) in runtime DB: ${missingVersions.join(", ")}; required from merge range: ${requiredVersions.join(", ")}`,
    );
  }

  console.log(
    `Runtime migration parity check passed (${requiredVersions.length} version(s) verified in runtime DB).`,
  );
};

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
