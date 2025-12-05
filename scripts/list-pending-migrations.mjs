import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.codex', override: false });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0';

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const files = (await fs.readdir(migrationsDir))
  .filter((file) => file.endsWith('.sql'))
  .sort();

const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Set SUPABASE_DB_URL, DIRECT_URL, or DATABASE_URL before running this script.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 60_000,
  idleTimeoutMillis: 0,
});

const client = await pool.connect();
try {
  const { rows } = await client.query('select version from supabase_migrations.schema_migrations');
  const applied = new Set(rows.map((row) => row.version));
  const pending = files.filter((file) => {
    const version = file.split('_')[0];
    return !applied.has(version);
  });

  console.log(`Total local migrations: ${files.length}`);
  console.log(`Remote applied migrations: ${rows.length}`);
  console.log(`Pending migrations: ${pending.length}`);
  if (pending.length > 0) {
    console.log('Next pending migrations:');
    pending.slice(0, 10).forEach((file) => console.log(` - ${file}`));
  }
} finally {
  client.release();
  await pool.end();
}
