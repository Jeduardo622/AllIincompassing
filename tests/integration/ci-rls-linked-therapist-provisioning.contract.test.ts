import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('linked therapist CI RLS provisioning migration', () => {
  const migrationFile = '20260715201001_support_ci_rls_linked_therapist.sql';
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', migrationFile),
    'utf8',
  )
    .replace(/\r\n/g, '\n')
    .toLowerCase();
  const therapistBranch = sql.match(
    /if resolved_role = 'therapist'::public\.role_type then([\s\S]*?)elsif resolved_role = 'client'::public\.role_type then/,
  )?.[1] ?? '';

  it('resolves a single non-deleted linked therapist before same-id fallback', () => {
    expect(therapistBranch).toContain('from public.user_therapist_links utl');
    expect(therapistBranch).toContain('join public.therapists t on t.id = utl.therapist_id');
    expect(therapistBranch).toContain('where utl.user_id = p_user_id');
    expect(therapistBranch).toContain('and t.deleted_at is null');
    expect(therapistBranch).toContain('linked_therapist_count');
    expect(therapistBranch).toContain('linked_organization_count');
    expect(therapistBranch).toContain('if linked_therapist_count = 0 then');
    expect(therapistBranch).toContain('where t.id = p_user_id');
  });

  it('fails closed for ambiguous linked therapist authority', () => {
    expect(therapistBranch).toContain(
      'if linked_therapist_count <> 1 or linked_organization_count <> 1 then',
    );
    expect(therapistBranch).toContain(
      "message = 'synthetic rls actor therapist mapping is ambiguous'",
    );
    expect(sql).toContain(
      "message = 'synthetic rls actor organization mismatch'",
    );
    expect(therapistBranch).not.toContain('raw_user_meta_data');
    expect(therapistBranch).not.toContain('raw_app_meta_data');
  });

  it('pins the privileged function and aggregate envelope', () => {
    expect(sql.trimStart().startsWith('-- @migration-intent:')).toBe(true);
    expect(sql).toContain('\nbegin;\n');
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql).toContain(
      'create or replace function public.provision_ci_rls_fixture_profile(',
    );
    expect(sql).toContain('security definer\nset search_path = \'\'');
    expect(therapistBranch).toContain('count(*)::integer');
    expect(therapistBranch).toContain(
      'count(distinct t.organization_id)::integer',
    );
    expect(therapistBranch).toContain(
      '(array_agg(distinct t.organization_id))[1]',
    );
    expect(therapistBranch).toMatch(
      /into\s+linked_therapist_count,\s+linked_organization_count,\s+resolved_organization_id/,
    );
  });

  it('preserves all synthetic actor guardrails and profile update containment', () => {
    for (const message of [
      'synthetic rls actor email is not eligible',
      'synthetic rls actor marker is required',
      'synthetic rls actor marker is expired',
      'synthetic rls actor must have exactly one active role',
      'synthetic rls actor role is not allowed',
    ]) {
      expect(sql).toContain(`message = '${message}'`);
    }
    expect(sql).toContain("perform set_config('app.bypass_profile_role_guard', 'on', true)");
    expect(sql).toContain("perform set_config('app.bypass_profile_role_guard', 'off', true)");
    expect(sql).toContain('update public.profiles');
    expect(sql).not.toMatch(/\b(insert into|delete from|alter table|create table)\b/);
  });

  it('keeps the provisioning RPC service-role only', () => {
    const signature = 'public.provision_ci_rls_fixture_profile(uuid, uuid)';
    expect(sql).toContain(`revoke execute on function ${signature} from public;`);
    expect(sql).toContain(`revoke execute on function ${signature} from anon;`);
    expect(sql).toContain(`revoke execute on function ${signature} from authenticated;`);
    expect(sql).toContain(`grant execute on function ${signature} to service_role;`);
  });
});
