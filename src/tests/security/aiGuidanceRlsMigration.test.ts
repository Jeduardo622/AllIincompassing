import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260310162000_harden_ai_guidance_documents_rls.sql',
);

describe('ai_guidance_documents RLS hardening migration', () => {
  it('defines explicit read policy and revokes broad grants', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create policy ai_guidance_documents_read');
    expect(sql).toContain("revoke all on table public.ai_guidance_documents from anon, authenticated;");
    expect(sql).toContain('grant select on table public.ai_guidance_documents to authenticated;');
  });
});
