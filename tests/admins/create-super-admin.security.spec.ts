import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('create_super_admin hardening', () => {
  const migrationSql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20251109194300_create_super_admin_patch.sql'),
    'utf-8',
  );

  const functionSqlMatch = migrationSql.match(
    /create or replace function public\.create_super_admin[\s\S]+?\$function\$\;/i,
  );
  const functionSql = functionSqlMatch?.[0] ?? '';

  it('requires a super_admin JWT role and escalates using service_role during execution', () => {
    expect(functionSql, 'create_super_admin function should exist').toBeTruthy();
    expect(functionSql).toMatch(/current_setting\('request\.jwt\.claim\.role', true\)/i);
    expect(functionSql).toMatch(/raise exception using errcode = '42501'/i);
    expect(functionSql).toMatch(/create_super_admin requires a role claim/i);
    expect(functionSql).toMatch(/Only super_admins may call create_super_admin/i);
    expect(functionSql).toMatch(/set_config\('request\.jwt\.claim\.role', 'service_role', true\)/i);
  });

  it('hydrates auth identities and NULL-safe columns before granting roles', () => {
    expect(functionSql).toMatch(/insert into auth\.identities/i);
    expect(functionSql).toMatch(/confirmation_token = coalesce/i);
    expect(functionSql).toMatch(/email_change = coalesce/i);
  });

  it('ensures profiles, user_roles, and admin_actions are updated atomically', () => {
    expect(functionSql).toMatch(/insert into profiles/i);
    expect(functionSql).toMatch(/insert into user_roles/i);
    expect(functionSql).toMatch(/insert into admin_actions/i);
  });

  it('limits function execution grants to service_role', () => {
    expect(migrationSql).toMatch(
      /grant execute on function public\.create_super_admin\(text\) to service_role;/i,
    );
    expect(migrationSql).toMatch(
      /revoke execute on function public\.create_super_admin\(text\) from authenticated;/i,
    );
  });
});
