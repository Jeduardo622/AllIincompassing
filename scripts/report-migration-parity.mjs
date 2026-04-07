/**
 * Read-only: compare supabase/migrations/*.sql versions to remote schema_migrations.
 * Usage: node --env-file=.env scripts/report-migration-parity.mjs
 * Env: BRANCH_DB_URL | SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL (same resolution as apply-remote-migrations.mjs)
 *
 * Suppression: actionable pending excludes versions listed in config/migration-drift-manifest.json
 * (LEDGER_ONLY_DRIFT — see scripts/build-migration-drift-manifest.mjs). Raw pending count is unchanged.
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import process from 'process';
import pg from 'pg';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0';

const projectRoot = process.cwd();
const migrationsDir = path.join(projectRoot, 'supabase', 'migrations');
const driftManifestPath = path.join(projectRoot, 'config', 'migration-drift-manifest.json');
const triageInventoryPath = path.join(projectRoot, 'reports', 'migration-triage-inventory.json');

const connectionString =
  process.env.BRANCH_DB_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Set BRANCH_DB_URL, SUPABASE_DB_URL, DIRECT_URL, or DATABASE_URL.');
  process.exit(1);
}

async function loadLocalMigrations() {
  const files = await readdir(migrationsDir);
  return files
    .filter((f) => f.endsWith('.sql'))
    .map((file) => {
      const [version, ...rest] = file.replace('.sql', '').split('_');
      const slug = rest.join('_') || version;
      return { version, slug, file };
    })
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
}

async function loadDriftManifestVersionSet() {
  try {
    const raw = await readFile(driftManifestPath, 'utf8');
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (parseErr) {
      return {
        ok: false,
        error: `drift manifest JSON parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        versions: new Set(),
        manifestMeta: null,
      };
    }
    const entries = doc.entries;
    if (!Array.isArray(entries)) {
      return {
        ok: false,
        error: 'manifest missing entries array',
        versions: new Set(),
        manifestMeta: doc.meta ?? null,
      };
    }
    const versions = new Set(entries.map((e) => e.version).filter(Boolean));
    return { ok: true, error: null, versions, manifestMeta: doc.meta ?? null };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return {
        ok: false,
        error: 'drift manifest not found (config/migration-drift-manifest.json)',
        versions: new Set(),
        manifestMeta: null,
      };
    }
    throw e;
  }
}

async function loadTriageSnapshotMeta() {
  try {
    const raw = await readFile(triageInventoryPath, 'utf8');
    const inv = JSON.parse(raw);
    const m = inv.meta ?? {};
    return {
      sourceArtifact: 'reports/migration-triage-inventory.json',
      generatedAt: m.generatedAt ?? null,
      projectIdExpected: m.project_id_expected ?? null,
      countsByClassification: m.counts_by_classification ?? null,
      doNotApplyShortlistCount: Array.isArray(m.do_not_apply_shortlist) ? m.do_not_apply_shortlist.length : null,
    };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return null;
    }
    throw e;
  }
}

function slicePending(pending, n) {
  return pending.slice(0, n).map((p) => `${p.version}_${p.slug}`);
}

async function main() {
  const local = await loadLocalMigrations();
  const localVersionSet = new Set(local.map((m) => m.version));
  const driftLoad = await loadDriftManifestVersionSet();
  const triageSnap = await loadTriageSnapshotMeta();

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 60_000,
  });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'select version from supabase_migrations.schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.version));
    const pending = local.filter((m) => !applied.has(m.version));
    const extraRemote = rows.filter((r) => !local.some((m) => m.version === r.version)).length;

    const suppressedPending = driftLoad.ok
      ? pending.filter((m) => driftLoad.versions.has(m.version))
      : [];
    const actionablePending = driftLoad.ok
      ? pending.filter((m) => !driftLoad.versions.has(m.version))
      : pending;

    const manifestOrphans = driftLoad.ok
      ? [...driftLoad.versions].filter((v) => !localVersionSet.has(v))
      : [];

    const summary = {
      localFiles: local.length,
      remoteLedgerRows: rows.length,
      pendingVersions: pending.length,
      actionablePendingVersions: actionablePending.length,
      knownDriftSuppressedPendingCount: suppressedPending.length,
      knownDriftManifestEntryCount: driftLoad.manifestMeta?.entryCount ?? driftLoad.versions.size,
      remoteRowsWithoutLocalFileVersion: extraRemote,
    };

    if (!driftLoad.ok) {
      summary.driftManifestWarning = driftLoad.error;
    }

    const driftSuppression = {
      manifestPath: path.relative(projectRoot, driftManifestPath).replace(/\\/g, '/'),
      manifestLoaded: driftLoad.ok,
      manifestSchemaVersion: driftLoad.manifestMeta?.schemaVersion ?? null,
      manifestSourceArtifact: driftLoad.manifestMeta?.sourceArtifact ?? null,
      manifestEntryCount: driftLoad.manifestMeta?.entryCount ?? driftLoad.versions.size,
      suppressedPendingCount: suppressedPending.length,
      actionablePendingCount: actionablePending.length,
      suppressedPendingSample: slicePending(suppressedPending, 10),
      actionablePendingSample: slicePending(actionablePending, 15),
    };

    if (manifestOrphans.length > 0) {
      driftSuppression.manifestVersionsWithoutLocalFile = manifestOrphans.slice(0, 20);
      driftSuppression.manifestVersionsWithoutLocalFileCount = manifestOrphans.length;
    }

    const triageSnapshot =
      triageSnap &&
      triageSnap.countsByClassification &&
      Object.keys(triageSnap.countsByClassification).length > 0
        ? {
            ...triageSnap,
            doNotApplyCountFromInventory:
              triageSnap.countsByClassification.SUPERSEDED_DO_NOT_APPLY ?? null,
            orderingConflictHumanReviewCount:
              triageSnap.countsByClassification.ORDERING_CONFLICT_HUMAN_REVIEW ?? null,
            needsSchemaDiffReviewCount:
              triageSnap.countsByClassification.NEEDS_SCHEMA_DIFF_REVIEW ?? null,
            ledgerOnlyDriftCountFromInventory:
              triageSnap.countsByClassification.LEDGER_ONLY_DRIFT ?? null,
          }
        : triageSnap;

    console.log(
      JSON.stringify(
        {
          summary,
          driftSuppression,
          triageSnapshot,
          pendingMin: pending[0]?.version ?? null,
          pendingMax: pending[pending.length - 1]?.version ?? null,
          pendingSample: slicePending(pending, 15),
          actionablePendingMin: actionablePending[0]?.version ?? null,
          actionablePendingMax: actionablePending[actionablePending.length - 1]?.version ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
