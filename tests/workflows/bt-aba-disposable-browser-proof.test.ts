import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type WorkflowStep = {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  needs?: string | string[];
  if?: string;
  uses?: string;
  secrets?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  steps?: WorkflowStep[];
};

type ProofWorkflow = {
  on?: {
    workflow_call?: {
      inputs?: Record<string, { required?: boolean; type?: string }>;
      secrets?: Record<string, { required?: boolean }>;
    };
    workflow_dispatch?: {
      inputs?: Record<string, {
        required?: boolean;
        type?: string;
        default?: unknown;
        options?: string[];
      }>;
    };
  };
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
};

const workflowPath = path.join(
  process.cwd(),
  '.github/workflows/bt-aba-disposable-browser-proof.yml',
);
const dispatcherPath = path.join(process.cwd(), '.github/workflows/supabase-preview.yml');

const loadWorkflow = (): { source: string; workflow: ProofWorkflow } => {
  const source = readFileSync(workflowPath, 'utf8');
  return { source, workflow: parse(source) as ProofWorkflow };
};

const findStep = (job: WorkflowJob | undefined, name: string): WorkflowStep | undefined =>
  job?.steps?.find((step) => step.name === name);

describe('manual disposable BT/ABA browser proof workflow', () => {
  it('requires an owner-approved immutable open same-repository PR head', () => {
    const { source, workflow } = loadWorkflow();
    const inputs = workflow.on?.workflow_call?.inputs ?? {};
    const validation = workflow.jobs?.validate;
    const validationSource = JSON.stringify(validation);
    const approvalStep = findStep(validation, 'Validate owner approval and open PR head');
    const checkoutStep = findStep(validation, 'Checkout validated commit');
    const headStep = findStep(validation, 'Verify immutable validation checkout');

    expect(Object.keys(workflow.on ?? {})).toEqual(['workflow_call']);
    expect(inputs).not.toHaveProperty('ref');
    expect(inputs).toMatchObject({
      commit_sha: { required: true, type: 'string' },
      pull_request_number: { required: true, type: 'string' },
      approval_acknowledgement: { required: true, type: 'string' },
    });
    expect(workflow.on?.workflow_call?.secrets).toEqual({
      SUPABASE_ACCESS_TOKEN: { required: true },
    });
    expect(source).not.toContain('pull_request:');
    expect(source).not.toContain('push:');
    expect(validation?.if).toBe('github.actor == github.repository_owner');
    expect(validation?.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
    expect(approvalStep?.run).toContain('/^[0-9a-f]{40}$/');
    expect(approvalStep?.run).toContain('I_APPROVE_BT_ABA_DISPOSABLE_PROOF');
    expect(approvalStep?.run).toContain('GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER');
    expect(approvalStep?.run).toContain("pull.state !== 'open'");
    expect(approvalStep?.run).toContain("pull.base?.ref !== 'main'");
    expect(approvalStep?.run).toContain('pull.head?.repo?.full_name !== repository');
    expect(approvalStep?.run).toContain('pull.head?.sha !== commitSha');
    expect(validationSource).not.toContain('secrets.');
    expect(validationSource).not.toContain('SUPABASE_');
    expect(checkoutStep?.with).toMatchObject({
      ref: '${{ steps.approval.outputs.validated_sha }}',
      'persist-credentials': false,
    });
    expect(headStep?.run).toContain('git rev-parse HEAD');
    expect(validation?.outputs).toEqual({
      validated_sha: '${{ steps.approval.outputs.validated_sha }}',
    });
  });

  it('runs proof only from the validated SHA and keeps protected credentials step-local', () => {
    const { source, workflow } = loadWorkflow();
    const proof = workflow.jobs?.proof;
    const proofSource = JSON.stringify(proof);
    const checkoutStep = findStep(proof, 'Checkout validated commit');
    const createStep = findStep(proof, 'Create and poll disposable branch and retrieve masked keys');
    const migrationStep = findStep(proof, 'Link validated branch and apply exact closeout migration');
    const fixtureStep = findStep(proof, 'Provision marker-owned synthetic fixture');
    const previewStep = findStep(proof, 'Launch protected preview and wait for health');
    const browserStep = findStep(proof, 'Run BT ABA session-note browser proof');

    expect(proof?.needs).toBe('validate');
    expect(proof?.permissions).toEqual({ contents: 'read' });
    expect(proofSource).not.toContain('${{ inputs.');
    expect(checkoutStep?.with).toMatchObject({
      ref: '${{ needs.validate.outputs.validated_sha }}',
      'persist-credentials': false,
    });
    expect(proof?.env).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(proof?.env).not.toHaveProperty('SUPABASE_SECRET_KEY');
    expect(createStep?.env).toEqual({
      SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    });
    expect(migrationStep?.env).toEqual({
      SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    });
    expect(createStep?.run).toContain('install -m 600 /dev/null "$PRIVATE_BRANCH_ENV"');
    expect(createStep?.run).toContain('GITHUB_ENV="$PRIVATE_BRANCH_ENV" npm run bt-aba:disposable-branch -- --create');
    expect(createStep?.run).toContain("'SUPABASE_BRANCH_ID'");
    expect(createStep?.run).toContain("'SUPABASE_BRANCH_PROJECT_REF'");
    expect(createStep?.run).toContain("'SUPABASE_URL'");
    expect(createStep?.run).toContain("'SUPABASE_PUBLISHABLE_KEY'");
    expect(source).not.toContain('source "$PRIVATE_BRANCH_ENV"');
    expect(source).not.toContain('. "$PRIVATE_BRANCH_ENV"');
    expect(source).not.toContain('${{ env.SUPABASE_SECRET_KEY }}');
    expect(fixtureStep?.run).toContain('SUPABASE_SERVICE_ROLE_KEY="$(node');
    expect(previewStep?.run).toContain('SUPABASE_SERVICE_ROLE_KEY="$(node');
    expect(browserStep?.run).toContain('SUPABASE_SERVICE_ROLE_KEY="$(node');
    expect(source.match(/SUPABASE_SECRET_KEY/g)).toHaveLength(3);
    expect(source).not.toMatch(/VITE_[A-Z0-9_]*SECRET/);
    expect(source).not.toContain('--with-data');
  });

  it('uploads proof evidence before a separate bounded always-run cleanup job', () => {
    const { source, workflow } = loadWorkflow();
    const proof = workflow.jobs?.proof;
    const cleanup = workflow.jobs?.cleanup;
    const cleanupSource = JSON.stringify(cleanup);
    const proofSteps = proof?.steps ?? [];
    const stopIndex = proofSteps.findIndex((step) => step.name === 'Stop protected preview');
    const proofUploadIndex = proofSteps.findIndex((step) => step.name === 'Upload redacted browser evidence');
    const proofUpload = proofSteps[proofUploadIndex];
    const cleanupCheckout = findStep(cleanup, 'Checkout validated commit');
    const cleanupHead = findStep(cleanup, 'Verify immutable cleanup checkout');
    const cleanupRun = findStep(cleanup, 'Delete and verify disposable branch');
    const cleanupUpload = findStep(cleanup, 'Upload deletion evidence');

    expect(findStep(proof, 'Delete and verify disposable branch')).toBeUndefined();
    expect(stopIndex).toBeGreaterThan(-1);
    expect(proofUploadIndex).toBeGreaterThan(stopIndex);
    expect(proofSteps[stopIndex]?.if).toBe('always()');
    expect(proofUpload?.if).toBe('always()');
    expect(proofUpload?.with?.path).not.toContain('branch-secrets.env');
    expect(proofUpload?.with?.path).not.toContain('preview.log');
    expect(cleanup?.needs).toEqual(['validate', 'proof']);
    expect(cleanup?.permissions).toEqual({ contents: 'read' });
    expect(cleanup?.if).toBe("always() && needs.validate.result == 'success'");
    expect(cleanup?.['timeout-minutes']).toBe(15);
    expect(cleanupCheckout?.with).toMatchObject({
      ref: '${{ needs.validate.outputs.validated_sha }}',
      'persist-credentials': false,
    });
    expect(cleanupHead?.run).toContain('git rev-parse HEAD');
    expect(findStep(cleanup, 'Setup Node')).toBeDefined();
    expect(findStep(cleanup, 'Setup Supabase CLI')).toBeDefined();
    expect(findStep(cleanup, 'Install dependencies')?.run).toBe('npm ci');
    expect(cleanupSource).toContain('bt-aba-proof-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(cleanup?.env).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(cleanupRun?.env).toEqual({
      SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    });
    expect(cleanupRun?.run).toContain('npm run bt-aba:disposable-branch -- --cleanup');
    expect(cleanupUpload?.if).toBe('always()');
    expect(cleanupUpload?.uses).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(cleanupUpload?.with?.path).toContain('deletion-evidence.txt');
    expect(source.match(/secrets\.SUPABASE_ACCESS_TOKEN/g)).toHaveLength(3);
  });

  it('pins actions and preserves exact migration, preview, browser, and artifact boundaries', () => {
    const { source } = loadWorkflow();

    expect(source).toContain('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5');
    expect(source).toContain('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
    expect(source).toContain('supabase/setup-cli@b60b5899c73b63a2d2d651b1e90db8d4c9392f51');
    expect(source).toContain('supabase link --project-ref "$SUPABASE_BRANCH_PROJECT_REF" --yes');
    expect(source).toContain('supabase db query --linked --file supabase/migrations/20260716212837_bt_aba_session_note_closeout.sql');
    expect(source).toContain('npx tsx scripts/provision-ci-smoke-bt-aba.ts');
    expect(source).toContain('PREVIEW_ENABLE_SESSION_NOTES_API="true"');
    expect(source).toContain('npm run playwright:bt-aba-session-note');
    expect(source).toContain('artifacts/latest/**');
    expect(source).not.toMatch(/artifacts:[\s\S]*branch-secrets\.env/);
  });

  it('routes BT mode through the existing manual Supabase Preview dispatcher', () => {
    const source = readFileSync(dispatcherPath, 'utf8');
    const dispatcher = parse(source) as ProofWorkflow;
    const inputs = dispatcher.on?.workflow_dispatch?.inputs ?? {};
    const preview = dispatcher.jobs?.preview;
    const protectedProof = dispatcher.jobs?.bt_aba_disposable_proof;
    const generateTypes = findStep(preview, 'Generate DB types (optional)');

    expect(Object.keys(dispatcher.on ?? {})).toEqual(['workflow_dispatch']);
    expect(inputs.mode).toMatchObject({
      required: true,
      type: 'choice',
      default: 'local-preview',
      options: ['local-preview', 'bt-aba-disposable-proof'],
    });
    expect(inputs.ref).toMatchObject({
      required: false,
      type: 'string',
      default: 'feat/rls-rollout-mcp',
    });
    expect(inputs).toHaveProperty('commit_sha');
    expect(inputs).toHaveProperty('pull_request_number');
    expect(inputs).toHaveProperty('approval_acknowledgement');
    expect(preview?.if).toBe("inputs.mode != 'bt-aba-disposable-proof'");
    expect(preview?.env ?? {}).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(findStep(preview, 'Start local Supabase (ephemeral)')).toBeDefined();
    expect(findStep(preview, 'Run preview smoke suite')?.run).toBe('npm run preview:smoke');
    expect(generateTypes?.env).toEqual({
      SUPABASE_PROJECT_ID: '${{ vars.SUPABASE_PROJECT_ID }}',
      SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    });
    expect(protectedProof).toMatchObject({
      if: "inputs.mode == 'bt-aba-disposable-proof'",
      uses: './.github/workflows/bt-aba-disposable-browser-proof.yml',
      secrets: {
        SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
      },
      with: {
        commit_sha: '${{ inputs.commit_sha }}',
        pull_request_number: '${{ inputs.pull_request_number }}',
        approval_acknowledgement: '${{ inputs.approval_acknowledgement }}',
      },
    });
    expect(protectedProof?.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
    expect(source).not.toContain('secrets: inherit');
    expect(source.match(/secrets\.SUPABASE_ACCESS_TOKEN/g)).toHaveLength(2);
  });
});
