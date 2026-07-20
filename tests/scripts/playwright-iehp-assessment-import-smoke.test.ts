/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertIehpDocumentChecklistField } from '../../scripts/lib/iehp-assessment-import-smoke';

import {
  assertIehpAssessorPhoneChecklist,
  fetchIehpAssessorPhoneProvenance,
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
      data: { id: 'client-123', therapist_id: 'therapist-123', organization_id: 'org-123' },
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
      organizationId: 'org-123',
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
      data: { id: 'client-123', therapist_id: 'therapist-123', organization_id: 'org-123' },
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
      organizationId: 'org-123',
      expectedAssessorPhone: '(951) 555-0101',
      credentials: {
        email: 'superadmin@test.com',
        password: 'valid-secret',
        label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
      },
    });
  });

  it('fails closed before upload when the configured smoke client lacks an organization', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: 'super-admin-token' },
        user: { id: 'super-admin-user' },
      },
      error: null,
    });
    const clientMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'client-123', therapist_id: 'therapist-123', organization_id: null },
      error: null,
    });
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: clientMaybeSingle })),
      })),
    }));

    await expect(
      selectConfiguredSmokeClient(
        'https://example.supabase.co',
        'anon-key',
        [{ email: 'superadmin@test.com', password: 'valid-secret', label: 'synthetic super admin' }],
        {
          clientFactory: vi.fn(() => ({ auth: { signInWithPassword }, from })) as never,
          env: { PW_ASSESSMENT_CLIENT_ID: 'client-123' } as NodeJS.ProcessEnv,
        },
      ),
    ).rejects.toThrow(
      'Configured PW_ASSESSMENT_CLIENT_ID must expose a non-empty organization for IEHP assessment import smoke.',
    );
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
      data: { id: 'client-123', therapist_id: null, organization_id: 'org-123' },
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
      data: { id: 'client-123', therapist_id: 'therapist-123', organization_id: 'org-123' },
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
    expect(iehpJob).toContain(
      "PW_BASE_URL: ${{ github.event_name == 'pull_request' && format('https://deploy-preview-{0}--velvety-cendol-dae4d6.netlify.app', github.event.pull_request.number) || secrets.PW_BASE_URL }}",
    );
    expect(iehpJob).toContain(
      "if: needs.change_scope.outputs.docs_only != 'true' && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)",
    );
    expect(iehpJob).not.toMatch(/^\s+PW_ADMIN_EMAIL/m);
    expect(iehpJob).not.toMatch(/^\s+PW_ADMIN_PASSWORD/m);
    expect(candidateBlock).toContain('PW_SUPERADMIN_EMAIL');
    expect(candidateBlock).not.toContain('PW_ADMIN_EMAIL');
    expect(candidateBlock).not.toContain('PLAYWRIGHT_ADMIN_EMAIL');
  });
});

describe('fetchIehpAssessorPhoneProvenance', () => {
  it('uses the authenticated tenant-scoped minimum provenance query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            field_key: 'IEHP_FBA_ASSESSOR_PHONE',
            source_span: { method: 'client_snapshot', field: 'primary_therapist_phone' },
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await fetchIehpAssessorPhoneProvenance({
        accessToken: 'caller-jwt',
        assessmentDocumentId: 'document-123',
        organizationId: 'org-123',
        supabaseAnonKey: 'anon-key',
        supabaseUrl: 'https://example.supabase.co',
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://example.supabase.co/rest/v1/assessment_extractions?select=field_key,source_span&assessment_document_id=eq.document-123&field_key=eq.IEHP_FBA_ASSESSOR_PHONE&organization_id=eq.org-123&limit=2',
    );
    expect(init.headers).toEqual({ apikey: 'anon-key', Authorization: 'Bearer caller-jwt' });
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
        provenanceRows: [
          {
            field_key: 'IEHP_FBA_ASSESSOR_PHONE',
            source_span: {
              method: 'client_snapshot',
              field: 'primary_therapist_phone',
            },
          },
        ],
      }),
    ).toEqual({
      fieldKey: 'IEHP_FBA_ASSESSOR_PHONE',
      rowCount: 1,
      nonEmpty: true,
      validFormat: true,
      precedenceMatchedExpectedPhone: true,
      provenanceRowCount: 1,
      provenanceVerified: true,
      sourceMethod: 'client_snapshot',
      sourceField: 'primary_therapist_phone',
      expectedPhoneRedacted: '(***) ***-0101',
      actualPhoneRedacted: '(***) ***-0101',
    });
  });

  it.each([
    {
      name: 'missing provenance row',
      provenanceRows: [],
      message: 'IEHP smoke could not find IEHP_FBA_ASSESSOR_PHONE extraction provenance.',
    },
    {
      name: 'duplicate provenance rows',
      provenanceRows: [
        {
          field_key: 'IEHP_FBA_ASSESSOR_PHONE',
          source_span: { method: 'client_snapshot', field: 'primary_therapist_phone' },
        },
        {
          field_key: 'IEHP_FBA_ASSESSOR_PHONE',
          source_span: { method: 'client_snapshot', field: 'primary_therapist_phone' },
        },
      ],
      message: 'IEHP smoke expected exactly one IEHP_FBA_ASSESSOR_PHONE extraction provenance row but found 2.',
    },
    {
      name: 'null provenance source span',
      provenanceRows: [{ field_key: 'IEHP_FBA_ASSESSOR_PHONE', source_span: null }],
      message:
        'IEHP smoke expected IEHP_FBA_ASSESSOR_PHONE provenance to be client_snapshot.primary_therapist_phone.',
    },
    {
      name: 'malformed provenance source span',
      provenanceRows: [{ field_key: 'IEHP_FBA_ASSESSOR_PHONE', source_span: 'client_snapshot' }],
      message:
        'IEHP smoke expected IEHP_FBA_ASSESSOR_PHONE provenance to be client_snapshot.primary_therapist_phone.',
    },
    {
      name: 'wrong provenance source field',
      provenanceRows: [
        {
          field_key: 'IEHP_FBA_ASSESSOR_PHONE',
          source_span: { method: 'client_snapshot', field: 'therapist_phone' },
        },
      ],
      message:
        'IEHP smoke expected IEHP_FBA_ASSESSOR_PHONE provenance to be client_snapshot.primary_therapist_phone.',
    },
  ])('fails clearly for $name', ({ provenanceRows, message }) => {
    expect(() =>
      assertIehpAssessorPhoneChecklist({
        checklist: {
          items: [
            {
              id: 'row-1',
              placeholder_key: 'IEHP_FBA_ASSESSOR_PHONE',
              value_text: '(951) 555-0101',
            },
          ],
        },
        expectedPhone: '(951) 555-0101',
        provenanceRows,
      }),
    ).toThrow(message);
  });

  it('rejects a matching document-derived phone because it does not prove snapshot precedence', () => {
    expect(() =>
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
        provenanceRows: [
          {
            field_key: 'IEHP_FBA_ASSESSOR_PHONE',
            source_span: {
              method: 'iehp_assessor_phone_anchor',
              field: 'IEHP_FBA_ASSESSOR_PHONE',
            },
          },
        ],
      }),
    ).toThrow(
      'IEHP smoke expected IEHP_FBA_ASSESSOR_PHONE provenance to be client_snapshot.primary_therapist_phone.',
    );
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
  it('requires explicit pdf mini matrix mode, per-case cleanup, and aggregate evidence ordering', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-iehp-assessment-import-smoke.ts'),
      'utf8',
    );
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };

    const miniMatrixFlagIndex = script.indexOf("const isPdfMiniMatrixMode = process.argv.includes('--pdf-mini-matrix');");
    const matrixCaseLoopIndex = script.indexOf('for (const caseDefinition of IEHP_PDF_MINI_MATRIX_CASES)');
    const generatorPageIndex = script.indexOf('const generatorPage = await context.newPage();');
    const setContentIndex = script.indexOf('await generatorPage.setContent(buildIehpPdfMiniMatrixHtml(caseDefinition));');
    const pagePdfIndex = script.indexOf("const pdfBuffer = await generatorPage.pdf({ format: 'Letter', printBackground: true });");
    const generatorCloseIndex = script.indexOf('await generatorPage.close();');
    const pdfMimeIndex = script.indexOf("mimeType: 'application/pdf'");
    const pdfFileNameIndex = script.indexOf("buildIehpSmokeUploadFileName(Date.now(), 'pdf')");
    const caseRunnerIndex = script.indexOf('const runSmokeCase = async (');
    const checklistFetchIndex = script.indexOf('const checklist = await fetchAssessmentChecklist');
    const provenanceFetchIndex = script.indexOf('const provenanceRows = await fetchIehpAssessmentProvenance');
    const assessorPhoneAssertionIndex = script.indexOf('const assessorPhoneAssertion = assertIehpAssessorPhoneChecklist');
    const referralDateAssertionIndex = script.indexOf('const referralDateAssertion = assertIehpDocumentChecklistField');
    const cleanupVerifiedIndex = script.indexOf('cleanupVerified = true;');
    const caseEvidenceIndex = script.indexOf('console.log(JSON.stringify(caseEvidence, null, 2));');
    const caseFinallyIndex = script.indexOf('} finally {');
    const cleanupCallIndex = script.indexOf('await cleanupAssessmentImportArtifacts({');
    const aggregateEvidenceIndex = script.indexOf('console.log(JSON.stringify(aggregateEvidence, null, 2));');
    const aggregateCleanupIndex = script.indexOf('cleanupVerifiedCases: passedCases.length,');

    expect(packageJson.scripts?.['playwright:iehp-assessment-import-smoke']).toBe(
      'tsx scripts/playwright-iehp-assessment-import-smoke.ts',
    );
    expect(packageJson.scripts?.['playwright:iehp-assessment-import-pdf-mini-matrix']).toBe(
      'tsx scripts/playwright-iehp-assessment-import-smoke.ts --pdf-mini-matrix',
    );
    expect(miniMatrixFlagIndex).toBeGreaterThanOrEqual(0);
    expect(caseRunnerIndex).toBeGreaterThan(miniMatrixFlagIndex);
    expect(matrixCaseLoopIndex).toBeGreaterThan(miniMatrixFlagIndex);
    expect(generatorPageIndex).toBeGreaterThan(matrixCaseLoopIndex);
    expect(setContentIndex).toBeGreaterThan(generatorPageIndex);
    expect(pagePdfIndex).toBeGreaterThan(setContentIndex);
    expect(generatorCloseIndex).toBeGreaterThan(pagePdfIndex);
    expect(pdfFileNameIndex).toBeGreaterThan(generatorCloseIndex);
    expect(pdfMimeIndex).toBeGreaterThan(pdfFileNameIndex);
    expect(checklistFetchIndex).toBeGreaterThanOrEqual(0);
    expect(provenanceFetchIndex).toBeGreaterThan(checklistFetchIndex);
    expect(assessorPhoneAssertionIndex).toBeGreaterThan(provenanceFetchIndex);
    expect(referralDateAssertionIndex).toBeGreaterThan(assessorPhoneAssertionIndex);
    expect(caseFinallyIndex).toBeGreaterThan(referralDateAssertionIndex);
    expect(cleanupCallIndex).toBeGreaterThan(caseFinallyIndex);
    expect(cleanupVerifiedIndex).toBeGreaterThan(cleanupCallIndex);
    expect(caseEvidenceIndex).toBeGreaterThan(cleanupVerifiedIndex);
    expect(aggregateCleanupIndex).toBeGreaterThan(caseEvidenceIndex);
    expect(aggregateEvidenceIndex).toBeGreaterThan(aggregateCleanupIndex);
  });
});

describe('assertIehpDocumentChecklistField', () => {
  const checklistWithValue = (valueText: string) => ({
    items: [
      {
        id: 'row-1',
        placeholder_key: 'IEHP_FBA_REFERRAL_DATE',
        label: 'Referral Date',
        value_text: valueText,
      },
    ],
  });

  const documentProvenanceRow = {
    field_key: 'IEHP_FBA_REFERRAL_DATE',
    source_span: {
      method: 'document_text',
      field: 'IEHP_FBA_REFERRAL_DATE',
    },
  };

  it('returns redacted boolean evidence for a single exact document-backed referral date match', () => {
    expect(
      assertIehpDocumentChecklistField({
        checklist: checklistWithValue('06/30/2026'),
        expectedValue: '06/30/2026',
        fieldKey: 'IEHP_FBA_REFERRAL_DATE',
        provenanceRows: [documentProvenanceRow],
      }),
    ).toEqual({
      fieldKey: 'IEHP_FBA_REFERRAL_DATE',
      rowCount: 1,
      valueMatched: true,
      provenanceRowCount: 1,
      documentProvenanceVerified: true,
    });
  });

  it('ignores provenance rows for other field keys when enforcing the referral-date contract', () => {
    expect(
      assertIehpDocumentChecklistField({
        checklist: checklistWithValue('06/30/2026'),
        expectedValue: '06/30/2026',
        fieldKey: 'IEHP_FBA_REFERRAL_DATE',
        provenanceRows: [
          documentProvenanceRow,
          {
            field_key: 'IEHP_FBA_ASSESSOR_PHONE',
            source_span: {
              method: 'document_text',
              field: 'IEHP_FBA_ASSESSOR_PHONE',
            },
          },
        ],
      }),
    ).toEqual({
      fieldKey: 'IEHP_FBA_REFERRAL_DATE',
      rowCount: 1,
      valueMatched: true,
      provenanceRowCount: 1,
      documentProvenanceVerified: true,
    });
  });

  it.each([
    {
      name: 'missing row',
      checklist: { items: [] },
      provenanceRows: [documentProvenanceRow],
      message: 'IEHP smoke could not find IEHP_FBA_REFERRAL_DATE in assessment checklist.',
    },
    {
      name: 'duplicate rows',
      checklist: {
        items: [
          {
            id: 'row-1',
            placeholder_key: 'IEHP_FBA_REFERRAL_DATE',
            value_text: '06/30/2026',
          },
          {
            id: 'row-2',
            placeholder_key: 'IEHP_FBA_REFERRAL_DATE',
            value_text: '07/01/2026',
          },
        ],
      },
      provenanceRows: [documentProvenanceRow],
      message: 'IEHP smoke expected exactly one IEHP_FBA_REFERRAL_DATE row but found 2.',
    },
    {
      name: 'empty value',
      checklist: checklistWithValue('   '),
      provenanceRows: [documentProvenanceRow],
      message: 'IEHP smoke found IEHP_FBA_REFERRAL_DATE but its value was empty.',
    },
    {
      name: 'mismatched value',
      checklist: checklistWithValue('07/01/2026'),
      provenanceRows: [documentProvenanceRow],
      message: 'IEHP smoke expected IEHP_FBA_REFERRAL_DATE to match the expected document value exactly.',
    },
    {
      name: 'missing provenance row',
      checklist: checklistWithValue('06/30/2026'),
      provenanceRows: [],
      message: 'IEHP smoke could not find IEHP_FBA_REFERRAL_DATE extraction provenance.',
    },
    {
      name: 'duplicate provenance rows',
      checklist: checklistWithValue('06/30/2026'),
      provenanceRows: [documentProvenanceRow, documentProvenanceRow],
      message: 'IEHP smoke expected exactly one IEHP_FBA_REFERRAL_DATE extraction provenance row but found 2.',
    },
    {
      name: 'client snapshot provenance row',
      checklist: checklistWithValue('06/30/2026'),
      provenanceRows: [
        {
          field_key: 'IEHP_FBA_REFERRAL_DATE',
          source_span: {
            method: 'client_snapshot',
            field: 'referral_date',
          },
        },
      ],
      message: 'IEHP smoke expected IEHP_FBA_REFERRAL_DATE provenance to come from document extraction, not client_snapshot.',
    },
    {
      name: 'missing provenance source span',
      checklist: checklistWithValue('06/30/2026'),
      provenanceRows: [{ field_key: 'IEHP_FBA_REFERRAL_DATE', source_span: null }],
      message: 'IEHP smoke expected IEHP_FBA_REFERRAL_DATE provenance to expose exactly one non-client_snapshot source span.',
    },
  ])('fails clearly for $name', ({ checklist, provenanceRows, message }) => {
    expect(() =>
      assertIehpDocumentChecklistField({
        checklist,
        expectedValue: '06/30/2026',
        fieldKey: 'IEHP_FBA_REFERRAL_DATE',
        provenanceRows,
      }),
    ).toThrow(message);
  });
});
