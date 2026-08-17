/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  assertDedicatedSmokeTherapistEmail,
  assertSmokeTherapistOwnership,
  assertSmokeTherapistProfileInvariant,
  buildDefaultSmokeTherapistEmail,
  buildSmokeTherapistOwnershipMetadata,
  getMissingSmokeTherapistSecrets,
  shouldSkipSecretlessPullRequest,
  verifySmokeTherapistAuthenticatedReadiness,
} from '../../scripts/provision-ci-smoke-therapist';

describe('provision-ci-smoke-therapist safeguards', () => {
  it('creates the tenant-bound profile before therapist and role mappings', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'scripts/provision-ci-smoke-therapist.ts'),
      'utf8',
    );
    const profileUpsert = source.indexOf("client.from('profiles').upsert({");
    const therapistInsert = source.indexOf("client.from('therapists').insert({");
    const roleMapping = source.indexOf("client.from('user_roles').upsert({");
    const therapistLink = source.indexOf("client.from('user_therapist_links').insert({");

    expect(profileUpsert).toBeGreaterThan(-1);
    expect(therapistInsert).toBeGreaterThan(profileUpsert);
    expect(roleMapping).toBeGreaterThan(therapistInsert);
    expect(therapistLink).toBeGreaterThan(roleMapping);
  });

  it('accepts only dedicated run-owned therapist smoke emails', () => {
    expect(() => assertDedicatedSmokeTherapistEmail(
      'playwright.ci.therapist.auth_browser_smoke.123.2@example.com',
    )).not.toThrow();
    expect(() => assertDedicatedSmokeTherapistEmail('therapist@example.com')).toThrow(/Refusing/);
    expect(() => assertDedicatedSmokeTherapistEmail('playwright.ci.therapist@example.com')).toThrow(/Refusing/);
  });

  it('builds a unique email and ownership metadata from the exact run attempt', () => {
    const env = {
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'auth_browser_smoke',
    } as NodeJS.ProcessEnv;
    const email = buildDefaultSmokeTherapistEmail(env);

    expect(email).toBe('playwright.ci.therapist.auth_browser_smoke.123.2@example.com');
    expect(buildSmokeTherapistOwnershipMetadata(email, env)).toEqual({
      smoke_actor: 'ci_therapist',
      smoke_email: email,
      smoke_run_id: '123',
      smoke_run_attempt: '2',
      smoke_job: 'auth_browser_smoke',
    });
  });

  it('requires admin, publishable, and read-only scope inputs', () => {
    const empty = {} as NodeJS.ProcessEnv;
    expect(getMissingSmokeTherapistSecrets(empty)).toEqual([
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'CI_SMOKE_THERAPIST_SCOPE_EMAIL',
    ]);
    expect(shouldSkipSecretlessPullRequest({ GITHUB_EVENT_NAME: 'pull_request' })).toBe(true);
    expect(shouldSkipSecretlessPullRequest({ GITHUB_EVENT_NAME: 'push' })).toBe(false);
  });

  it('requires exact ownership metadata before cleanup', () => {
    const email = 'playwright.ci.therapist.auth_browser_smoke.123.2@example.com';
    expect(() => assertSmokeTherapistOwnership({
      email,
      app_metadata: {
        smoke_actor: 'ci_therapist',
        smoke_email: email,
        smoke_run_id: '123',
        smoke_run_attempt: '2',
        smoke_job: 'auth_browser_smoke',
      },
    }, email, {
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'auth_browser_smoke',
    })).not.toThrow();

    expect(() => assertSmokeTherapistOwnership({
      email,
      app_metadata: { smoke_actor: 'ci_therapist', smoke_email: email },
    }, email, {
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'auth_browser_smoke',
    })).toThrow(/ownership metadata/);
  });

  it('requires the persisted profile to remain active, therapist-only, and tenant-bound', () => {
    const expected = { userId: 'user-1', organizationId: 'org-1' };
    expect(() => assertSmokeTherapistProfileInvariant({
      id: 'user-1',
      role: 'therapist',
      is_active: true,
      organization_id: 'org-1',
    }, expected)).not.toThrow();

    for (const profile of [
      null,
      { id: 'user-1', role: 'admin', is_active: true, organization_id: 'org-1' },
      { id: 'user-1', role: 'therapist', is_active: false, organization_id: 'org-1' },
      { id: 'user-1', role: 'therapist', is_active: true, organization_id: 'org-2' },
    ]) {
      expect(() => assertSmokeTherapistProfileInvariant(profile, expected)).toThrow(/tenant binding/);
    }
  });

  it('proves login plus exact profile and therapist-link readiness', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
        signOut,
      },
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(table === 'profiles'
              ? {
                  data: {
                    id: 'user-1',
                    role: 'therapist',
                    is_active: true,
                    organization_id: 'org-1',
                  },
                  error: null,
                }
              : table === 'therapists'
                ? {
                    data: {
                      id: 'therapist-1',
                      status: 'active',
                      organization_id: 'org-1',
                      deleted_at: null,
                    },
                    error: null,
                  }
                : { data: { therapist_id: 'therapist-1' }, error: null }),
          })),
        })),
      })),
    } as unknown as SupabaseClient;

    await expect(verifySmokeTherapistAuthenticatedReadiness(client, {
      email: 'playwright.ci.therapist.auth_browser_smoke.123.2@example.com',
      password: 'synthetic-password',
      userId: 'user-1',
      organizationId: 'org-1',
      therapistId: 'therapist-1',
    })).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('fails before data checks when synthetic login is not ready', async () => {
    const from = vi.fn();
    const signOut = vi.fn();
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'invalid credentials' },
        }),
        signOut,
      },
      from,
    } as unknown as SupabaseClient;

    await expect(verifySmokeTherapistAuthenticatedReadiness(client, {
      email: 'playwright.ci.therapist.auth_browser_smoke.123.2@example.com',
      password: 'synthetic-password',
      userId: 'user-1',
      organizationId: 'org-1',
      therapistId: 'therapist-1',
    })).rejects.toThrow(/login failed/);
    expect(from).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
