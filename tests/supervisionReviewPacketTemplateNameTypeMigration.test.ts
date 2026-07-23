import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260723133526_align_supervision_review_packet_template_name_type.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

const extractFunction = (sourceSql: string, name: string): string => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`create or replace function ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`, 'i');
  const match = sourceSql.match(pattern);
  expect(match, `${name} function should exist`).not.toBeNull();
  return match?.[0] ?? '';
};

describe('supervision review packet template-name type migration', () => {
  it('casts the supervision template name to text without widening the rpc contract', () => {
    const fn = extractFunction(sql, 'public.get_pending_supervision_review_packets');

    expect(fn).toContain('template.template_name::text as supervision_template_name');
    expect(fn).not.toContain('template.template_name as supervision_template_name');
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain('security definer');
    expect(sql).not.toMatch(/drop function if exists public\.get_pending_supervision_review_packets/i);
  });

  it('preserves tenant filters, same-org joins, exact bcba checks, and restricted execute grants', () => {
    const fn = extractFunction(sql, 'public.get_pending_supervision_review_packets');

    expect(fn).toContain('where request.organization_id = v_actor_org');
    expect(fn).toContain("request.status in ('pending', 'correction_required', 'resubmitted', 'completed')");
    expect(fn).toContain('where seeded_template.organization_id = request.organization_id');
    expect(fn).toContain('and unresolved.organization_id = request.organization_id');
    expect(fn).toContain("array['admin', 'super_admin', 'org_admin', 'org_super_admin']");
    expect(fn).toContain("array['bcba']::text[]");

    expect(sql).toContain(
      'revoke all on function public.get_pending_supervision_review_packets() from public, anon;',
    );
    expect(sql).toContain(
      'revoke all on function public.get_pending_supervision_review_packets() from authenticated;',
    );
    expect(sql).toContain(
      'grant execute on function public.get_pending_supervision_review_packets() to authenticated, service_role;',
    );
  });
});
