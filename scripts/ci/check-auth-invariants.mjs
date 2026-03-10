import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

const requiredMigration = resolve(
  root,
  'supabase/migrations/20260310190000_auth_access_hardening.sql',
);

const mustContain = [
  'drop trigger if exists on_auth_user_created on auth.users;',
  'drop trigger if exists trg_sync_admin_roles_from_metadata on auth.users;',
  'drop trigger if exists assign_role_on_signup_trigger on auth.users;',
  'create policy profiles_insert_self_client',
  'revoke execute on function public.assign_admin_role(text, uuid, text) from public, anon;',
];

const legacyRiskPatterns = [
  'CREATE TRIGGER on_auth_user_created',
  'CREATE TRIGGER trg_sync_admin_roles_from_metadata',
  'CREATE TRIGGER assign_role_on_signup_trigger',
];

const readUtf8 = (path) => readFileSync(path, 'utf8');

const migrationSql = readUtf8(requiredMigration);

for (const token of mustContain) {
  if (!migrationSql.includes(token)) {
    console.error(`Missing required auth hardening statement in migration: ${token}`);
    process.exit(1);
  }
}

// Forbid reintroduction in latest migration baseline.
for (const pattern of legacyRiskPatterns) {
  if (migrationSql.includes(pattern)) {
    console.error(`Forbidden legacy trigger pattern found in hardening migration: ${pattern}`);
    process.exit(1);
  }
}

const authContextPath = resolve(root, 'src/lib/authContext.tsx');
const authContext = readUtf8(authContextPath);

if (authContext.includes('user_metadata?.roles')) {
  console.error('Forbidden role derivation detected: authContext still trusts token metadata roles.');
  process.exit(1);
}

console.log('Auth invariants check passed.');
