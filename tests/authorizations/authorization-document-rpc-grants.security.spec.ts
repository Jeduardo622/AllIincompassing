import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('authorization document RPC execute grants', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260622142046_restrict_authorization_document_rpc_anon_execute.sql',
    ),
    'utf-8',
  );
  const grantStatements = migrationSql.match(/grant execute on function[^;]+;/gi) ?? [];

  it('removes unauthenticated execute access from document RPCs', () => {
    expect(migrationSql).toMatch(
      /revoke execute on function public\.can_access_client_documents\(uuid\) from public, anon;/i,
    );
    expect(migrationSql).toMatch(
      /revoke execute on function public\.update_client_documents\(uuid, jsonb\) from public, anon;/i,
    );
    expect(migrationSql).toMatch(
      /revoke execute on function public\.update_authorization_documents\(uuid, jsonb\) from public, anon;/i,
    );
    expect(migrationSql).toMatch(
      /revoke execute on function public\.update_authorization_with_services\([\s\S]+?\) from public, anon;/i,
    );
  });

  it('preserves reviewed authenticated and service-role callers', () => {
    expect(migrationSql).toMatch(
      /grant execute on function public\.can_access_client_documents\(uuid\) to authenticated, service_role;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.update_client_documents\(uuid, jsonb\) to authenticated, service_role;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.update_authorization_documents\(uuid, jsonb\) to authenticated, service_role;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.update_authorization_with_services\([\s\S]+?\) to authenticated, service_role;/i,
    );
  });

  it('asserts anon execute was removed after applying grants', () => {
    expect(migrationSql).toMatch(/has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/i);
    expect(migrationSql).toMatch(/still executable by anon/i);
  });

  it('does not re-grant unauthenticated execute access', () => {
    for (const grantStatement of grantStatements) {
      expect(grantStatement).not.toMatch(/\bto\s+(public|anon)\b/i);
    }
  });
});
