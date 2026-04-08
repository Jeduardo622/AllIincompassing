/**
 * Regenerate config/migration-drift-manifest.json from reports/migration-triage-inventory.json.
 * Rows with classification LEDGER_ONLY_DRIFT become the bulk of the manifest.
 *
 * Preserves existing entries with classification SUPERSEDED_DO_NOT_APPLY (human-reviewed parity
 * suppressions that are not in the inventory LEDGER_ONLY set). Dedupes by version: superseded
 * entry wins over a generated LEDGER row if both exist.
 *
 * Parity semantics (raw vs actionable pending): docs/migrations/MIGRATION_GOVERNANCE.md#parity-reporting-raw-vs-actionable
 *
 * Usage: node scripts/build-migration-drift-manifest.mjs
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import process from 'process';

const projectRoot = process.cwd();
const inventoryPath = path.join(projectRoot, 'reports', 'migration-triage-inventory.json');
const outPath = path.join(projectRoot, 'config', 'migration-drift-manifest.json');

async function loadPreservedSupersededEntries() {
  try {
    const raw = await readFile(outPath, 'utf8');
    const doc = JSON.parse(raw);
    if (!Array.isArray(doc.entries)) return [];
    return doc.entries.filter((e) => e && e.classification === 'SUPERSEDED_DO_NOT_APPLY');
  } catch {
    return [];
  }
}

async function main() {
  const raw = await readFile(inventoryPath, 'utf8');
  const inv = JSON.parse(raw);
  if (!Array.isArray(inv.rows)) {
    throw new Error('migration-triage-inventory.json: expected top-level "rows" array');
  }
  const rows = inv.rows.filter((r) => r.classification === 'LEDGER_ONLY_DRIFT');
  const expected = inv.meta?.counts_by_classification?.LEDGER_ONLY_DRIFT;
  if (typeof expected !== 'number') {
    throw new Error(
      'migration-triage-inventory.json: meta.counts_by_classification.LEDGER_ONLY_DRIFT must be a number',
    );
  }
  if (rows.length !== expected) {
    throw new Error(
      `LEDGER_ONLY_DRIFT row count ${rows.length} does not match meta.counts_by_classification (${expected})`,
    );
  }

  const preservedSuperseded = await loadPreservedSupersededEntries();
  const supersededByVersion = new Map(preservedSuperseded.map((e) => [e.version, e]));

  const ledgerEntries = rows.map((r) => ({
    version: r.version,
    filename: r.filename,
    slug: r.slug,
    classification: 'LEDGER_ONLY_DRIFT',
    reason: r.reason,
    matchRuleSummary: r.match_rule_summary,
    nearestRemoteVersion: r.nearest_remote_version,
    nearestRemoteName: r.nearest_remote_name,
  }));

  const ledgerFiltered = ledgerEntries.filter((e) => !supersededByVersion.has(e.version));

  const mergedEntries = [...ledgerFiltered, ...preservedSuperseded].sort((a, b) =>
    String(a.version).localeCompare(String(b.version)),
  );

  const manifest = {
    meta: {
      schemaVersion: 1,
      classification: 'MIXED',
      sourceArtifact: 'reports/migration-triage-inventory.json',
      sourceInventoryGeneratedAt: inv.meta?.generatedAt ?? null,
      sourceProjectIdExpected: inv.meta?.project_id_expected ?? null,
      entryCount: mergedEntries.length,
      ledgerOnlyDriftEntryCount: ledgerFiltered.length,
      supersededDoNotApplyEntryCount: preservedSuperseded.length,
      note:
        'Human-reviewed parity suppressions: bulk LEDGER_ONLY_DRIFT from migration-triage-inventory.json, plus optional SUPERSEDED_DO_NOT_APPLY entries preserved here (not from inventory regen). These versions are excluded from actionable pending in scripts/report-migration-parity.mjs; they are not DDL allowlist guards. Do not replay superseded historical SQL on main without a new reviewed migration.',
    },
    entries: mergedEntries,
  };

  if (manifest.entries.length !== manifest.meta.entryCount) {
    throw new Error('internal: entries.length !== meta.entryCount');
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${mergedEntries.length} entries (${ledgerFiltered.length} LEDGER_ONLY_DRIFT + ${preservedSuperseded.length} SUPERSEDED_DO_NOT_APPLY preserved) to ${path.relative(projectRoot, outPath)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
