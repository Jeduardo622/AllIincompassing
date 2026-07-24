import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260724160000_forward_correct_staff_messaging_org_member_drift.sql',
  ),
  'utf-8',
);

const extractFunction = (functionName: string): string => {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `create or replace function ${escapedFunctionName}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  );
  const match = migrationSql.match(pattern);
  expect(match, `Expected function ${functionName} in migration`).not.toBeNull();
  return match?.[0] ?? '';
};

describe('staff messaging midtier parity migration', () => {
  const memberHelper = extractFunction('app.is_active_staff_messaging_member');
  const recipientList = extractFunction('public.list_eligible_staff_for_messaging');
  const callerGateMatch = recipientList.match(
    /if not app\.user_has_any_active_role_for_org\(\s*v_actor,\s*p_organization_id,\s*array\[(?<roles>[\s\S]*?)\]\s*\) then/i,
  );
  expect(callerGateMatch, 'Expected direct-messaging caller gate in list RPC').not.toBeNull();
  const callerGateRoles = callerGateMatch?.groups?.roles ?? '';
  const grantStatements = migrationSql.match(/grant execute on function[^;]+;/gi) ?? [];

  it('keeps the migration limited to the two direct-messaging membership functions', () => {
    expect(migrationSql).not.toMatch(/\bcreate table\b|\balter table\b|\bcreate policy\b|\bdrop policy\b/i);
    expect(migrationSql).not.toMatch(/\bgrant\s+(?:select|insert|update|delete|all)\s+on\s+table\b/i);
    expect(migrationSql).not.toMatch(/create_staff_message_thread|staff_messaging_caller_can_create_group|staff_messaging_caller_is_therapist_only/i);
  });

  it('preserves the same-org active user_roles authority for the member helper while adding current direct messaging roles', () => {
    expect(memberHelper).toMatch(/security definer/i);
    expect(memberHelper).toMatch(/set search_path = public, auth/i);
    expect(memberHelper).toMatch(/join public\.user_roles ur on ur\.user_id = p\.id/i);
    expect(memberHelper).toMatch(/join public\.roles r on r\.id = ur\.role_id/i);
    expect(memberHelper).toMatch(/app\.resolve_user_organization_id\(p_user_id\) = p_organization_id/i);
    expect(memberHelper).toMatch(/coalesce\(p\.is_active, true\) = true/i);
    expect(memberHelper).toMatch(/coalesce\(ur\.is_active, true\) = true/i);
    expect(memberHelper).toMatch(/\(ur\.expires_at is null or ur\.expires_at > timezone\('utc', now\(\)\)\)/i);

    for (const roleName of [
      'bt',
      'therapist',
      'midtier',
      'admin_schedule',
      'admin',
      'bcba',
      'super_admin',
      'org_admin',
      'org_super_admin',
    ]) {
      expect(memberHelper).toContain(`'${roleName}'`);
    }

    expect(memberHelper).not.toContain("'org_member'");
    expect(memberHelper).not.toMatch(/'client'/i);
  });

  it('keeps the recipient list security posture and expands caller eligibility through the same direct-messaging roles', () => {
    expect(recipientList).toMatch(/security definer/i);
    expect(recipientList).toMatch(/set search_path = public, auth, app/i);
    expect(recipientList).toMatch(/v_actor_org := app\.resolve_user_organization_id\(v_actor\)/i);
    expect(recipientList).toMatch(/v_actor_org is null or v_actor_org <> p_organization_id/i);
    expect(recipientList).toMatch(/insufficient role to list messaging recipients/i);
    expect(recipientList).not.toMatch(/app\.user_has_role_for_org\(/i);

    for (const roleName of [
      'bt',
      'therapist',
      'midtier',
      'admin_schedule',
      'admin',
      'bcba',
      'super_admin',
    ]) {
      expect(callerGateRoles).toContain(`'${roleName}'`);
    }

    for (const aliasRole of ['org_admin', 'org_super_admin']) {
      expect(callerGateRoles).toContain(`'${aliasRole}'`);
    }

    expect(callerGateRoles).not.toContain("'org_member'");
    expect(callerGateRoles).not.toMatch(/'client'/i);
  });

  it('preserves legacy role aliases in the returned direct-messaging role labels', () => {
    expect(recipientList).toMatch(/when r\.name in \('admin', 'org_admin'\) then 'admin'/i);
    expect(recipientList).toMatch(/when r\.name in \('super_admin', 'org_super_admin'\) then 'super_admin'/i);
    expect(recipientList).toMatch(/when r\.name = 'therapist' then 'therapist'/i);
    expect(recipientList).not.toContain("'org_member'");
    expect(recipientList).not.toMatch(/'client'/i);
  });

  it('keeps org_member and client roles out of the staff recipient filter', () => {
    const recipientRoleFilterMatch = recipientList.match(
      /and r\.name in \((?<roles>[\s\S]*?)\)\s+order by/i,
    );
    expect(recipientRoleFilterMatch, 'Expected direct staff recipient role filter').not.toBeNull();
    const recipientRoleFilter = recipientRoleFilterMatch?.groups?.roles ?? '';

    for (const roleName of [
      'bt',
      'therapist',
      'midtier',
      'admin_schedule',
      'admin',
      'bcba',
      'super_admin',
      'org_admin',
      'org_super_admin',
    ]) {
      expect(recipientRoleFilter).toContain(`'${roleName}'`);
    }

    expect(recipientRoleFilter).not.toContain("'org_member'");
    expect(recipientRoleFilter).not.toMatch(/'client'/i);
  });

  it('keeps execute grants narrowed to authenticated and service_role only', () => {
    expect(migrationSql).toMatch(/revoke all on function app\.is_active_staff_messaging_member\(uuid, uuid\) from public/i);
    expect(migrationSql).toMatch(/grant execute on function app\.is_active_staff_messaging_member\(uuid, uuid\) to authenticated, service_role/i);
    expect(migrationSql).toMatch(/revoke all on function public\.list_eligible_staff_for_messaging\(uuid\) from public, anon/i);
    expect(migrationSql).toMatch(/grant execute on function public\.list_eligible_staff_for_messaging\(uuid\) to authenticated, service_role/i);

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
