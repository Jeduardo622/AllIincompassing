import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public client wrapper RPC execute grants', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260623135118_restrict_public_client_wrapper_rpc_anon_execute.sql',
    ),
    'utf-8',
  );
  const grantStatements = migrationSql.match(/grant execute on function[^;]+;/gi) ?? [];

  it('removes unauthenticated execute access from client wrapper RPCs', () => {
    expect(migrationSql).toMatch(
      /revoke execute on function public\.create_client\(jsonb\) from public, anon;/i,
    );
    expect(migrationSql).toMatch(
      /revoke execute on function public\.client_email_exists\(text\) from public, anon;/i,
    );
  });

  it('preserves reviewed authenticated and service-role callers', () => {
    expect(migrationSql).toMatch(
      /grant execute on function public\.create_client\(jsonb\) to authenticated, service_role;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.client_email_exists\(text\) to authenticated, service_role;/i,
    );
  });

  it('asserts anon execute was removed after applying grants', () => {
    expect(migrationSql).toMatch(/has_function_privilege\('anon', target_function::oid, 'EXECUTE'\)/i);
    expect(migrationSql).toMatch(/still executable by anon/i);
    expect(migrationSql).toMatch(/public\.create_client\(jsonb\)'::regprocedure/i);
    expect(migrationSql).toMatch(/public\.client_email_exists\(text\)'::regprocedure/i);
    expect(migrationSql).toMatch(/Public client wrapper RPC grant hardening failed/i);
  });

  it('does not re-grant unauthenticated execute access', () => {
    for (const grantStatement of grantStatements) {
      const [, granteeList = ''] = grantStatement.match(/\bto\s+([^;]+);/i) ?? [];
      const grantees = granteeList
        .split(',')
        .map((grantee) => grantee.trim().toLowerCase());

      expect(grantees).not.toContain('public');
      expect(grantees).not.toContain('anon');
    }
  });
});
