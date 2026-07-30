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

  it('validates active target therapists against org, status, deletion, and normalized email', () => {
    expect(functionSql).toMatch(/where t\.id = p_target_therapist_id/i);
    expect(functionSql).toMatch(/t\.organization_id = p_organization_id/i);
    expect(functionSql).toMatch(/t\.deleted_at is null/i);
    expect(functionSql).toMatch(/lower\(coalesce\(t\.status, 'active'\)\) = 'active'/i);
    expect(functionSql).toMatch(/lower\(trim\(t\.email\)\) = v_normalized_email/i);
  });

  it('treats only unaccepted, unrevoked, unexpired invites as active duplicates', () => {
    expect(functionSql).toMatch(/and t\.accepted_at is null/i);
    expect(functionSql).toMatch(/and t\.revoked_at is null/i);
    expect(functionSql).toMatch(/and t\.expires_at > v_now/i);
  });

  it('keeps the function restricted to service_role execution', () => {
    expect(migrationSql).toMatch(/grant execute[\s\S]+to service_role/i);
  });
});
