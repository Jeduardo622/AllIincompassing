import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const clientStorageMigration = readFileSync(
  resolve(
    repoRoot,
    'supabase',
    'migrations',
    '20260714230523_repair_trusted_rls_authorization_boundaries.sql',
  ),
  'utf8',
).replace(/\s+/g, ' ');

describe('client document self-upload policy', () => {
  it('retains existing privileged access and adds only active same-org client create-and-read access', () => {
    expect(clientStorageMigration).toMatch(
      /drop policy if exists client_documents_org_insert on storage\.objects/i,
    );
    expect(clientStorageMigration).toMatch(
      /create policy client_documents_org_insert on storage\.objects for insert to authenticated with check/i,
    );
    expect(clientStorageMigration).toContain("bucket_id = 'client-documents'");
    expect(clientStorageMigration).toContain("split_part(name, '/', 1) = 'clients'");
    expect(clientStorageMigration).toContain("array['org_admin', 'org_super_admin']");
    expect(clientStorageMigration).toContain("array['therapist']");
    expect(clientStorageMigration).toContain('s.therapist_id = auth.uid()');
    expect(clientStorageMigration).toContain("array['client']");
    expect(clientStorageMigration).toContain(
      "split_part(name, '/', 2) = auth.uid()::text",
    );
    expect(clientStorageMigration).toMatch(
      /app\.user_has_role_for_org\( app\.current_user_id\(\), \( select c\.organization_id from public\.clients c where c\.id::text = split_part\(name, '\/', 2\) limit 1 \), array\['client'\] \)/i,
    );
    expect(clientStorageMigration).not.toMatch(
      /for insert to authenticated with check\s*\(\s*true\s*\)/i,
    );
    expect(clientStorageMigration).toMatch(
      /drop policy if exists client_documents_org_read on storage\.objects/i,
    );
    expect(clientStorageMigration).toMatch(
      /create policy client_documents_org_read on storage\.objects for select to authenticated using/i,
    );
    expect(clientStorageMigration).toMatch(
      /split_part\(name, '\/', 2\) = auth\.uid\(\)::text/i,
    );
    expect(clientStorageMigration.match(/array\['client'\]/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('trusted RLS authorization boundary repairs', () => {
  it('binds client authorization reads to the target client identity', () => {
    expect(clientStorageMigration).toMatch(
      /create or replace function app\.current_user_can_read_authorization_row/i,
    );
    expect(clientStorageMigration).toMatch(
      /app\.user_has_role_for_org\( 'client', p_organization_id, null, p_client_id, null \)/i,
    );
    expect(clientStorageMigration).not.toContain("array['org_member']");
    expect(clientStorageMigration).toContain("array['therapist']");
    expect(clientStorageMigration).not.toMatch(
      /if p_provider_id is not distinct from app\.current_user_id\(\) then return true; end if; return false/i,
    );
  });

  it('removes permissive session CPT policies before recreating org-scoped CRUD policies', () => {
    expect(clientStorageMigration).toContain("tablename = 'session_cpt_entries'");
    expect(clientStorageMigration).toContain(
      'drop policy if exists %I on public.session_cpt_entries',
    );
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(clientStorageMigration).toContain(
        `create policy "Session CPT entries scoped ${operation}"`,
      );
    }
    expect(clientStorageMigration).toContain(
      "app.user_has_role_for_org('admin', organization_id, null, null, session_id)",
    );
    expect(clientStorageMigration).not.toMatch(/\btrue\s+or\s+true\b/i);

    const outerSessionScopeChecks = clientStorageMigration.match(
      /(?:using|with check) \( exists \( select 1 from public\.sessions scoped_session where scoped_session\.id = session_cpt_entries\.session_id and scoped_session\.organization_id = session_cpt_entries\.organization_id \) and \(/gi,
    ) ?? [];
    expect(outerSessionScopeChecks).toHaveLength(5);
    expect(
      clientStorageMigration.match(/assigned_session\.therapist_id = auth\.uid\(\)/g) ?? [],
    ).toHaveLength(5);
  });

  it('restores same-org therapist self-management for certifications', () => {
    expect(clientStorageMigration).toContain("tablename = 'therapist_certifications'");
    expect(clientStorageMigration).toContain(
      "app.user_has_role_for_org('therapist', organization_id, therapist_id, null, null)",
    );
    expect(clientStorageMigration).toContain('therapist_id = auth.uid()');
  });
});
