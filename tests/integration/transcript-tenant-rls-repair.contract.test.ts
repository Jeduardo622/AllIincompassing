import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('transcript tenant RLS repair migration', () => {
  const migrationFile = '20260715173500_repair_transcript_tenant_rls.sql';
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', migrationFile),
    'utf8',
  ).replace(/\r\n/g, '\n').toLowerCase();

  for (const table of ['session_transcripts', 'session_transcript_segments']) {
    it(`removes the globally scoped policies from ${table}`, () => {
      expect(sql).toContain(
        `drop policy if exists consolidated_select_4c9184 on public.${table};`,
      );
      expect(sql).toContain(
        `drop policy if exists consolidated_select_700633 on public.${table};`,
      );
      expect(sql).toContain(
        `drop policy if exists ${table}_tenant_select on public.${table};`,
      );
      expect(sql).toContain(
        `drop policy if exists ${table}_update_scope on public.${table};`,
      );
      expect(sql).toContain(
        `drop policy if exists ${table}_delete_scope on public.${table};`,
      );
      expect(sql).toContain(
        `drop policy if exists ${table}_tenant_update on public.${table};`,
      );
      expect(sql).toContain(
        `drop policy if exists ${table}_tenant_delete on public.${table};`,
      );
    });

    it(`uses the session as tenant authority for ${table} writes`, () => {
      const selectPolicy = sql.match(
        new RegExp(
          `create policy ${table}_tenant_select on public\\.${table}([\\s\\S]*?)create policy ${table}_tenant_update`,
        ),
      )?.[1] ?? '';
      expect(sql).toContain(
        `create policy ${table}_tenant_update on public.${table}`,
      );
      expect(sql).toContain(
        `create policy ${table}_tenant_delete on public.${table}`,
      );
      const updatePolicy = sql.match(
        new RegExp(
          `create policy ${table}_tenant_update on public\\.${table}([\\s\\S]*?)create policy ${table}_tenant_delete`,
        ),
      )?.[1] ?? '';
      const deletePolicy = sql.match(
        new RegExp(
          `create policy ${table}_tenant_delete on public\\.${table}([\\s\\S]*?);`,
        ),
      )?.[1] ?? '';

      const expectExactTenantPredicate = (policy: string, copies: number) => {
        for (const role of ['admin', 'super_admin', 'therapist']) {
          expect(
            policy.match(
              new RegExp(
                `app\\.user_has_role_for_org\\('${role}', null, null, null, session_id\\)`,
                'g',
              ),
            )?.length,
          ).toBe(copies);
        }
        expect(
          policy.match(
            new RegExp(
              `where s\\.id = ${table}\\.session_id\\s+and s\\.therapist_id = \\(select app\\.current_therapist_id\\(\\)\\)`,
              'g',
            ),
          )?.length,
        ).toBe(copies);
      };

      expect(selectPolicy).toContain('for select\n  to authenticated');
      expectExactTenantPredicate(selectPolicy, 1);
      expect(updatePolicy).toContain('for update\n  to authenticated');
      expectExactTenantPredicate(updatePolicy, 2);
      expect(updatePolicy).toContain('using (');
      expect(updatePolicy).toContain('with check (');
      expect(deletePolicy).toContain('for delete\n  to authenticated');
      expectExactTenantPredicate(deletePolicy, 1);
    });
  }

  it('does not change shared helpers, tables, grants, or stored data', () => {
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/);
    expect(sql).not.toMatch(/\b(create|alter)\s+table\b/);
    expect(sql).not.toMatch(/\b(grant|revoke|insert\s+into|update\s+public\.|delete\s+from)\b/);
    expect(sql.match(/app\.user_has_role_for_org\(/g)?.length).toBe(24);
    expect(sql).not.toContain('app.is_admin()');
    expect(sql).not.toContain('app.can_access_session(');
  });
});
