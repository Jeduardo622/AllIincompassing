/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ROTATION_PERSONAS,
  getMissingRotationEnvVars,
  parseMode,
  resolveRotationPersonaCredentials,
} from '../../scripts/rotate-persistent-qa-persona-credentials';

describe('persistent QA persona credential rotation safeguards', () => {
  it('binds the exact eight stable emails and auth user ids from the WIN-43 manifest', () => {
    expect(ROTATION_PERSONAS.map(({ role, authUserId }) => ({ role, authUserId }))).toEqual([
      { role: 'bt', authUserId: '48e62486-b142-4e6a-8e1e-165d6a8f6821' },
      { role: 'therapist', authUserId: 'ab03f560-8a71-4929-91ad-74be523d3c93' },
      { role: 'bcba', authUserId: 'f4488d24-bb11-482f-9367-bbb7e726e026' },
      { role: 'midtier', authUserId: 'bfaaad8d-cf0c-4843-81c4-680b564d3737' },
      { role: 'admin_schedule', authUserId: 'ad44fe11-7297-467b-9fed-0a8c6f56ce98' },
      { role: 'client', authUserId: '87130857-af13-4fe1-8195-c75710d5325f' },
      { role: 'admin', authUserId: 'a67fa20b-b3f9-4625-98c4-ba106cc7a434' },
      { role: 'super_admin', authUserId: '5ba467e1-ef50-4247-bbb2-099ab70c26bb' },
    ]);

    for (const persona of ROTATION_PERSONAS) {
      expect(resolveRotationPersonaCredentials(persona, 'rotation', {
        [`QA_ROTATION_${persona.credentialEnv.secretBase}_EMAIL`]: `playwright.qa.${persona.role}@example.com`,
        [`QA_ROTATION_${persona.credentialEnv.secretBase}_PASSWORD`]: 'Valid-Password-For-QA-2026!',
        ...(persona.credentialEnv.aliasSecretBase
          ? {
            [`QA_ROTATION_${persona.credentialEnv.aliasSecretBase}_EMAIL`]: `playwright.qa.${persona.role}@example.com`,
            [`QA_ROTATION_${persona.credentialEnv.aliasSecretBase}_PASSWORD`]: 'Valid-Password-For-QA-2026!',
          }
          : {}),
      }).email).toBe(`playwright.qa.${persona.role}@example.com`);
    }
  });

  it('requires bootstrap and rotation credential env vars, including schedule alias parity inputs', () => {
    const missing = getMissingRotationEnvVars({});
    const requiredCredentialEnvVars = ['BOOTSTRAP', 'ROTATION'].flatMap((set) => [
      ...ROTATION_PERSONAS.flatMap((persona) => [
        `QA_${set}_${persona.credentialEnv.secretBase}_EMAIL`,
        `QA_${set}_${persona.credentialEnv.secretBase}_PASSWORD`,
      ]),
      `QA_${set}_SCHEDULE_EMAIL`,
      `QA_${set}_SCHEDULE_PASSWORD`,
    ]);

    expect(missing.sort()).toEqual([
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_URL',
      'QA_PERSONA_MANIFEST_PATH',
      ...requiredCredentialEnvVars,
    ].sort());
  });

  it('rejects drifted emails, weak passwords, and schedule alias mismatches for each staged set', () => {
    const schedulePersona = ROTATION_PERSONAS.find(({ role }) => role === 'admin_schedule')!;

    expect(() => resolveRotationPersonaCredentials(schedulePersona, 'bootstrap', {
      QA_BOOTSTRAP_ADMIN_SCHEDULE_EMAIL: 'playwright.qa.schedule@example.com',
      QA_BOOTSTRAP_ADMIN_SCHEDULE_PASSWORD: 'Valid-Password-For-QA-2026!',
      QA_BOOTSTRAP_SCHEDULE_EMAIL: 'playwright.qa.schedule@example.com',
      QA_BOOTSTRAP_SCHEDULE_PASSWORD: 'Valid-Password-For-QA-2026!',
    })).toThrow(/Refusing drifted QA persona email/);

    expect(() => resolveRotationPersonaCredentials(schedulePersona, 'rotation', {
      QA_ROTATION_ADMIN_SCHEDULE_EMAIL: 'playwright.qa.admin_schedule@example.com',
      QA_ROTATION_ADMIN_SCHEDULE_PASSWORD: 'Valid-Password-For-QA-2026!',
      QA_ROTATION_SCHEDULE_EMAIL: 'playwright.qa.admin_schedule@example.com',
      QA_ROTATION_SCHEDULE_PASSWORD: 'Different-Password-For-QA-2026!',
    })).toThrow(/must exactly match QA_ROTATION_ADMIN_SCHEDULE_PASSWORD/);

    expect(() => resolveRotationPersonaCredentials(schedulePersona, 'rotation', {
      QA_ROTATION_ADMIN_SCHEDULE_EMAIL: 'playwright.qa.admin_schedule@example.com',
      QA_ROTATION_ADMIN_SCHEDULE_PASSWORD: 'short',
      QA_ROTATION_SCHEDULE_EMAIL: 'playwright.qa.admin_schedule@example.com',
      QA_ROTATION_SCHEDULE_PASSWORD: 'short',
    })).toThrow(/at least 24 characters/);
  });

  it('requires exactly one explicit rotation mode', () => {
    expect(() => parseMode([])).toThrow(/exactly one mode/);
    expect(() => parseMode(['--rotate', '--extra'])).toThrow(/exactly one mode/);
    expect(parseMode(['--rotate'])).toBe('rotate');
  });

  it('contains no dotenv import, no create or delete user path, and no secret or raw error manifest field', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'scripts/rotate-persistent-qa-persona-credentials.ts'),
      'utf8',
    );

    expect(source).not.toContain("from 'dotenv'");
    expect(source).toContain('adminClient.auth.admin.updateUserById');
    expect(source).not.toContain('auth.admin.createUser');
    expect(source).not.toContain('auth.admin.deleteUser');
    expect(source).not.toMatch(/from\('profiles'|from\('therapists'|from\('clients'|from\('user_roles'|from\('client_therapist_links'|from\('user_therapist_links'/);
    const manifestShape = source.slice(
      source.indexOf('type ManifestPersonaResult'),
      source.indexOf('type ManifestRecord'),
    );
    expect(manifestShape).not.toContain('password:');
    const manifestRecordShape = source.slice(
      source.indexOf('type ManifestRecord'),
      source.indexOf('export const ROTATION_PERSONAS'),
    );
    expect(manifestRecordShape).not.toContain('error?:');
    expect(source).not.toContain('PW_ADMIN_EMAIL');
    expect(source).toContain('rollbackApplied: boolean;');
    expect(source).toContain('main().catch(() => {');
    expect(source).not.toContain('error: serializeError(error)');
  });

  it('preflights both credential sets, authenticates immediately after each update, and rolls back in reverse order', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'scripts/rotate-persistent-qa-persona-credentials.ts'),
      'utf8',
    );

    expect(source.indexOf("resolveRotationPersonaCredentials(persona, 'bootstrap')"))
      .toBeLessThan(source.indexOf("resolveRotationPersonaCredentials(persona, 'rotation')"));
    expect(source.indexOf('assertDistinctCredentialSets(persona, bootstrapCredentials, rotationCredentials)'))
      .toBeLessThan(source.indexOf('adminClient.auth.admin.updateUserById'));
    expect(source.indexOf('mutatedContexts.push(context)'))
      .toBeLessThan(source.indexOf('await verifyPasswordLogin(context.definition, context.rotationCredentials)'));
    expect(source.indexOf('await verifyPasswordLogin(context.definition, context.rotationCredentials)'))
      .toBeLessThan(source.indexOf("statuses.set(context.definition.role, 'rotated_authenticated')"));
    expect(source).toContain('for (const context of [...mutatedContexts].reverse())');
    expect(source.indexOf('await verifyPasswordLogin(context.definition, context.bootstrapCredentials)'))
      .toBeLessThan(source.indexOf("statuses.set(context.definition.role, 'rollback_authenticated')"));
  });
});
