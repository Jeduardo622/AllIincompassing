import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.codex', override: false });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0';

const [, , filePath] = process.argv;
if (!filePath) {
  console.error('Usage: node apply-single-migration.mjs <path-to-sql>');
  process.exit(1);
}

const filename = path.basename(filePath);
const [version, ...rest] = filename.replace('.sql', '').split('_');
const slug = rest.join('_') || version;

const sql = await fs.readFile(filePath, 'utf8');
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
  try {
    await client.query('set role supabase_admin');
  } catch (roleErr) {
    console.warn('⚠️  Unable to set role supabase_admin, proceeding with current role:', roleErr.message);
  }
  await client.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  await client.query("select set_config('request.jwt.claim.email', 'service-role@supabase.com', true)");
  let actingUserId = '00000000-0000-0000-0000-000000000000';
  try {
    const { rows } = await client.query(
      "select ur.user_id from user_roles ur join roles r on r.id = ur.role_id where r.name in ('super_admin', 'admin') limit 1",
    );
    if (rows[0]?.user_id) {
      actingUserId = rows[0].user_id;
    }
  } catch (lookupErr) {
    console.warn('⚠️  Unable to locate admin user for RLS bypass:', lookupErr.message);
  }
  await client.query("select set_config('request.jwt.claim.sub', $1::text, true)", [actingUserId]);
  await client.query(
    "select set_config('request.jwt.claims', json_build_object('role', 'service_role', 'sub', $1::text)::text, true)",
    [actingUserId],
  );
  if (sql.trim().length > 0) {
    await client.query(sql);
  }
  await client.query(
    'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing',
    [version, slug],
  );
  console.log(`Applied ${filename}`);
} catch (err) {
  console.error(`Failed ${filename}:`, err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
