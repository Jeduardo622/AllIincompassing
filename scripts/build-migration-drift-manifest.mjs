/**
 * Regenerate config/migration-drift-manifest.json from reports/migration-triage-inventory.json.
 * Only rows with classification LEDGER_ONLY_DRIFT are included (bulk-approved drift-only queue).
 *
 * Usage: node scripts/build-migration-drift-manifest.mjs
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import process from 'process';

const projectRoot = process.cwd();
const inventoryPath = path.join(projectRoot, 'reports', 'migration-triage-inventory.json');
const outPath = path.join(projectRoot, 'config', 'migration-drift-manifest.json');

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

  const manifest = {
    meta: {
      schemaVersion: 1,
      classification: 'LEDGER_ONLY_DRIFT',
      sourceArtifact: 'reports/migration-triage-inventory.json',
      sourceInventoryGeneratedAt: inv.meta?.generatedAt ?? null,
      sourceProjectIdExpected: inv.meta?.project_id_expected ?? null,
      entryCount: rows.length,
      note:
        'Human-reviewed bulk drift-only suppressions for parity reporting. These versions are not candidates for DDL apply via allowlist; remote ledger filename/version mismatch or substance already present.',
    },
    entries: rows.map((r) => ({
      version: r.version,
      filename: r.filename,
      slug: r.slug,
      classification: 'LEDGER_ONLY_DRIFT',
      reason: r.reason,
      matchRuleSummary: r.match_rule_summary,
      nearestRemoteVersion: r.nearest_remote_version,
      nearestRemoteName: r.nearest_remote_name,
    })),
  };

  if (manifest.entries.length !== manifest.meta.entryCount) {
    throw new Error('internal: entries.length !== meta.entryCount');
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${rows.length} entries to ${path.relative(projectRoot, outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
