import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { IEHP_PDF_MINI_MATRIX_CASES } from '../../scripts/lib/iehp-assessment-import-smoke';

type WorkflowStep = {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  needs?: string;
  if?: string;
  'timeout-minutes'?: number;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: WorkflowStep[];
};

type ProofWorkflow = {
  on?: {
    workflow_dispatch?: {
      inputs?: Record<string, { required?: boolean; type?: string }>;
    };
  };
  permissions?: Record<string, string>;
  concurrency?: { 'cancel-in-progress'?: boolean };
  jobs?: Record<string, WorkflowJob>;
};

const workflowPath = path.join(
  process.cwd(),
  '.github/workflows/iehp-pdf-mini-matrix-proof.yml',
);

const loadWorkflow = (): { source: string; workflow: ProofWorkflow } => {
  const source = readFileSync(workflowPath, 'utf8');
  return { source, workflow: parse(source) as ProofWorkflow };
};

const findStep = (job: WorkflowJob | undefined, name: string): WorkflowStep | undefined =>
  job?.steps?.find((step) => step.name === name);

describe('protected hosted IEHP PDF mini-matrix workflow', () => {
  it('requires an owner-approved immutable open same-repository PR head', () => {
    const { source, workflow } = loadWorkflow();
    const inputs = workflow.on?.workflow_dispatch?.inputs ?? {};
    const validation = workflow.jobs?.validate;
    const validationSource = JSON.stringify(validation);
    const approval = findStep(validation, 'Validate owner approval and open PR head');

    expect(Object.keys(workflow.on ?? {})).toEqual(['workflow_dispatch']);
    expect(inputs).toMatchObject({
      commit_sha: { required: true, type: 'string' },
      pull_request_number: { required: true, type: 'string' },
      approval_acknowledgement: { required: true, type: 'string' },
    });
    expect(source).not.toContain('pull_request:');
    expect(source).not.toContain('pull_request_target:');
    expect(source).not.toContain('push:');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false);
    expect(validation?.if).toBeUndefined();
    expect(validation?.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(approval?.run).toContain('/^[0-9a-f]{40}$/');
    expect(approval?.run).toContain('I_APPROVE_IEHP_PDF_MINI_MATRIX');
    expect(approval?.run).toContain('GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER');
    expect(approval?.run).toContain("pull.state !== 'open'");
    expect(approval?.run).toContain("pull.base?.ref !== 'main'");
    expect(approval?.run).toContain('pull.head?.repo?.full_name !== repository');
    expect(approval?.run).toContain('pull.head?.sha !== commitSha');
    expect(validationSource).not.toContain('secrets.');
    expect(findStep(validation, 'Checkout validated commit')?.with).toMatchObject({
      ref: '${{ steps.approval.outputs.validated_sha }}',
      'persist-credentials': false,
    });
    expect(findStep(validation, 'Verify immutable validation checkout')?.run).toContain(
      'git rev-parse HEAD',
    );
  });

  it('binds the hosted Netlify preview to the validated PR and commit before using secrets', () => {
    const { source, workflow } = loadWorkflow();
    const proof = workflow.jobs?.proof;
    const deploy = findStep(proof, 'Verify exact Netlify preview deployment');

    expect(proof?.needs).toBe('validate');
    expect(proof?.['timeout-minutes']).toBe(75);
    expect(proof?.permissions).toEqual({ checks: 'read', contents: 'read', statuses: 'read' });
    expect(findStep(proof, 'Checkout validated commit')?.with).toMatchObject({
      ref: '${{ needs.validate.outputs.validated_sha }}',
      'persist-credentials': false,
    });
    expect(findStep(proof, 'Verify immutable proof checkout')?.run).toContain('git rev-parse HEAD');
    expect(deploy?.env).toEqual({
      GITHUB_TOKEN: '${{ github.token }}',
      REPOSITORY: '${{ github.repository }}',
    });
    expect(deploy?.run).toContain('/commits/${expectedSha}/status');
    expect(deploy?.run).toContain("status.context === 'netlify/velvety-cendol-dae4d6/deploy-preview'");
    expect(deploy?.run).toContain("status.state === 'success'");
    expect(deploy?.run).toContain('status.target_url === expectedUrl');
    expect(deploy?.run).toContain('/commits/${expectedSha}/check-runs');
    expect(deploy?.run).toContain("details_url?.match(/\\/deploys\\/([a-f0-9]+)$/)");
    expect(deploy?.run).toContain('const candidateUrl = `https://${deployId}--velvety-cendol-dae4d6.netlify.app`;');
    expect(deploy?.run).toContain("appendFileSync(process.env.GITHUB_ENV, `PW_BASE_URL=${immutablePreviewUrl}\\n`");
    expect(deploy?.run).toContain("appendFileSync(process.env.GITHUB_ENV, `IEHP_PROOF_PREVIEW_URL=${immutablePreviewUrl}\\n`");
    expect(deploy?.run).toContain("await fetch(candidateUrl, { redirect: 'manual' })");
    expect(deploy?.run).toContain('for (let attempt = 1; attempt <= 60; attempt += 1)');
    expect(deploy?.run).toContain('setTimeout(resolve, 10_000)');
    expect(source).not.toContain('secrets: inherit');
    expect(proof?.env ?? {}).not.toHaveProperty('NETLIFY_AUTH_TOKEN');
    expect(proof?.env ?? {}).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('runs the existing matrix with fail-closed cleanup and curated redacted JSON evidence', () => {
    const { source, workflow } = loadWorkflow();
    const proof = workflow.jobs?.proof;
    const matrix = findStep(proof, 'Run hosted IEHP PDF mini-matrix');
    const cleanup = findStep(proof, 'Clean synthetic smoke admin');
    const finalize = findStep(proof, 'Finalize redacted run evidence');
    const upload = findStep(proof, 'Upload redacted matrix evidence');
    const expectedEvidenceCount = IEHP_PDF_MINI_MATRIX_CASES.length + 1;

    const provision = findStep(proof, 'Provision synthetic smoke admin');
    expect(provision?.env).toMatchObject({
      SUPABASE_URL: '${{ secrets.SUPABASE_URL }}',
      SUPABASE_SERVICE_ROLE_KEY: '${{ secrets.SUPABASE_SECRET_KEY || secrets.SUPABASE_SERVICE_ROLE_KEY }}',
    });
    expect(provision?.run).toContain('install -m 600 /dev/null "$PRIVATE_ADMIN_ENV_PATH"');
    expect(provision?.run).toContain('GITHUB_ENV="$PRIVATE_ADMIN_ENV_PATH" npx tsx scripts/provision-ci-smoke-admin.ts');
    expect(provision?.run).not.toContain(
      'iehp-pdf-mini-matrix-public',
    );
    expect(matrix?.run).toContain('npm run playwright:iehp-assessment-import-pdf-mini-matrix');
    expect(matrix?.run).toContain('set -a\nsource "$PRIVATE_ADMIN_ENV_PATH"\nset +a');
    expect(matrix?.env).toMatchObject({
      PRIVATE_ADMIN_ENV_PATH: '${{ runner.temp }}/iehp-pdf-mini-matrix-private/admin.env',
      PRIVATE_MATRIX_LOG_PATH: '${{ runner.temp }}/iehp-pdf-mini-matrix-private/matrix-output.log',
      PW_ASSESSMENT_CLIENT_ID: '${{ secrets.PW_ASSESSMENT_CLIENT_ID }}',
      VITE_SUPABASE_URL: '${{ secrets.SUPABASE_URL }}',
      SUPABASE_URL: '${{ secrets.SUPABASE_URL }}',
      VITE_SUPABASE_ANON_KEY: '${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}',
      SUPABASE_ANON_KEY: '${{ secrets.SUPABASE_PUBLISHABLE_KEY || secrets.SUPABASE_ANON_KEY }}',
    });
    expect(matrix?.run).toContain('set -o pipefail');
    expect(cleanup?.if).toBe('always()');
    expect(cleanup?.env).toEqual({
      PRIVATE_ADMIN_ENV_PATH: '${{ runner.temp }}/iehp-pdf-mini-matrix-private/admin.env',
      SUPABASE_URL: '${{ secrets.SUPABASE_URL }}',
      SUPABASE_SERVICE_ROLE_KEY: '${{ secrets.SUPABASE_SECRET_KEY || secrets.SUPABASE_SERVICE_ROLE_KEY }}',
    });
    expect(cleanup?.run).not.toContain('source "$PRIVATE_ADMIN_ENV_PATH"');
    expect(cleanup?.run).not.toContain('set -a');
    expect(cleanup?.run).not.toContain('export PW_SUPERADMIN_PASSWORD');
    expect(cleanup?.run).toContain('CI_SMOKE_ADMIN_EMAIL) CI_SMOKE_ADMIN_EMAIL="$value"');
    expect(cleanup?.run).toContain('PW_SUPERADMIN_USER_ID) PW_SUPERADMIN_USER_ID="$value"');
    expect(cleanup?.run).toContain('export PW_SUPERADMIN_USER_ID');
    expect(cleanup?.run).toContain('npx tsx scripts/provision-ci-smoke-admin.ts --cleanup');
    expect(finalize?.if).toBe('always()');
    expect(expectedEvidenceCount).toBe(8);
    expect(finalize?.run).toBe('node scripts/finalize-iehp-pdf-mini-matrix-evidence.mjs');
    expect(finalize?.run).not.toContain("node --input-type=module <<'NODE'");
    expect(finalize?.env).toHaveProperty('WORKFLOW_STATUS', '${{ job.status }}');
    expect(upload?.if).toBe('always()');
    expect(String(upload?.with?.path)).toContain('run-status.json');
    expect(String(upload?.with?.path)).toContain('run-metadata.json');
    expect(String(upload?.with?.path)).toContain('cases.json');
    expect(String(upload?.with?.path)).toContain('aggregate.json');
    expect(String(upload?.with?.path)).not.toContain('iehp-pdf-mini-matrix-private');
    expect(String(upload?.with?.path)).not.toContain('matrix-output.log');
    expect(String(upload?.with?.path)).not.toContain('.png');
    expect(upload?.with?.['if-no-files-found']).toBe('warn');
    expect(upload?.with?.['retention-days']).toBe(7);
    const steps = proof?.steps ?? [];
    expect(steps.indexOf(cleanup!)).toBeLessThan(steps.indexOf(upload!));
    expect(source).not.toContain('artifacts/latest/**');
    expect(source).not.toContain('PW_ASSESSMENT_SAMPLE_FILE');
    expect(source).not.toContain('PW_BASE_URL: ${{ needs.validate.outputs.preview_url }}');
    expect(finalize?.env).toHaveProperty('PREVIEW_URL', '${{ env.IEHP_PROOF_PREVIEW_URL }}');
    expect(source.match(/npm run playwright:iehp-assessment-import-pdf-mini-matrix/g)).toHaveLength(1);
  });
});
