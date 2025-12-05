import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { Pool } from 'pg';

// Ensure we can connect to Supabase's self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0';

const projectRoot = process.cwd();
const migrationsDir = path.join(projectRoot, 'supabase', 'migrations');

const connectionString = process.env.BRANCH_DB_URL || process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error('Missing database connection string. Set BRANCH_DB_URL or SUPABASE_DB_URL.');
  process.exit(1);
}

async function loadLocalMigrations() {
  const files = await fs.readdir(migrationsDir);
  return files
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const [version, ...rest] = file.replace('.sql', '').split('_');
      const slug = rest.join('_') || version;
      return {
        version,
        slug,
        file,
        fullPath: path.join(migrationsDir, file),
      };
    })
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
}

async function fetchAppliedVersions(client) {
  const res = await client.query('select version from supabase_migrations.schema_migrations');
  return new Set(res.rows.map((row) => row.version));
}

async function applyMigration(client, migration) {
  const sql = await fs.readFile(migration.fullPath, 'utf8');
  await client.query('BEGIN');
  try {
    if (sql.trim().length > 0) {
      await client.query(sql);
    }

    await client.query(
      `
        insert into supabase_migrations.schema_migrations (version, name)
        values ($1, $2)
        on conflict (version) do nothing
      `,
      [migration.version, migration.slug],
    );

    await client.query('COMMIT');
    console.log(`✔ Applied ${migration.file}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✖ Failed ${migration.file}: ${err.message}`);
    throw err;
  }
}

async function main() {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 60_000,
    idleTimeoutMillis: 0,
  });

  const client = await pool.connect();
  try {
    await client.query('set role supabase_admin');
    const localMigrations = await loadLocalMigrations();
    const applied = await fetchAppliedVersions(client);

    const pending = localMigrations.filter((m) => !applied.has(m.version));
    if (pending.length === 0) {
      console.log('Database is already in sync with supabase/migrations.');
      return;
    }

    console.log(`Applying ${pending.length} pending migrations...`);
    for (const migration of pending) {
      await applyMigration(client, migration);
    }

    console.log('All pending migrations have been applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration run failed:', err);
  process.exit(1);
});

