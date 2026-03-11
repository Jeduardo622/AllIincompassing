import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runPostgresQuery } from '../lib/postgres-query.js';

const root = process.cwd();
const hardeningMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260311210000_harden_privileged_function_grants.sql',
);

const privilegedFunctions = [
  'admin_reset_user_password',
  'assign_user_role',
  'create_admin_invite',
  'create_super_admin',
  'ensure_admin_role',
];

const hasDatabaseUrl = Boolean(
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL,
);

const readMigration = () => {
  const migrationSql = readFileSync(hardeningMigrationPath, 'utf8');

  for (const fn of privilegedFunctions) {
    if (!migrationSql.includes(`'${fn}'`)) {
      console.error(`Missing privileged function token in migration: ${fn}`);
      process.exit(1);
    }
  }

  if (!migrationSql.toLowerCase().includes('revoke execute on function')) {
    console.error('Migration must revoke execute on privileged functions.');
    process.exit(1);
  }

  if (!migrationSql.toLowerCase().includes('grant execute on function')) {
    console.error('Migration must grant execute back to service_role.');
    process.exit(1);
  }
};

const checkDatabasePrivileges = async () => {
  const fnListSql = privilegedFunctions.map((fn) => `'${fn}'`).join(', ');
  const query = `
    select
      p.proname as function_name,
      p.prosecdef as security_definer,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (${fnListSql})
    order by p.proname;
  `;

  const rows = await runPostgresQuery(query);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error('No privileged functions found in database for grant verification.');
    process.exit(1);
  }

  const unsafe = rows.filter(
    (row) => row.security_definer && (row.anon_exec || row.authenticated_exec),
  );
  if (unsafe.length > 0) {
    console.error('Unsafe execute grants detected on privileged SECURITY DEFINER functions:');
    for (const row of unsafe) {
      console.error(
        `- ${row.function_name} anon_exec=${row.anon_exec} authenticated_exec=${row.authenticated_exec}`,
      );
    }
    process.exit(1);
  }

  const missingServiceRole = rows.filter((row) => row.service_role_exec !== true);
  if (missingServiceRole.length > 0) {
    console.error('Missing service_role execute grants on privileged functions:');
    for (const row of missingServiceRole) {
      console.error(`- ${row.function_name}`);
    }
    process.exit(1);
  }
};

const run = async () => {
  readMigration();

  if (!hasDatabaseUrl) {
    console.warn(
      '⚠️ Privileged function DB grant check skipped: missing SUPABASE_DB_URL (or DATABASE_URL).',
    );
    console.log('Privileged function grant static check passed.');
    return;
  }

  await checkDatabasePrivileges();
  console.log('Privileged function grant check passed.');
};

run().catch((error) => {
  console.error('❌ Privileged function grant check failed unexpectedly.');
  console.error(error);
  process.exit(1);
});
