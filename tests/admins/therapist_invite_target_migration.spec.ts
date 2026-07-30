import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260730170000_therapist_invite_target_lifecycle.sql',
);

const migrationSql = readFileSync(migrationPath, 'utf-8').replace(/\r\n/g, '\n');

const functionSql = migrationSql.match(
  /create or replace function public\.create_admin_invite_token_rate_limited[\s\S]+?\n\$\$;/i,
)?.[0] ?? '';

const createAdminInviteFunctions = Array.from(
  migrationSql.matchAll(/create or replace function public\.create_admin_invite_token_rate_limited\([\s\S]+?\n\$\$;/gi),
).map((match) => match[0]);

const compatibilityWrapperSql = createAdminInviteFunctions.find(
  (sql) => !/p_target_therapist_id uuid/i.test(sql),
) ?? '';

const activeDuplicateLookupSql = functionSql.match(
  /select t\.id, t\.expires_at[\s\S]+?limit 1;/i,
)?.[0] ?? '';

const expiredInviteCleanupSql = functionSql.match(
  /delete from public\.admin_invite_tokens t[\s\S]+?and t\.expires_at <= v_now;/i,
)?.[0] ?? '';

describe('therapist invite target lifecycle migration', () => {
  it('adds invite target and lifecycle columns to admin_invite_tokens', () => {
    expect(migrationSql).toMatch(/add column if not exists target_therapist_id uuid/i);
    expect(migrationSql).toMatch(/references public\.therapists\(id\)/i);
    expect(migrationSql).toMatch(/accepted_at timestamptz/i);
    expect(migrationSql).toMatch(/accepted_by_user_id uuid/i);
    expect(migrationSql).toMatch(/revoked_at timestamptz/i);
  });

  it('extends the service-only RPC to a seven-argument therapist-target-aware signature', () => {
    expect(functionSql).toMatch(/p_target_therapist_id uuid/i);
    expect(functionSql).not.toMatch(/auth\.uid\(\)/i);
    expect(functionSql).toMatch(/service-role-only/i);
  });

  it('preserves the six-argument service-role-only signature as a null-target wrapper', () => {
    expect(compatibilityWrapperSql).toMatch(/returns table\(id uuid, expires_at timestamptz, status text\)/i);
    expect(compatibilityWrapperSql).toMatch(/select\s+\*\s+from public\.create_admin_invite_token_rate_limited\([\s\S]*p_role,[\s\S]*null\s*\)/i);
    expect(migrationSql).toMatch(/revoke all on function public\.create_admin_invite_token_rate_limited\(text, text, uuid, timestamptz, uuid, public\.role_type\) from public, anon, authenticated;/i);
    expect(migrationSql).toMatch(/grant execute on function public\.create_admin_invite_token_rate_limited\(text, text, uuid, timestamptz, uuid, public\.role_type\) to service_role;/i);
  });

  it('validates active target therapists against org, status, deletion, and normalized email', () => {
    expect(functionSql).toMatch(/where t\.id = p_target_therapist_id/i);
    expect(functionSql).toMatch(/t\.organization_id = p_organization_id/i);
    expect(functionSql).toMatch(/t\.deleted_at is null/i);
    expect(functionSql).toMatch(/lower\(trim\(coalesce\(t\.status, 'active'\)\)\) = 'active'/i);
    expect(functionSql).toMatch(/lower\(trim\(t\.email\)\) = v_normalized_email/i);
  });

  it('requires therapist-targeted invites to use the bt role', () => {
    expect(functionSql).toMatch(/p_target_therapist_id is not null/i);
    expect(functionSql).toMatch(/p_role is distinct from 'bt'::public\.role_type/i);
    expect(functionSql).toMatch(/Target therapist invites must use the bt role/i);
  });

  it('treats only unaccepted, unrevoked, unexpired invites as active duplicates', () => {
    expect(functionSql).toMatch(/and t\.accepted_at is null/i);
    expect(functionSql).toMatch(/and t\.revoked_at is null/i);
    expect(functionSql).toMatch(/and t\.expires_at > v_now/i);
  });

  it('blocks targeted invites when a generic active invite already exists for the same org and email', () => {
    expect(activeDuplicateLookupSql).toMatch(/where t\.email = v_normalized_email/i);
    expect(activeDuplicateLookupSql).toMatch(/and t\.organization_id = p_organization_id/i);
    expect(activeDuplicateLookupSql).not.toMatch(/t\.target_therapist_id/i);
  });

  it('blocks generic invites when a targeted active invite already exists for the same org and email', () => {
    expect(functionSql).toMatch(/return query select v_existing_id, v_existing_expires_at, 'active_invite_exists'::text;/i);
    expect(activeDuplicateLookupSql).not.toMatch(/p_target_therapist_id is null/i);
    expect(activeDuplicateLookupSql).not.toMatch(/p_target_therapist_id/i);
  });

  it('prunes expired invites by org and email without preserving generic or targeted coexistence semantics', () => {
    expect(expiredInviteCleanupSql).toMatch(/where t\.email = v_normalized_email/i);
    expect(expiredInviteCleanupSql).toMatch(/and t\.organization_id = p_organization_id/i);
    expect(expiredInviteCleanupSql).not.toMatch(/t\.target_therapist_id/i);
    expect(expiredInviteCleanupSql).not.toMatch(/p_target_therapist_id/i);
  });

  it('keeps the function restricted to service_role execution', () => {
    expect(migrationSql).toMatch(/grant execute[\s\S]+to service_role/i);
  });
});
