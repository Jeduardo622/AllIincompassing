/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  IEHP_GENERATED_DOCX_PARITY_PROOF_CASE,
  assertIehpDocumentChecklistField,
  assertIehpGeneratedDocxTextParity,
} from '../../scripts/lib/iehp-assessment-import-smoke';

import {
  assertIehpAssessorPhoneChecklist,
  assertIehpGeneratedDocxStorageTarget,
  cleanupGeneratedDocxParityArtifacts,
  executeIehpSmokeCaseWithCleanup,
  fetchIehpAssessorPhoneProvenance,
  normalizeAssessmentChecklistResponse,
  parseAssessmentPlanPdfPreflight,
  readSyntheticGeneratedDocxText,
  assertIehpPdfMiniMatrixPreflight,
  assertIehpPdfMiniMatrixTasksSucceeded,
  runIehpPdfMiniMatrixTasks,
  restoreIehpGeneratedDocxReviewSelection,
  selectConfiguredSmokeClient,
} from '../../scripts/playwright-iehp-assessment-import-smoke';
import { assertIehpSkillsBehaviorsChecklistSection } from '../../scripts/lib/iehp-assessment-import-smoke';

const normalizeLf = (content: string) => content.replace(/\r\n/g, '\n');

const sliceWorkflowJob = (workflow: string, jobName: string): string => {
  const start = workflow.indexOf(`  ${jobName}:`);
  expect(start).toBeGreaterThanOrEqual(0);

  const afterJobName = start + `  ${jobName}:`.length;
  const rest = workflow.slice(afterJobName);
  const nextJob = rest.search(/\n  [A-Za-z0-9_]+:\r?\n/);

  return nextJob === -1 ? workflow.slice(start) : workflow.slice(start, afterJobName + nextJob);
};

describe('restoreIehpGeneratedDocxReviewSelection', () => {
  it('does not click the uploaded assessment when its review is already visible', async () => {
    const selectUploadedAssessment = vi.fn();
    const waitForReview = vi.fn().mockResolvedValue(undefined);

    await restoreIehpGeneratedDocxReviewSelection({
      isReviewVisible: vi.fn().mockResolvedValue(true),
      isUploadedAssessmentVisible: vi.fn().mockResolvedValue(false),
      waitForNextPoll: vi.fn().mockResolvedValue(undefined),
      selectUploadedAssessment,
      waitForReview,
    });

    expect(selectUploadedAssessment).not.toHaveBeenCalled();
    expect(waitForReview).toHaveBeenCalledOnce();
  });

  it('selects the uploaded assessment before waiting when its review is not visible', async () => {
    const selectUploadedAssessment = vi.fn().mockResolvedValue(undefined);
    const waitForReview = vi.fn().mockResolvedValue(undefined);

    await restoreIehpGeneratedDocxReviewSelection({
      isReviewVisible: vi.fn().mockResolvedValue(false),
      isUploadedAssessmentVisible: vi.fn().mockResolvedValue(true),
      waitForNextPoll: vi.fn().mockResolvedValue(undefined),
      selectUploadedAssessment,
      waitForReview,
    });

    expect(selectUploadedAssessment).toHaveBeenCalledOnce();
    expect(waitForReview).toHaveBeenCalledOnce();
    expect(selectUploadedAssessment.mock.invocationCallOrder[0]).toBeLessThan(waitForReview.mock.invocationCallOrder[0]);
  });

  it('waits for the assessment queue before choosing a restoration path', async () => {
    const isReviewVisible = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const isUploadedAssessmentVisible = vi.fn().mockResolvedValue(false);
    const waitForNextPoll = vi.fn().mockResolvedValue(undefined);
    const selectUploadedAssessment = vi.fn();
    const waitForReview = vi.fn().mockResolvedValue(undefined);

    await restoreIehpGeneratedDocxReviewSelection({
      isReviewVisible,
      isUploadedAssessmentVisible,
      waitForNextPoll,
      selectUploadedAssessment,
      waitForReview,
    });

    expect(waitForNextPoll).toHaveBeenCalledOnce();
    expect(selectUploadedAssessment).not.toHaveBeenCalled();
    expect(waitForReview).toHaveBeenCalledOnce();
  });

  it('fails closed when neither restoration target becomes visible', async () => {
    await expect(
      restoreIehpGeneratedDocxReviewSelection({
        isReviewVisible: vi.fn().mockResolvedValue(false),
        isUploadedAssessmentVisible: vi.fn().mockResolvedValue(false),
        waitForNextPoll: vi.fn().mockResolvedValue(undefined),
        selectUploadedAssessment: vi.fn(),
        waitForReview: vi.fn(),
        maxPollAttempts: 2,
      }),
    ).rejects.toThrow('IEHP assessment queue did not restore a review or uploaded assessment');
  });
});

describe('IEHP PDF mini-matrix task runner', () => {
  it('hard-stops ambiguous document-phone precedence before any matrix task can run', () => {
    const runTask = vi.fn();

    expect(() => assertIehpPdfMiniMatrixPreflight({
      cases: [
        { id: 'safe-case', documentPhone: '951.555.0101' },
        { id: 'ambiguous-case', documentPhone: '(909) 555-4242' },
      ],
      expectedAssessorPhone: '909-555-4242',
    })).toThrow(
      'IEHP PDF mini matrix case ambiguous-case normalized document phone matched the configured snapshot phone, so precedence proof would be ambiguous.',
    );
    expect(runTask).not.toHaveBeenCalled();
  });

  it('attempts later tasks after a rejection and throws only after every task was attempted', async () => {
    const attempts: string[] = [];
    const emittedCaseIds: string[] = [];
    const result = await runIehpPdfMiniMatrixTasks({
      tasks: [
        {
          caseId: 'first-case',
          run: async () => {
            attempts.push('first-case');
            return { caseId: 'first-case', cleanupVerified: true };
          },
        },
        {
          caseId: 'rejected-case',
          run: async () => {
            attempts.push('rejected-case');
            throw new Error('private rejection text');
          },
        },
        {
          caseId: 'later-case',
          run: async () => {
            attempts.push('later-case');
            return { caseId: 'later-case', cleanupVerified: true };
          },
        },
      ],
      onSuccess: (_evidence, caseId) => emittedCaseIds.push(caseId),
      onFailure: (evidence) => emittedCaseIds.push(evidence.caseId),
    });

    expect(attempts).toEqual(['first-case', 'rejected-case', 'later-case']);
    expect(emittedCaseIds).toEqual(['first-case', 'rejected-case', 'later-case']);
    expect(result.failedCases).toEqual([{
      ok: false,
      mode: 'pdf-mini-matrix-case-failure',
      caseId: 'rejected-case',
      templateType: 'iehp_fba',
      cleanupVerified: false,
      failureCategory: 'case_execution_failed',
      errorCategory: 'matrix_failures_detected',
    }]);
    expect(() => assertIehpPdfMiniMatrixTasksSucceeded(result.failedCases)).toThrow(
      'IEHP PDF mini matrix encountered one or more case-local failures.',
    );
    expect(attempts).toHaveLength(3);
  });
});

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
      data: {
        id: 'client-123',
        therapist_id: 'therapist-123',
        organization_id: 'org-123',
        full_name: 'Synthetic Smoke Client',
      },
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

  it('rejects a configured client that is not explicitly marked as smoke, synthetic, or test', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'admin-token' }, user: { id: 'admin-user' } },
      error: null,
    });
    const clientMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'client-123',
        therapist_id: 'therapist-123',
        organization_id: 'org-123',
        full_name: 'Production Client',
      },
      error: null,
    });
    const therapistMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'therapist-123', phone: '(951) 555-0101' },
      error: null,
    });
    const anonClient = {
      auth: { signInWithPassword },
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: table === 'clients' ? clientMaybeSingle : therapistMaybeSingle,
          })),
        })),
      })),
    };

    await expect(
      selectConfiguredSmokeClient(
        'https://example.supabase.co',
        'anon-key',
        [{ email: 'admin@test.com', password: 'valid-secret', label: 'synthetic credential' }],
        {
          clientFactory: vi.fn(() => anonClient) as never,
          env: { PW_ASSESSMENT_CLIENT_ID: 'client-123' } as NodeJS.ProcessEnv,
        },
      ),
    ).rejects.toThrow('PW_ASSESSMENT_CLIENT_ID must point at a clearly marked smoke client.');
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
      data: {
        id: 'client-123',
        therapist_id: 'therapist-123',
        organization_id: 'org-123',
        full_name: 'Synthetic Smoke Client',
      },
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
      data: {
        id: 'client-123',
        therapist_id: 'therapist-123',
        organization_id: 'org-123',
        full_name: 'Synthetic Smoke Client',
      },
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

  it('keeps both CI IEHP proofs on the generated super-admin and unconditional cleanup path', () => {
    const root = process.cwd();
    const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const supabaseConfig = normalizeLf(readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'));
    const script = readFileSync(path.join(root, 'scripts/playwright-iehp-assessment-import-smoke.ts'), 'utf8');
    const iehpJob = sliceWorkflowJob(workflow, 'iehp_assessment_import_smoke');
    const cleanupStepStart = iehpJob.indexOf('- name: Cleanup IEHP smoke admin');
    const cleanupStepEnd = iehpJob.indexOf('\n      - name:', cleanupStepStart + 1);
    const cleanupStep = iehpJob.slice(
      cleanupStepStart,
      cleanupStepEnd === -1 ? undefined : cleanupStepEnd,
    );
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
    expect(iehpJob).toContain('npm run playwright:iehp-assessment-import-smoke');
    expect(iehpJob).toContain('npm run playwright:iehp-assessment-import-skills-behaviors');
    expect(iehpJob).toContain('npm run playwright:iehp-assessment-import-generated-docx-parity');
    expect(iehpJob.indexOf('npm run playwright:iehp-assessment-import-smoke')).toBeLessThan(
      iehpJob.indexOf('npm run playwright:iehp-assessment-import-skills-behaviors'),
    );
    expect(iehpJob.indexOf('npm run playwright:iehp-assessment-import-skills-behaviors')).toBeLessThan(
      iehpJob.indexOf('npm run playwright:iehp-assessment-import-generated-docx-parity'),
    );
    expect(iehpJob.indexOf('npm run playwright:iehp-assessment-import-generated-docx-parity')).toBeLessThan(
      iehpJob.indexOf('name: Cleanup IEHP smoke admin'),
    );
    expect(cleanupStepStart).toBeGreaterThanOrEqual(0);
    expect(cleanupStep).toContain('if: always()');
    expect(supabaseConfig).toContain(
      '[functions.extract-assessment-fields]\nverify_jwt = true',
    );
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

  it('ignores mixed-field provenance rows when enforcing assessor phone provenance cardinality', () => {
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
            field_key: 'IEHP_FBA_REFERRAL_DATE',
            source_span: {
              method: 'document_text',
              field: 'IEHP_FBA_REFERRAL_DATE',
            },
          },
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
  it('does not mutate helper-local cleanup failure state from the missing-assessment branch', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-iehp-assessment-import-smoke.ts'),
      'utf8',
    );

    expect(script).not.toContain(
      "cleanupFailure = new Error('IEHP smoke could not rediscover the uploaded assessment for cleanup.');",
    );
    expect(script).toContain("throw new Error('Uploaded IEHP assessment document was not found in the queue.');");
  });

  it('keeps cleanup fail-closed when the skills behaviors assertion throws inside the case runner finally boundary', async () => {
    const cleanupCase = vi.fn().mockRejectedValue(new Error('cleanup failed'));

    await expect(
      executeIehpSmokeCaseWithCleanup({
        caseId: 'skills-behaviors-proof',
        latestDir: path.join(process.cwd(), 'artifacts', 'latest'),
        executeCase: async () => {
          assertIehpSkillsBehaviorsChecklistSection({
            checklist: {
              items: [],
              structured_sections: [],
            },
          });

          return {
            ok: true as const,
          };
        },
        cleanupCase,
        cleanupTargetKnown: () => true,
      }),
    ).rejects.toThrow('IEHP assessment import smoke failed and cleanup did not complete.');

    expect(cleanupCase).toHaveBeenCalledTimes(1);
  });

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
    const matrixTaskBuildIndex = script.indexOf('const matrixTasks = IEHP_PDF_MINI_MATRIX_CASES.map');
    const generatorPageIndex = script.indexOf('const generatorPage = await context.newPage();');
    const setContentIndex = script.indexOf('await generatorPage.setContent(buildIehpPdfMiniMatrixHtml(caseDefinition));');
    const pagePdfIndex = script.indexOf("const pdfBuffer = await generatorPage.pdf({ format: 'Letter', printBackground: true });");
    const scanModeIndex = script.indexOf("caseDefinition.renderMode === 'raster-scan'", setContentIndex);
    const scanWidthIndex = script.indexOf('const scanWidth = Math.round(caseDefinition.scan.dpi * 8.5);', scanModeIndex);
    const scanHeightIndex = script.indexOf('const scanHeight = caseDefinition.scan.dpi * 11;', scanWidthIndex);
    const scanViewportIndex = script.indexOf('width: scanWidth, height: scanHeight', scanHeightIndex);
    const rotationIndex = script.indexOf(
      'transform: rotate(${caseDefinition.scan.rotationDegrees}deg);',
      scanViewportIndex,
    );
    const rasterHelperIndex = script.indexOf('const buildRasterScanImageDataUrl = async');
    const scanScreenshotIndex = script.indexOf("type: 'png'", rasterHelperIndex);
    const scanCanvasIndex = script.indexOf('getImageData(0, 0, canvas.width, canvas.height)', scanScreenshotIndex);
    const scanLuminanceIndex = script.indexOf('const luminance = Math.round(', scanCanvasIndex);
    const scanColorModeIndex = script.indexOf("colorMode === 'black-and-white'", scanLuminanceIndex);
    const scanQualityIndex = script.indexOf("canvas.toDataURL('image/jpeg', quality / 100)", scanLuminanceIndex);
    const rasterPageIndex = script.indexOf('const rasterPdfPage = await context.newPage();', scanQualityIndex);
    const imageOnlyHtmlIndex = script.indexOf('rasterScanDataUrl', rasterPageIndex);
    const rasterPdfIndex = script.indexOf("await rasterPdfPage.pdf({ format: 'Letter', printBackground: true })", imageOnlyHtmlIndex);
    const generatorCloseIndex = script.indexOf('await generatorPage.close();');
    const pdfFileNameIndex = script.indexOf(
      "buildIehpSmokeUploadFileName(Date.now(), 'pdf')",
      matrixTaskBuildIndex,
    );
    const pdfMimeIndex = script.indexOf("mimeType: 'application/pdf'", pdfFileNameIndex);
    const caseRunnerIndex = script.indexOf('const runSmokeCase = async (');
    const cleanupHelperIndex = script.indexOf('return executeIehpSmokeCaseWithCleanup({');
    const checklistFetchIndex = script.indexOf('const checklist = await fetchAssessmentChecklist');
    const provenanceFetchIndex = script.indexOf('const provenanceRows = await fetchIehpAssessmentProvenance');
    const assessorPhoneAssertionIndex = script.indexOf('const assessorPhoneAssertion = assertIehpAssessorPhoneChecklist');
    const referralDateAssertionIndex = script.indexOf('const referralDateAssertion = caseInput.expectedReferralDate');
    const caseEvidenceIndex = script.indexOf('console.log(JSON.stringify(sanitizePublicMatrixCaseEvidence(caseEvidence), null, 2));');
    const cleanupCallIndex = script.indexOf('await cleanupAssessmentImportArtifacts({');
    const aggregateEvidenceIndex = script.indexOf('console.log(JSON.stringify(aggregateEvidence, null, 2));');
    const aggregateCleanupIndex = script.indexOf('cleanupVerifiedCases,');

    expect(packageJson.scripts?.['playwright:iehp-assessment-import-smoke']).toBe(
      'tsx scripts/playwright-iehp-assessment-import-smoke.ts',
    );
    expect(packageJson.scripts?.['playwright:iehp-assessment-import-pdf-mini-matrix']).toBe(
      'tsx scripts/playwright-iehp-assessment-import-smoke.ts --pdf-mini-matrix',
    );
    expect(miniMatrixFlagIndex).toBeGreaterThanOrEqual(0);
    expect(caseRunnerIndex).toBeGreaterThan(miniMatrixFlagIndex);
    expect(matrixTaskBuildIndex).toBeGreaterThan(miniMatrixFlagIndex);
    expect(generatorPageIndex).toBeGreaterThan(matrixTaskBuildIndex);
    expect(setContentIndex).toBeGreaterThan(generatorPageIndex);
    expect(pagePdfIndex).toBeGreaterThan(setContentIndex);
    expect(scanModeIndex).toBeGreaterThan(setContentIndex);
    expect(scanWidthIndex).toBeGreaterThan(scanModeIndex);
    expect(scanHeightIndex).toBeGreaterThan(scanWidthIndex);
    expect(scanViewportIndex).toBeGreaterThan(scanHeightIndex);
    expect(rotationIndex).toBeGreaterThan(scanViewportIndex);
    expect(rasterHelperIndex).toBeLessThan(setContentIndex);
    expect(script).not.toContain('const loadImage = async');
    expect(scanScreenshotIndex).toBeGreaterThan(rasterHelperIndex);
    expect(scanCanvasIndex).toBeGreaterThan(scanScreenshotIndex);
    expect(scanLuminanceIndex).toBeGreaterThan(scanCanvasIndex);
    expect(scanColorModeIndex).toBeGreaterThan(scanLuminanceIndex);
    expect(scanQualityIndex).toBeGreaterThan(scanLuminanceIndex);
    expect(rasterPageIndex).toBeGreaterThan(scanQualityIndex);
    expect(imageOnlyHtmlIndex).toBeGreaterThan(rasterPageIndex);
    expect(rasterPdfIndex).toBeGreaterThan(imageOnlyHtmlIndex);
    expect(generatorCloseIndex).toBeGreaterThan(pagePdfIndex);
    expect(pdfFileNameIndex).toBeGreaterThan(generatorCloseIndex);
    expect(pdfMimeIndex).toBeGreaterThan(pdfFileNameIndex);
    expect(cleanupHelperIndex).toBeGreaterThan(caseRunnerIndex);
    expect(checklistFetchIndex).toBeGreaterThanOrEqual(0);
    expect(checklistFetchIndex).toBeGreaterThan(cleanupHelperIndex);
    expect(provenanceFetchIndex).toBeGreaterThan(checklistFetchIndex);
    expect(assessorPhoneAssertionIndex).toBeGreaterThan(provenanceFetchIndex);
    expect(referralDateAssertionIndex).toBeGreaterThan(assessorPhoneAssertionIndex);
    expect(cleanupCallIndex).toBeGreaterThan(referralDateAssertionIndex);
    expect(caseEvidenceIndex).toBeGreaterThan(cleanupCallIndex);
    expect(aggregateCleanupIndex).toBeGreaterThan(caseEvidenceIndex);
    expect(aggregateEvidenceIndex).toBeGreaterThan(aggregateCleanupIndex);
  });

  it('runs every pdf mini matrix case and the skills behaviors proof through the sequential task runner', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-iehp-assessment-import-smoke.ts'),
      'utf8',
    );

    const matrixTaskBuildIndex = script.indexOf('const matrixTasks = IEHP_PDF_MINI_MATRIX_CASES.map');
    const matrixPreflightIndex = script.indexOf('assertIehpPdfMiniMatrixPreflight({');
    const reusableProofRunnerIndex = script.indexOf('const runSkillsBehaviorsProofCase = async () =>');
    const matrixProofTaskIndex = script.indexOf("caseId: 'skills-behaviors-proof'", matrixTaskBuildIndex);
    const runnerCallIndex = script.indexOf('await runIehpPdfMiniMatrixTasks({', matrixProofTaskIndex);
    const evidenceModeIndex = script.indexOf('mode: isSkillsBehaviorsProofMode');
    const matrixEvidenceModeIndex = script.indexOf("? 'pdf-mini-matrix-case'", evidenceModeIndex);
    const aggregateTotalIndex = script.indexOf('totalCases: IEHP_PDF_MINI_MATRIX_CASES.length + 1,');
    const computedSkillsCountIndex = script.indexOf(
      'const skillsBehaviorsVerifiedCases = passedCases.filter(',
      runnerCallIndex,
    );
    const aggregateSkillsIndex = script.indexOf('skillsBehaviorsVerifiedCases,', computedSkillsCountIndex);
    const finalFailureThrowIndex = script.indexOf('assertIehpPdfMiniMatrixTasksSucceeded(failedCases);', aggregateSkillsIndex);
    const standaloneProofCallIndex = script.indexOf(
      'const proofCaseEvidence = await runSkillsBehaviorsProofCase();',
      aggregateSkillsIndex,
    );

    expect(reusableProofRunnerIndex).toBeGreaterThanOrEqual(0);
    expect(evidenceModeIndex).toBeGreaterThanOrEqual(0);
    expect(matrixEvidenceModeIndex).toBeGreaterThan(evidenceModeIndex);
    expect(matrixTaskBuildIndex).toBeGreaterThanOrEqual(0);
    expect(matrixPreflightIndex).toBeGreaterThanOrEqual(0);
    expect(matrixPreflightIndex).toBeLessThan(matrixTaskBuildIndex);
    expect(matrixProofTaskIndex).toBeGreaterThan(matrixTaskBuildIndex);
    expect(runnerCallIndex).toBeGreaterThan(matrixProofTaskIndex);
    expect(computedSkillsCountIndex).toBeGreaterThan(runnerCallIndex);
    expect(aggregateTotalIndex).toBeGreaterThan(computedSkillsCountIndex);
    expect(aggregateSkillsIndex).toBeGreaterThan(aggregateTotalIndex);
    expect(finalFailureThrowIndex).toBeGreaterThan(aggregateSkillsIndex);
    expect(standaloneProofCallIndex).toBeGreaterThan(aggregateSkillsIndex);
  });

  it('raises the hosted extraction poll ceiling above the server runtime budget and emits sanitized per-case matrix failures', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-iehp-assessment-import-smoke.ts'),
      'utf8',
    );

    expect(script).toContain('const EXTRACTION_TIMEOUT_MS = 360_000;');
    expect(script).toContain("mode: 'pdf-mini-matrix-case-failure'");
    expect(script).toContain("failureCategory: 'case_execution_failed'");
    expect(script).toContain("errorCategory: 'matrix_failures_detected'");
    expect(script).toContain('const sanitizePublicMatrixCaseEvidence = (');
    expect(script).toContain('screenshot,');
    expect(script).toContain('errorMessage,');
    expect(script).toContain('assessorPhoneAssertion,');
    expect(script).toContain("cleanupVerified: false");
  });

  it('keeps default docx invocation free of referral-date requirements while matrix cases keep them', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-iehp-assessment-import-smoke.ts'),
      'utf8',
    );

    const matrixReferralIndex = script.indexOf('expectedReferralDate: caseDefinition.referralDate');
    const defaultReferralIndex = script.indexOf("expectedReferralDate: '06/30/2026'");
    const nullableReferralAssertionIndex = script.indexOf('const referralDateAssertion = caseInput.expectedReferralDate');
    const defaultCaseStartIndex = script.indexOf("const defaultCaseEvidence = await runSmokeCase({");
    const defaultCaseBlock = script.slice(defaultCaseStartIndex, script.indexOf('});', defaultCaseStartIndex) + 3);

    expect(matrixReferralIndex).toBeGreaterThanOrEqual(0);
    expect(defaultReferralIndex).toBe(-1);
    expect(nullableReferralAssertionIndex).toBeGreaterThanOrEqual(0);
    expect(defaultCaseStartIndex).toBeGreaterThan(nullableReferralAssertionIndex);
    expect(defaultCaseBlock).not.toContain('expectedReferralDate:');
  });

  it('adds an opt-in skills behaviors proof mode without changing the default docx or existing pdf mini matrix commands', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-iehp-assessment-import-smoke.ts'),
      'utf8',
    );
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };

    const skillsBehaviorsFlagIndex = script.indexOf(
      "const isSkillsBehaviorsProofMode = process.argv.includes('--skills-behaviors-proof');",
    );
    const skillsBehaviorsCaseIndex = script.indexOf('IEHP_SKILLS_BEHAVIORS_PROOF_CASE');
    const reusableProofRunnerIndex = script.indexOf('const runSkillsBehaviorsProofCase = async () =>');
    const proofHtmlIndex = script.indexOf('buildIehpSkillsBehaviorsProofPdfHtml', reusableProofRunnerIndex);
    const checklistAssertionIndex = script.indexOf('assertIehpSkillsBehaviorsChecklistSection');
    const checklistFetchIndex = script.indexOf('const checklist = await fetchAssessmentChecklist');
    const pagePdfIndex = script.indexOf(
      "const pdfBuffer = await proofPdfPage.pdf({ format: 'Letter', printBackground: true });",
      proofHtmlIndex,
    );
    const proofCaseRunnerIndex = script.indexOf('const proofCaseEvidence = await runSkillsBehaviorsProofCase();');
    const proofEvidenceIndex = script.indexOf('skillsBehaviorsAssertion');
    const proofModeIndex = script.indexOf("mode: 'skills-behaviors-proof'");

    expect(packageJson.scripts?.['playwright:iehp-assessment-import-smoke']).toBe(
      'tsx scripts/playwright-iehp-assessment-import-smoke.ts',
    );
    expect(packageJson.scripts?.['playwright:iehp-assessment-import-pdf-mini-matrix']).toBe(
      'tsx scripts/playwright-iehp-assessment-import-smoke.ts --pdf-mini-matrix',
    );
    expect(packageJson.scripts?.['playwright:iehp-assessment-import-skills-behaviors']).toBe(
      'tsx scripts/playwright-iehp-assessment-import-smoke.ts --skills-behaviors-proof',
    );
    expect(skillsBehaviorsFlagIndex).toBeGreaterThanOrEqual(0);
    expect(skillsBehaviorsCaseIndex).toBeGreaterThan(skillsBehaviorsFlagIndex);
    expect(reusableProofRunnerIndex).toBeGreaterThan(skillsBehaviorsCaseIndex);
    expect(proofHtmlIndex).toBeGreaterThan(reusableProofRunnerIndex);
    expect(pagePdfIndex).toBeGreaterThan(proofHtmlIndex);
    expect(proofCaseRunnerIndex).toBeGreaterThan(pagePdfIndex);
    expect(checklistFetchIndex).toBeGreaterThanOrEqual(0);
    expect(checklistAssertionIndex).toBeGreaterThan(checklistFetchIndex);
    expect(proofEvidenceIndex).toBeGreaterThan(checklistAssertionIndex);
    expect(proofModeIndex).toBeGreaterThan(proofCaseRunnerIndex);
  });

  it('adds an opt-in generated docx parity mode and command after the skills behaviors smoke', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-iehp-assessment-import-smoke.ts'),
      'utf8',
    );
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };

    const generatedDocxFlagIndex = script.indexOf(
      "const isGeneratedDocxParityMode = process.argv.includes('--generated-docx-parity');",
    );
    const generatedRunnerIndex = script.indexOf('const runGeneratedDocxParityCase = async () =>');
    const generatedPdfPageIndex = script.indexOf('const generatedPdfPage = await context.newPage();', generatedRunnerIndex);
    const generatedPdfHtmlIndex = script.indexOf('buildIehpGeneratedDocxParityPdfHtml', generatedRunnerIndex);
    const generatedPdfBufferIndex = script.indexOf(
      "generatedPdfBuffer = await generatedPdfPage.pdf({ format: 'Letter', printBackground: true });",
      generatedRunnerIndex,
    );
    const generatedPdfUploadNameIndex = script.indexOf("const uploadFileName = buildIehpSmokeUploadFileName(Date.now(), 'pdf');", generatedRunnerIndex);
    const generatedPdfMimeIndex = script.indexOf("mimeType: 'application/pdf'", generatedRunnerIndex);
    const preflightCallIndex = script.indexOf('const preflightBeforeApprovalResponse = await postAssessmentPlanPdfPreflight', generatedRunnerIndex);
    const manifestDerivationIndex = script.indexOf('deriveIehpGeneratedDocxParityManifest', generatedRunnerIndex);
    const approvalSelectionIndex = script.indexOf('selectIehpRequiredFinalOutputApprovals', generatedRunnerIndex);
    const approvedRefetchIndex = script.indexOf('const approvedChecklist = await fetchAssessmentChecklist', generatedRunnerIndex);
    const reviewHeadingIndex = script.indexOf("const reviewHeading = page.getByRole('heading', { name: 'IEHP FBA Checklist Review' });", generatedRunnerIndex);
    const restoredSelectionCallIndex = script.indexOf('await restoreIehpGeneratedDocxReviewSelection({', generatedRunnerIndex);
    const uploadFileButtonIndex = script.indexOf("name: uploadFileName, exact: true", generatedRunnerIndex);
    const generateButtonIndex = script.indexOf("name: /Generate completed IEHP DOCX/i", generatedRunnerIndex);
    const outputFixtureReaderIndex = script.indexOf('readSyntheticGeneratedDocxText', generatedRunnerIndex);
    const storageCleanupIndex = script.indexOf('deleteAssessmentStorageObject', generatedRunnerIndex);
    const generatedModeIndex = script.indexOf("mode: 'generated-docx-parity'", generatedRunnerIndex);

    expect(packageJson.scripts?.['playwright:iehp-assessment-import-generated-docx-parity']).toBe(
      'tsx scripts/playwright-iehp-assessment-import-smoke.ts --generated-docx-parity',
    );
    expect(generatedDocxFlagIndex).toBeGreaterThanOrEqual(0);
    expect(generatedRunnerIndex).toBeGreaterThan(generatedDocxFlagIndex);
    expect(generatedPdfPageIndex).toBeGreaterThan(generatedRunnerIndex);
    expect(generatedPdfHtmlIndex).toBeGreaterThan(generatedPdfPageIndex);
    expect(generatedPdfBufferIndex).toBeGreaterThan(generatedPdfHtmlIndex);
    expect(generatedPdfUploadNameIndex).toBeGreaterThan(generatedRunnerIndex);
    expect(generatedPdfMimeIndex).toBeGreaterThan(generatedPdfUploadNameIndex);
    expect(preflightCallIndex).toBeGreaterThan(generatedDocxFlagIndex);
    expect(manifestDerivationIndex).toBeGreaterThan(preflightCallIndex);
    expect(approvalSelectionIndex).toBeGreaterThan(manifestDerivationIndex);
    expect(approvedRefetchIndex).toBeGreaterThan(approvalSelectionIndex);
    expect(reviewHeadingIndex).toBeGreaterThan(approvedRefetchIndex);
    expect(uploadFileButtonIndex).toBeGreaterThan(reviewHeadingIndex);
    expect(restoredSelectionCallIndex).toBeGreaterThan(reviewHeadingIndex);
    expect(restoredSelectionCallIndex).toBeGreaterThan(uploadFileButtonIndex);
    expect(generateButtonIndex).toBeGreaterThan(approvedRefetchIndex);
    expect(outputFixtureReaderIndex).toBeGreaterThan(generateButtonIndex);
    expect(storageCleanupIndex).toBeGreaterThan(outputFixtureReaderIndex);
    expect(generatedModeIndex).toBeGreaterThanOrEqual(0);
  });
});

describe('parseAssessmentPlanPdfPreflight', () => {
  it('reads the hosted preflight payload shape and fails closed if it drifts', () => {
    expect(
      parseAssessmentPlanPdfPreflight({
        assessment_document_id: 'assessment-123',
        generated_file_type: 'docx',
        preflight: {
          ready: false,
          blockers: [{ code: 'required_checklist_pending' }],
          warnings: [],
        },
      }),
    ).toEqual({
      assessmentDocumentId: 'assessment-123',
      generatedFileType: 'docx',
      ready: false,
      blockers: [{ code: 'required_checklist_pending' }],
    });
  });

  it.each([
    {
      name: 'missing preflight object',
      payload: { assessment_document_id: 'assessment-123', generated_file_type: 'docx' },
      message: 'payload.preflight',
    },
    {
      name: 'missing ready boolean',
      payload: { assessment_document_id: 'assessment-123', generated_file_type: 'docx', preflight: { blockers: [] } },
      message: 'ready boolean',
    },
    {
      name: 'missing blockers array',
      payload: { assessment_document_id: 'assessment-123', generated_file_type: 'docx', preflight: { ready: true } },
      message: 'blockers array',
    },
  ])('fails clearly for $name', ({ payload, message }) => {
    expect(() => parseAssessmentPlanPdfPreflight(payload)).toThrow(message);
  });
});

describe('cleanupGeneratedDocxParityArtifacts', () => {
  it('attempts both generated-object and source cleanup even when the first one fails', async () => {
    const deleteGeneratedArtifact = vi.fn().mockRejectedValue(new Error('generated delete failed'));
    const deleteSourceAssessment = vi.fn().mockResolvedValue(undefined);

    await expect(
      cleanupGeneratedDocxParityArtifacts({
        generatedArtifact: { bucketId: 'generated-bucket', objectPath: 'generated/path.docx' },
        sourceAssessment: {
          assessmentDocumentId: 'assessment-123',
          bucketId: 'client-documents',
          objectPath: 'clients/source.pdf',
        },
        deleteGeneratedArtifact,
        deleteSourceAssessment,
      }),
    ).rejects.toThrow('IEHP generated DOCX parity cleanup did not complete for 1 cleanup target(s).');

    expect(deleteGeneratedArtifact).toHaveBeenCalledTimes(1);
    expect(deleteSourceAssessment).toHaveBeenCalledTimes(1);
  });
});

describe('generated DOCX artifact containment', () => {
  it('accepts only the exact private bucket and assessment-scoped generated object path', () => {
    expect(
      assertIehpGeneratedDocxStorageTarget({
        bucketId: 'client-documents',
        objectPath: 'clients/client-123/assessments/generated-iehp-fba-assessment-123-1786560000000.docx',
        clientId: 'client-123',
        assessmentDocumentId: 'assessment-123',
      }),
    ).toEqual({
      bucketId: 'client-documents',
      objectPath: 'clients/client-123/assessments/generated-iehp-fba-assessment-123-1786560000000.docx',
    });
  });

  it.each([
    {
      name: 'wrong bucket',
      bucketId: 'public-documents',
      objectPath: 'clients/client-123/assessments/generated-iehp-fba-assessment-123-1786560000000.docx',
      message: 'unexpected generated artifact bucket',
    },
    {
      name: 'wrong client',
      bucketId: 'client-documents',
      objectPath: 'clients/other-client/assessments/generated-iehp-fba-assessment-123-1786560000000.docx',
      message: 'unexpected generated artifact object path',
    },
    {
      name: 'wrong assessment',
      bucketId: 'client-documents',
      objectPath: 'clients/client-123/assessments/generated-iehp-fba-other-assessment-1786560000000.docx',
      message: 'unexpected generated artifact object path',
    },
  ])('rejects $name before cleanup can delete it', ({ bucketId, objectPath, message }) => {
    expect(() =>
      assertIehpGeneratedDocxStorageTarget({
        bucketId,
        objectPath,
        clientId: 'client-123',
        assessmentDocumentId: 'assessment-123',
      }),
    ).toThrow(message);
  });

  it('uses a non-artifact temp directory and removes the DOCX after extracting text', async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'iehp-docx-parity-test-'));
    let capturedPath = '';

    try {
      const text = await readSyntheticGeneratedDocxText(Buffer.from('synthetic-docx'), {
        tempRoot,
        reader: async (filePath) => {
          capturedPath = filePath;
          expect(existsSync(filePath)).toBe(true);
          expect(filePath).not.toContain(path.join('artifacts', 'latest'));
          return 'synthetic extracted text';
        },
      });

      expect(text).toBe('synthetic extracted text');
      expect(existsSync(capturedPath)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('matches every representative heading against the bundled generated IEHP DOCX template', async () => {
    const templateBuffer = readFileSync(
      path.resolve('supabase/functions/generate-assessment-plan-docx/fill_docs/Updated FBA -IEHP.docx'),
    );
    const generatedDocxText = await readSyntheticGeneratedDocxText(templateBuffer);

    expect(
      assertIehpGeneratedDocxTextParity({
        generatedDocxText,
        sourceManifest: {
          sectionCount: 1,
          version: 1,
          names: [],
          totalNames: 0,
          behaviorCount: 0,
          skillCount: 0,
          matchedCount: 0,
          detailedOnlyCount: 0,
          summaryOnlyOrAmbiguousCount: 0,
        },
        proofCase: {
          ...IEHP_GENERATED_DOCX_PARITY_PROOF_CASE,
          expectedNarrativeTerms: [],
        },
      }),
    ).toMatchObject({
      expectedSectionHeadingCount: 26,
      matchedSectionHeadingCount: 26,
      allExpectedContentPresent: true,
    });
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
