import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const extractFunctionFrom = (sourceSql: string, name: string): string => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`create or replace function ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`, 'i');
  const match = sourceSql.match(pattern);
  expect(match, `${name} function should exist`).not.toBeNull();
  return match?.[0] ?? '';
};

describe('authorization midtier RPC parity migration', () => {
  const migrationsDir = join(process.cwd(), 'supabase/migrations');
  const migrationFile = '20260724163000_forward_fix_midtier_authorization_rpc_parity.sql';
  const migrationSql = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
  const createAuthorizationSql = extractFunctionFrom(
    migrationSql,
    'public.create_authorization_with_services',
  );
  const updateAuthorizationSql = extractFunctionFrom(
    migrationSql,
    'public.update_authorization_with_services',
  );
  const updateDocumentsSql = extractFunctionFrom(
    migrationSql,
    'public.update_authorization_documents',
  );

  it('tracks a single forward migration for the midtier authorization RPC parity fix', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith('_forward_fix_midtier_authorization_rpc_parity.sql'),
    );

    expect(migrationFiles).toEqual([migrationFile]);
  });

  it('switches all manager branches to the exact authorization capability helper', () => {
    expect(createAuthorizationSql).toContain('app.current_user_can_manage_authorizations(v_org_id)');
    expect(updateAuthorizationSql).toContain('app.current_user_can_manage_authorizations(v_org_id)');
    expect(updateDocumentsSql).toContain('app.current_user_can_manage_authorizations(v_org_id)');

    expect(migrationSql).not.toContain("array['org_admin']");
  });

  it('preserves security invoker, org derivation, therapist self-only checks, and document path validation', () => {
    expect(createAuthorizationSql).toContain('security invoker');
    expect(updateAuthorizationSql).toContain('security invoker');
    expect(updateDocumentsSql).toContain('security invoker');

    expect(createAuthorizationSql).toContain('select c.organization_id');
    expect(createAuthorizationSql).toContain('Therapists may only create authorizations for themselves');
    expect(updateAuthorizationSql).toContain('Therapists may only update their own authorizations');
    expect(updateAuthorizationSql).toContain('Therapists may not reassign client_id');
    expect(updateAuthorizationSql).toContain('Therapists may not reassign provider_id');
    expect(updateDocumentsSql).toContain(
      "v_prefix := 'clients/' || v_existing.client_id::text || '/authorizations/' || v_existing.id::text || '/';",
    );
    expect(updateDocumentsSql).toContain('Invalid document path');
  });

  it('keeps super-admin bypass, service-role execute grants, and schema reload intact', () => {
    expect(createAuthorizationSql).toContain('app.current_user_is_super_admin()');
    expect(updateAuthorizationSql).toContain('app.current_user_is_super_admin()');
    expect(updateDocumentsSql).toContain('app.current_user_is_super_admin()');

    expect(migrationSql).toMatch(
      /grant execute on function public\.create_authorization_with_services\([\s\S]+?\) to authenticated, service_role;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.update_authorization_with_services\([\s\S]+?\) to authenticated, service_role;/i,
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.update_authorization_documents\(uuid, jsonb\) to authenticated, service_role;/i,
    );
    expect(migrationSql).toContain("notify pgrst, 'reload schema';");
  });
});
