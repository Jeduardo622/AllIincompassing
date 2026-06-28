import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public SECURITY DEFINER RPC execute grants', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260628165252_harden_public_security_definer_rpc_grants.sql',
    ),
    'utf-8',
  );
  const serviceOnlyMigrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260628171537_restrict_service_only_security_definer_rpc_grants.sql',
    ),
    'utf-8',
  );
  const grantStatements = migrationSql.match(/grant execute on function[^;]+;/gi) ?? [];

  it('removes unauthenticated execute from every public SECURITY DEFINER function', () => {
    expect(migrationSql).toMatch(/where n\.nspname = 'public'[\s\S]+and p\.prosecdef = true/i);
    expect(migrationSql).toMatch(
      /execute format\('revoke execute on function %s from public, anon', target_function\)/i,
    );
  });

  it('locks trigger-backed SECURITY DEFINER helpers to service_role only', () => {
    expect(migrationSql).toMatch(/join pg_trigger t on t\.tgfoid = p\.oid/i);
    expect(migrationSql).toMatch(/and t\.tgisinternal = false/i);
    expect(migrationSql).toMatch(
      /execute format\('revoke execute on function %s from public, anon, authenticated', target_function\)/i,
    );
    expect(migrationSql).toMatch(
      /execute format\('grant execute on function %s to service_role', target_function\)/i,
    );
  });

  it('asserts no public or anon SECURITY DEFINER execute remains', () => {
    expect(migrationSql).toMatch(/has_function_privilege\('public', p\.oid, 'EXECUTE'\)/i);
    expect(migrationSql).toMatch(/has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/i);
    expect(migrationSql).toMatch(/remain executable by public or anon/i);
  });

  it('asserts trigger-backed helpers are not directly executable by authenticated users', () => {
    expect(migrationSql).toMatch(/has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)/i);
    expect(migrationSql).toMatch(/not has_function_privilege\('service_role', p\.oid, 'EXECUTE'\)/i);
    expect(migrationSql).toMatch(/not service_role-only/i);
  });

  it('does not re-grant unauthenticated execute access', () => {
    for (const grantStatement of grantStatements) {
      const [, granteeList = ''] = grantStatement.match(/\bto\s+([^;]+);/i) ?? [];
      const grantees = granteeList
        .split(',')
        .map((grantee) => grantee.trim().toLowerCase());

      expect(grantees).not.toContain('public');
      expect(grantees).not.toContain('anon');
      expect(grantees).not.toContain('authenticated');
    }
  });

  it('restricts high-confidence service-only RPCs away from direct signed-in callers', () => {
    const serviceOnlyFunctions = [
      'public.assign_admin_role(text, uuid, text)',
      'public.assign_role_on_signup()',
      'public.assign_therapist_role(text, uuid)',
      'public.assign_therapist_role(uuid)',
      'public.check_migration_status()',
      'public.create_admin_invite_token_rate_limited(text, text, uuid, timestamp with time zone, uuid, role_type)',
      'public.create_user_profile()',
      'public.ensure_all_users_admin()',
      'public.ensure_user_has_admin_role()',
      'public.ensure_user_has_admin_role(uuid)',
      'public.prune_admin_actions(integer)',
      'public.prune_admin_invite_tokens()',
      'public.prune_session_transcripts(integer)',
      'public.sync_admin_roles_from_auth_metadata()',
    ];

    for (const functionSignature of serviceOnlyFunctions) {
      expect(serviceOnlyMigrationSql).toContain(`'${functionSignature}'`);
    }

    expect(serviceOnlyMigrationSql).toMatch(
      /revoke execute on function %s from public, anon, authenticated/i,
    );
    expect(serviceOnlyMigrationSql).toMatch(/grant execute on function %s to service_role/i);
  });

  it('asserts service-only RPCs remain service_role-only after migration', () => {
    expect(serviceOnlyMigrationSql).toMatch(/has_function_privilege\('public', unsafe_function, 'EXECUTE'\)/i);
    expect(serviceOnlyMigrationSql).toMatch(/has_function_privilege\('anon', unsafe_function, 'EXECUTE'\)/i);
    expect(serviceOnlyMigrationSql).toMatch(/has_function_privilege\('authenticated', unsafe_function, 'EXECUTE'\)/i);
    expect(serviceOnlyMigrationSql).toMatch(/not has_function_privilege\('service_role', unsafe_function, 'EXECUTE'\)/i);
    expect(serviceOnlyMigrationSql).toMatch(/Service-only SECURITY DEFINER grant hardening failed/i);
  });

  it('does not grant service-only functions back to browser roles', () => {
    expect(serviceOnlyMigrationSql).toMatch(
      /execute format\(\s*'grant execute on function %s to service_role'/i,
    );
    expect(serviceOnlyMigrationSql).not.toMatch(
      /execute format\(\s*'grant execute on function %s to (?:public|anon|authenticated)/i,
    );
  });
});
