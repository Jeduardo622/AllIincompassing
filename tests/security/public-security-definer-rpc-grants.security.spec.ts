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
});
