#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.codex', override: false });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0';

const resolveConnectionString = () => {
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Set SUPABASE_DB_URL, DIRECT_URL, or DATABASE_URL before running this script.');
  }
  return connectionString;
};

const collectLocalMigrationNames = async () => {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  const entries = await fs.readdir(migrationsDir);
  return new Set(
    entries
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.replace(/\.sql$/, '')),
  );
};

const buildCandidates = (version, name) => {
  const trimmedVersion = String(version ?? '').trim();
  const trimmedName = String(name ?? '').trim();
  const candidates = new Set();
  if (trimmedVersion) {
    candidates.add(trimmedVersion);
  }
  if (trimmedName) {
    candidates.add(trimmedName);
  }
  if (trimmedVersion && trimmedName) {
    candidates.add(`${trimmedVersion}_${trimmedName}`);
  }
  return candidates;
};

const main = async () => {
  const localNames = await collectLocalMigrationNames();
  const pool = new Pool({
    connectionString: resolveConnectionString(),
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 60_000,
  });

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'select version, name from supabase_migrations.schema_migrations order by version',
    );

    const missing = [];
    for (const row of rows) {
      const candidates = buildCandidates(row.version, row.name);
      const matched = [...candidates].some((candidate) => localNames.has(candidate));
      if (!matched) {
        missing.push(row);
      }
    }

    if (missing.length === 0) {
      console.log('✅ No hosted-only migrations detected. Remote and local histories are aligned.');
    } else {
      console.warn(
        `⚠️ Detected ${missing.length} migration(s) applied remotely without matching local files:`,
      );
      for (const row of missing) {
        console.warn(` - version=${row.version} name=${row.name ?? '(null)'}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Failed to list remote-only migrations:', error.message);
  process.exitCode = 1;
});





