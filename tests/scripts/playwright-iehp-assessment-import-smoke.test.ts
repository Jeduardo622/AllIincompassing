/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  assertIehpAssessorPhoneChecklist,
  normalizeAssessmentChecklistResponse,
  selectConfiguredSmokeClient,
} from '../../scripts/playwright-iehp-assessment-import-smoke';

const sliceWorkflowJob = (workflow: string, jobName: string): string => {
  const start = workflow.indexOf(`  ${jobName}:`);
  expect(start).toBeGreaterThanOrEqual(0);

  const afterJobName = start + `  ${jobName}:`.length;
  const rest = workflow.slice(afterJobName);
  const nextJob = rest.search(/\n  [A-Za-z0-9_]+:\r?\n/);

  return nextJob === -1 ? workflow.slice(start) : workflow.slice(start, afterJobName + nextJob);
};

describe('selectConfiguredSmokeClient', () => {
  it('falls back to the next configured credential when the first seed password drifted', async () => {
    const signInWithPassword = vi
      .fn()
      .mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { code: 'invalid_credentials', status: 400 },
      })
      .mockResolvedValueOnce({
        data: {
          session: { access_token: 'admin-token' },
          user: { id: 'admin-user' },
        },
        error: null,
      });
    const therapistMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'therapist-123', phone: '(951) 555-0101' },
      error: null,
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'client-123', therapist_id: 'therapist-123' },
      error: null,
    });
    const anonClient = {
      auth: { signInWithPassword },
      from: vi.fn((table: string) => {
        if (table === 'clients') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle })),
            })),
          };
        }
        if (table === 'therapists') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: therapistMaybeSingle })),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    const clientFactory = vi.fn(() => anonClient);

    const result = await selectConfiguredSmokeClient(
      'https://example.supabase.co',
      'anon-key',
      [
        {
          email: 'superadmin@test.com',
          password: 'drifted-secret',
          label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
        },
        {
          email: 'admin@test.com',
          password: 'valid-secret',
          label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
        },
      ],
      {
        clientFactory: clientFactory as never,
        env: {
          PW_ASSESSMENT_CLIENT_ID: 'client-123',
        } as NodeJS.ProcessEnv,
      },
    );

    expect(result).toEqual({
      accessToken: 'admin-token',
      clientId: 'client-123',
      therapistId: 'therapist-123',
      expectedAssessorPhone: '(951) 555-0101',
      credentials: {
        email: 'admin@test.com',
        password: 'valid-secret',
        label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
      },
    });
    expect(signInWithPassword).toHaveBeenNthCalledWith(1, {
      email: 'superadmin@test.com',
      password: 'drifted-secret',
    });
    expect(signInWithPassword).toHaveBeenNthCalledWith(2, {
      email: 'admin@test.com',
      password: 'valid-secret',
    });
  });

  it('does not try the next credential for generic auth 400 errors', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { code: 'bad_request', status: 400 },
    });
    const anonClient = {
      auth: { signInWithPassword },
      from: vi.fn(),
    };
    const clientFactory = vi.fn(() => anonClient);

    await expect(
      selectConfiguredSmokeClient(
        'https://example.supabase.co',
        'anon-key',
        [
          {
            email: 'superadmin@test.com',
            password: 'bad-request-secret',
            label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
          },
          {
            email: 'admin@test.com',
            password: 'valid-secret',
            label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
          },
        ],
        {
          clientFactory: clientFactory as never,
          env: {
            PW_ASSESSMENT_CLIENT_ID: 'client-123',
          } as NodeJS.ProcessEnv,
        },
      ),
    ).rejects.toMatchObject({ code: 'bad_request' });

    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(anonClient.from).not.toHaveBeenCalled();
  });

  it('fails immediately when an authenticated credential cannot access the configured client', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: 'super-admin-token' },
        user: { id: 'super-admin-user' },
      },
      error: null,
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const anonClient = {
      auth: { signInWithPassword },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    };
    const clientFactory = vi.fn(() => anonClient);

    await expect(
      selectConfiguredSmokeClient(
        'https://example.supabase.co',
        'anon-key',
        [
          {
            email: 'superadmin@test.com',
            password: 'valid-but-wrong-client',
            label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
          },
          {
            email: 'admin@test.com',
            password: 'valid-secret',
            label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
          },
        ],
        {
          clientFactory: clientFactory as never,
          env: {
            PW_ASSESSMENT_CLIENT_ID: 'client-123',
          } as NodeJS.ProcessEnv,
        },
      ),
    ).rejects.toThrow(
      'Configured PW_ASSESSMENT_CLIENT_ID is not accessible for authenticated credential: PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD.',
    );

    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('loads the configured client primary therapist phone for deterministic IEHP smoke assertions', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: 'super-admin-token' },
        user: { id: 'super-admin-user' },
      },
      error: null,
    });
    const therapistMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'therapist-123', phone: '(951) 555-0101' },
      error: null,
    });
    const clientMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'client-123', therapist_id: 'therapist-123' },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: clientMaybeSingle })),
          })),
        };
      }
      if (table === 'therapists') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: therapistMaybeSingle })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    const anonClient = {
      auth: { signInWithPassword },
      from,
    };
    const clientFactory = vi.fn(() => anonClient);

    const result = await selectConfiguredSmokeClient(
      'https://example.supabase.co',
      'anon-key',
      [
        {
          email: 'superadmin@test.com',
          password: 'valid-secret',
          label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
        },
      ],
      {
        clientFactory: clientFactory as never,
        env: {
          PW_ASSESSMENT_CLIENT_ID: 'client-123',
        } as NodeJS.ProcessEnv,
      },
    );

    expect(result).toEqual({
      accessToken: 'super-admin-token',
      clientId: 'client-123',
      therapistId: 'therapist-123',
      expectedAssessorPhone: '(951) 555-0101',
      credentials: {
        email: 'superadmin@test.com',
        password: 'valid-secret',
        label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
      },
    });
  });

  it('fails closed before upload when the configured smoke client lacks a deterministic primary therapist phone', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: 'super-admin-token' },
        user: { id: 'super-admin-user' },
      },
      error: null,
    });
    const clientMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'client-123', therapist_id: null },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: clientMaybeSingle })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    const anonClient = {
      auth: { signInWithPassword },
      from,
    };
    const clientFactory = vi.fn(() => anonClient);

    await expect(
      selectConfiguredSmokeClient(
        'https://example.supabase.co',
        'anon-key',
        [
          {
            email: 'superadmin@test.com',
            password: 'valid-secret',
            label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
          },
        ],
        {
          clientFactory: clientFactory as never,
          env: {
            PW_ASSESSMENT_CLIENT_ID: 'client-123',
          } as NodeJS.ProcessEnv,
        },
      ),
    ).rejects.toThrow(
      'Configured PW_ASSESSMENT_CLIENT_ID must expose a primary therapist with a non-empty phone for IEHP assessment import smoke.',
    );
  });

  it('rejects a malformed configured primary therapist phone before upload', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: 'super-admin-token' },
        user: { id: 'super-admin-user' },
      },
      error: null,
    });
    const clientMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'client-123', therapist_id: 'therapist-123' },
      error: null,
    });
    const therapistMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'therapist-123', phone: 'not-a-phone' },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: clientMaybeSingle })),
          })),
        };
      }
      if (table === 'therapists') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: therapistMaybeSingle })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(
      selectConfiguredSmokeClient(
        'https://example.supabase.co',
        'anon-key',
        [
          {
            email: 'superadmin@test.com',
            password: 'valid-secret',
            label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
          },
        ],
        {
          clientFactory: vi.fn(() => ({ auth: { signInWithPassword }, from })) as never,
          env: {
            PW_ASSESSMENT_CLIENT_ID: 'client-123',
          } as NodeJS.ProcessEnv,
        },
      ),
    ).rejects.toThrow(
      'Configured PW_ASSESSMENT_CLIENT_ID must expose a primary therapist with an accepted phone format for IEHP assessment import smoke.',
    );
  });

  it('keeps the CI IEHP smoke path dedicated to the generated super-admin account', () => {
    const root = process.cwd();
    const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const script = readFileSync(path.join(root, 'scripts/playwright-iehp-assessment-import-smoke.ts'), 'utf8');
    const iehpJob = sliceWorkflowJob(workflow, 'iehp_assessment_import_smoke');
    const candidateBlock = script.slice(
      script.indexOf('const credentialCandidates = ['),
      script.indexOf('preflightCredentials(credentialCandidates);'),
    );

    expect(iehpJob).toContain('PW_SUPERADMIN_EMAIL');
    expect(iehpJob).toContain('PW_SUPERADMIN_PASSWORD');
    expect(iehpJob).not.toMatch(/^\s+PW_ADMIN_EMAIL/m);
    expect(iehpJob).not.toMatch(/^\s+PW_ADMIN_PASSWORD/m);
    expect(candidateBlock).toContain('PW_SUPERADMIN_EMAIL');
    expect(candidateBlock).not.toContain('PW_ADMIN_EMAIL');
    expect(candidateBlock).not.toContain('PLAYWRIGHT_ADMIN_EMAIL');
  });
});

describe('assertIehpAssessorPhoneChecklist', () => {
  it('returns redacted evidence when the extracted checklist phone matches the expected primary therapist snapshot phone', () => {
    expect(
      assertIehpAssessorPhoneChecklist({
        checklist: {
          items: [
            {
              id: 'row-1',
              placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
              label: "Assessor's phone number",
              value_text: '(951) 555-0101',
            },
          ],
        },
        expectedPhone: '(951) 555-0101',
      }),
    ).toEqual({
      fieldKey: 'IEHP_FBA_ASSESSOR_PHONE',
      rowCount: 1,
      nonEmpty: true,
      validFormat: true,
      precedenceMatchedExpectedPhone: true,
      expectedPhoneRedacted: '(***) ***-0101',
      actualPhoneRedacted: '(***) ***-0101',
    });
  });

  it('fails clearly when the extracted checklist phone does not match the expected primary therapist snapshot precedence value', () => {
    expect(() =>
      assertIehpAssessorPhoneChecklist({
        checklist: {
          items: [
            {
              id: 'row-1',
              placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
              label: "Assessor's phone number",
              value_text: '(909) 555-0199',
            },
          ],
        },
        expectedPhone: '(951) 555-0101',
      }),
    ).toThrow(
      'IEHP smoke expected IEHP_FBA_ASSESSOR_PHONE to match the configured client primary therapist snapshot phone.',
    );
  });

  it.each([
    {
      name: 'missing row',
      checklist: {
        items: [
          {
            id: 'row-1',
            placeholder_key: 'IEHP_FBA_REFERRING_PROVIDER',
            label: 'Referring provider',
            value_text: 'Dr. Test',
          },
        ],
      },
      message: 'IEHP smoke could not find IEHP_FBA_ASSESSOR_PHONE in assessment checklist.',
    },
    {
      name: 'duplicate rows',
      checklist: {
        items: [
          {
            id: 'row-1',
            placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
            label: "Assessor's phone number",
            value_text: '(951) 555-0101',
          },
          {
            id: 'row-2',
            placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
            label: "Assessor's phone number",
            value_text: '(951) 555-0101',
          },
        ],
      },
      message: 'IEHP smoke expected exactly one IEHP_FBA_ASSESSOR_PHONE row but found 2.',
    },
    {
      name: 'empty value',
      checklist: {
        items: [
          {
            id: 'row-1',
            placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
            label: "Assessor's phone number",
            value_text: '   ',
          },
        ],
      },
      message: 'IEHP smoke found IEHP_FBA_ASSESSOR_PHONE but its value was empty.',
    },
    {
      name: 'malformed value',
      checklist: {
        items: [
          {
            id: 'row-1',
            placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
            label: "Assessor's phone number",
            value_text: 'not-a-phone',
          },
        ],
      },
      message: 'IEHP smoke found IEHP_FBA_ASSESSOR_PHONE but its value did not match the accepted phone format.',
    },
  ])('fails clearly for $name', ({ checklist, message }) => {
    expect(() =>
      assertIehpAssessorPhoneChecklist({
        checklist,
        expectedPhone: '(951) 555-0101',
      }),
    ).toThrow(message);
  });
});

describe('normalizeAssessmentChecklistResponse', () => {
  it('normalizes a raw checklist array into the app-consumer object shape', () => {
    expect(
      normalizeAssessmentChecklistResponse([
        {
          id: 'row-1',
          placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
          label: "Assessor's phone number",
          value_text: '(951) 555-0101',
        },
      ]),
    ).toEqual({
      items: [
        {
          id: 'row-1',
          placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
          label: "Assessor's phone number",
          value_text: '(951) 555-0101',
        },
      ],
      structured_sections: [],
    });
  });

  it('preserves the existing object response shape', () => {
    expect(
      normalizeAssessmentChecklistResponse({
        items: [
          {
            id: 'row-1',
            placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
            label: "Assessor's phone number",
            value_text: '(951) 555-0101',
          },
        ],
        structured_sections: [{ id: 'section-1' }],
      }),
    ).toEqual({
      items: [
        {
          id: 'row-1',
          placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
          label: "Assessor's phone number",
          value_text: '(951) 555-0101',
        },
      ],
      structured_sections: [{ id: 'section-1' }],
    });
  });
});

describe('playwright-iehp-assessment-import-smoke structure', () => {
  it('loads checklist assertions before the unchanged cleanup finally block', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-iehp-assessment-import-smoke.ts'),
      'utf8',
    );

    const checklistFetchIndex = script.indexOf('const checklist = await fetchAssessmentChecklist');
    const cleanupFinallyIndex = script.indexOf('} finally {');
    const cleanupCallIndex = script.indexOf('await cleanupAssessmentImportArtifacts({');

    expect(checklistFetchIndex).toBeGreaterThanOrEqual(0);
    expect(cleanupFinallyIndex).toBeGreaterThan(checklistFetchIndex);
    expect(cleanupCallIndex).toBeGreaterThan(cleanupFinallyIndex);
  });
});
