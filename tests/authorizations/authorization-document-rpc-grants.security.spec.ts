import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('authorization document RPC execute grants', () => {
  const documentRpcMigrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260622142046_restrict_authorization_document_rpc_anon_execute.sql',
    ),
    'utf-8',
  );
  const createRpcMigrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260622164000_restrict_authorization_create_rpc_anon_execute.sql',
    ),
    'utf-8',
  );
  const migrationSql = `${documentRpcMigrationSql}\n${createRpcMigrationSql}`;
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
    expect(migrationSql).toMatch(
      /revoke execute on function public\.create_authorization_with_services\([\s\S]+?\) from public, anon;/i,
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
    expect(migrationSql).toMatch(
      /grant execute on function public\.create_authorization_with_services\([\s\S]+?\) to authenticated, service_role;/i,
    );
  });

  it('asserts anon execute was removed after applying grants', () => {
    expect(migrationSql).toMatch(/has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/i);
    expect(migrationSql).toMatch(/still executable by anon/i);
    expect(createRpcMigrationSql).toMatch(/has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/i);
    expect(createRpcMigrationSql).toMatch(
      /public\.create_authorization_with_services\(uuid, uuid, text, text, text, date, date, text, uuid, text, text, jsonb\)'::regprocedure/i,
    );
    expect(createRpcMigrationSql).toMatch(/Authorization create RPC grant hardening failed/i);
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
