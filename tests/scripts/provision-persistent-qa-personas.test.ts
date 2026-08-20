/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertStrongQaPersonaPassword,
  assertEmptyQaPersonaNamespace,
  assertNoUnexpectedClientTherapistLinks,
  buildPersonaAppMetadata,
  buildPersonaAuthMetadata,
  buildPersonaEmail,
  getMissingQaPersonaEnvVars,
  isDeniedPersonaName,
  isOwnedQaPersonaAppMetadata,
  parseMode,
  QA_PERSONAS,
  resolvePersonaCredentials,
  TARGET_ORGANIZATION_ID,
} from '../../scripts/provision-persistent-qa-personas';

describe('persistent QA persona provisioner safeguards', () => {
  it('defines the exact eight stable role identities', () => {
    expect(QA_PERSONAS.map(({ role }) => role)).toEqual([
      'bt',
      'therapist',
      'bcba',
      'midtier',
      'admin_schedule',
      'client',
      'admin',
      'super_admin',
    ]);
    for (const persona of QA_PERSONAS) {
      expect(buildPersonaEmail(persona.role)).toBe(`playwright.qa.${persona.role}@example.com`);
    }
  });

  it('requires exact ownership metadata including role, email, issue, and organization', () => {
    const metadata = buildPersonaAppMetadata('therapist');
    expect(isOwnedQaPersonaAppMetadata(metadata, 'therapist')).toBe(true);
    expect(isOwnedQaPersonaAppMetadata({ ...metadata, qa_persona_email: 'steve@example.com' }, 'therapist')).toBe(false);
    expect(isOwnedQaPersonaAppMetadata({ ...metadata, organization_id: 'other-org' }, 'therapist')).toBe(false);
    expect(isOwnedQaPersonaAppMetadata(metadata, 'bt')).toBe(false);
  });

  it('includes complete trusted auth metadata for profile synchronization', () => {
    const persona = QA_PERSONAS.find(({ role }) => role === 'midtier');
    expect(persona).toBeDefined();
    expect(buildPersonaAuthMetadata(persona!)).toEqual({
      first_name: 'Playwright',
      last_name: 'Midtier',
      full_name: 'Playwright QA Midtier',
      role: 'midtier',
      signup_role: 'midtier',
      organization_id: TARGET_ORGANIZATION_ID,
      organizationId: TARGET_ORGANIZATION_ID,
      name: 'Playwright QA Midtier',
    });
  });

  it('rejects reserved people, drifted email, and weak passwords without exposing a password', () => {
    expect(isDeniedPersonaName('steve   job')).toBe(true);
    expect(isDeniedPersonaName('MJ Menjivar')).toBe(true);
    expect(() => assertStrongQaPersonaPassword('testpass123')).toThrow(/at least 24 characters/);
    expect(() => assertStrongQaPersonaPassword('LongEnoughButMissingNumber!')).toThrow(/at least 24 characters/);
    expect(() => assertStrongQaPersonaPassword('Valid-Password-For-QA-2026!')).not.toThrow();

    const therapist = QA_PERSONAS.find(({ role }) => role === 'therapist')!;
    expect(() => resolvePersonaCredentials(therapist, {
      PW_THERAPIST_EMAIL: 'steve@example.com',
      PW_THERAPIST_PASSWORD: 'Valid-Password-For-QA-2026!',
    })).toThrow(/Refusing drifted QA persona email/);
  });

  it('requires every credential pair and exactly one explicit mode', () => {
    const missing = getMissingQaPersonaEnvVars({});
    expect(missing).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(missing).toContain('PW_ADMIN_SCHEDULE_PASSWORD');
    expect(missing).toContain('PW_SUPERADMIN_EMAIL');
    expect(() => parseMode([])).toThrow(/exactly one mode/);
    expect(() => parseMode(['--provision', '--verify'])).toThrow(/exactly one mode/);
    expect(parseMode(['--provision'])).toBe('provision');
    expect(parseMode(['--verify'])).toBe('verify');
  });

  it('requires a completely empty reserved namespace before any provisioning mutation', () => {
    expect(() => assertEmptyQaPersonaNamespace([])).not.toThrow();
    expect(() => assertEmptyQaPersonaNamespace([
      { surface: 'auth', email: 'playwright.qa.bt@example.com' },
      { surface: 'profiles', email: 'playwright.qa.bt@example.com' },
    ])).toThrow(/namespace is not empty on: auth, profiles/);
  });

  it('fails closed instead of deleting unexpected client graph links', () => {
    const allowed = new Set(['qa-bt', 'qa-therapist']);
    expect(() => assertNoUnexpectedClientTherapistLinks(['qa-bt'], allowed)).not.toThrow();
    expect(() => assertNoUnexpectedClientTherapistLinks(['qa-bt', 'steve-or-mj'], allowed))
      .toThrow(/refusing destructive repair/);
  });

  it('contains no dotenv path, direct auth.users SQL, cleanup mode, or password artifact field', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'scripts/provision-persistent-qa-personas.ts'),
      'utf8',
    );
    expect(source).not.toContain("from 'dotenv'");
    expect(source).not.toMatch(/auth\.users/i);
    expect(source).not.toContain("'cleanup'");
    const manifestShape = source.slice(
      source.indexOf('type ManifestPersonaResult'),
      source.indexOf('type ManifestRecord'),
    );
    expect(manifestShape).not.toContain('password:');
    expect(manifestShape).not.toContain('passwordEnv');
    const manifestRecordShape = source.slice(
      source.indexOf('type ManifestRecord'),
      source.indexOf('type PersonaRunContext'),
    );
    expect(manifestRecordShape).not.toContain('error?:');
    expect(source).not.toContain('client.auth.admin.updateUserById');
    expect(source).not.toContain('client_therapist_links extra-link cleanup');
    expect(source).toContain("main().catch(() => {");
    expect(source).not.toContain('error: serializeError(error)');
    expect(source.indexOf('await preflightEmptyQaPersonaNamespace(adminClient)'))
      .toBeLessThan(source.indexOf('await ensureOwnedAuthUser(adminClient'));
    expect(source).toContain("client.auth.admin.createUser");
  });

  it('is backed by the existing Auth-org and junction-role profile synchronization triggers', () => {
    const triggerMigration = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20250710000000_create_profiles_table.sql'),
      'utf8',
    );
    const orgSyncMigration = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20260703195500_sync_user_profile_organization_scope.sql'),
      'utf8',
    );
    const roleSyncMigration = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20251205094500_profile_role_guard_fix.sql'),
      'utf8',
    );

    expect(triggerMigration).toMatch(/AFTER INSERT OR UPDATE ON auth\.users[\s\S]*sync_user_profile\(\)/);
    expect(triggerMigration).toMatch(/AFTER INSERT ON user_roles[\s\S]*sync_profile_role\(\)/);
    expect(orgSyncMigration).toContain('user_org_id := public.get_organization_id_from_metadata(NEW.raw_user_meta_data);');
    expect(roleSyncMigration).toContain('v_next_role role_type := get_user_role_from_junction(v_target_user);');
  });
});
