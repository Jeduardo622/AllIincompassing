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
    expect(approvalStep?.run).toContain('allowedHeadRefs');
    expect(approvalStep?.run).toContain('codex/return-bt-correction');
    expect(approvalStep?.run).toContain('codex/win-232-hosted-visual-proof');
    expect(validationSource).not.toContain('secrets.');
    expect(validationSource).not.toContain('SUPABASE_');
    expect(checkoutStep?.with).toMatchObject({
      ref: '${{ steps.approval.outputs.validated_sha }}',
      'persist-credentials': false,
    });
    expect(headStep?.run).toContain('git rev-parse HEAD');
    expect(validation?.outputs).toEqual({
      validated_sha: '${{ steps.approval.outputs.validated_sha }}',
      validated_pr_number: '${{ steps.approval.outputs.validated_pr_number }}',
      validated_branch_name: '${{ steps.approval.outputs.validated_branch_name }}',
    });
  });

  it('runs proof only from the validated SHA and keeps protected credentials step-local', () => {
    const { source, workflow } = loadWorkflow();
    const proof = workflow.jobs?.proof;
    const proofSource = JSON.stringify(proof);
    const checkoutStep = findStep(proof, 'Checkout validated commit');
    const identifierStep = findStep(proof, 'Validate managed preview identifiers');
    const createStep = findStep(proof, 'Validate managed PR preview branch and retrieve masked keys');
    const fixtureStep = findStep(proof, 'Provision marker-owned synthetic fixture');
    const previewStep = findStep(proof, 'Launch protected preview and wait for health');
    const browserStep = findStep(proof, 'Run completed ABA read-only browser proof');

    expect(proof?.needs).toBe('validate');
    expect(proof?.permissions).toEqual({ contents: 'read' });
    expect(proofSource).not.toContain('${{ inputs.');
    expect(checkoutStep?.with).toMatchObject({
      ref: '${{ needs.validate.outputs.validated_sha }}',
      'persist-credentials': false,
    });
    expect(proof?.env).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(proof?.env).not.toHaveProperty('SUPABASE_SECRET_KEY');
    expect(identifierStep?.run).toContain('SUPABASE_BRANCH_NAME');
    expect(createStep?.env).toEqual({
      SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    });
    expect(createStep?.run).toContain('install -m 600 /dev/null "$PRIVATE_BRANCH_ENV"');
    expect(createStep?.run).toContain('GITHUB_ENV="$PRIVATE_BRANCH_ENV" npm run bt-aba:disposable-branch -- --managed-preview');
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
    expect(source.match(/SUPABASE_SECRET_KEY/g)).toHaveLength(4);
    expect(source).not.toMatch(/VITE_[A-Z0-9_]*SECRET/);
    expect(source).not.toContain('--with-data');
  });

  it('uploads proof evidence before a separate bounded always-run managed-branch health verification', () => {
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
    const cleanupRun = findStep(cleanup, 'Verify managed PR preview branch remains healthy');
    const cleanupUpload = findStep(cleanup, 'Upload deletion evidence');

    expect(findStep(proof, 'Delete and verify disposable branch')).toBeUndefined();
    expect(stopIndex).toBeGreaterThan(-1);
    expect(proofUploadIndex).toBeGreaterThan(stopIndex);
    expect(proofSteps[stopIndex]?.if).toBe('always()');
    expect(proofUpload?.if).toBe('always()');
    expect(proofUpload?.with?.path).toBe('${{ runner.temp }}/bt-aba-public-evidence/**');
    expect(proofUpload?.with?.path).not.toContain('branch-secrets.env');
    expect(proofUpload?.with?.path).not.toContain('preview.log');
    expect(proofUpload?.with?.path).not.toContain('artifacts/latest');
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
    expect(cleanupSource).toContain('${{ needs.validate.outputs.validated_branch_name }}');
    expect(cleanup?.env).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(cleanupRun?.env).toEqual({
      SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    });
    expect(cleanupRun?.run).toContain('npm run bt-aba:disposable-branch -- --verify-managed-preview');
    expect(cleanupRun?.run).not.toContain('--cleanup');
    expect(cleanupUpload?.if).toBe('always()');
    expect(cleanupUpload?.uses).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(cleanupUpload?.with?.path).toContain('deletion-evidence.txt');
    expect(source.match(/secrets\.SUPABASE_ACCESS_TOKEN/g)).toHaveLength(2);
    expect(source).not.toContain('BT_ABA_MANAGED_BRANCH_ID');
    expect(source).not.toContain('BT_ABA_MANAGED_BRANCH_PROJECT_REF');
    expect(source).toContain('SUPABASE_BRANCH_PR_NUMBER: ${{ needs.validate.outputs.validated_pr_number }}');
    expect(source).toContain('PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK: retain-platform-managed-pr-preview');
  });

  it('pins actions and preserves exact migration, preview, browser, and artifact boundaries', () => {
    const { source } = loadWorkflow();

    expect(source).toContain('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5');
    expect(source).toContain('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
    expect(source).toContain('supabase/setup-cli@b60b5899c73b63a2d2d651b1e90db8d4c9392f51');
    expect(source).not.toContain('supabase link');
    expect(source).not.toContain('supabase db query');
    expect(source).toContain('npx tsx scripts/provision-ci-smoke-bt-aba.ts');
    expect(source).toContain('PREVIEW_ENABLE_SESSION_NOTES_API="true"');
    expect(source).toContain('PREVIEW_ENABLE_SESSION_START_API="true"');
    expect(source).toContain('PW_BT_CLEANUP_STATE_PATH: ${{ runner.temp }}/bt-aba-proof/cleanup-state.json');
    expect(source).toContain('npx tsx scripts/cleanup-ci-smoke-bt-aba.ts');
    expect(source).toContain('fixture_cleanup=passed');
    expect(source).toContain('if [ "$SUPABASE_BRANCH_NAME" = "codex/win-232-hosted-visual-proof" ]; then');
    expect(source).toContain('elif [ "$SUPABASE_BRANCH_NAME" = "codex/return-bt-correction" ]; then');
    expect(source).not.toContain("elif [ \"$SUPABASE_BRANCH_NAME\" = \"codex/return-bt-correction\" ]; then\r\n            npm run playwright:bt-aba-session-note");
    expect(source).not.toContain("elif [ \"$SUPABASE_BRANCH_NAME\" = \"codex/return-bt-correction\" ]; then\n            npm run playwright:bt-aba-session-note");
    expect(source).toContain('npm run playwright:supervision-correction');
    expect(source).toContain('supervision_correction_browser_proof=passed');
    expect(source).toContain('WIN-232-completed-aba-note-read-only.png');
    expect(source).not.toContain('npx tsx scripts/provision-ci-smoke-bcba.ts');
    expect(source).toContain('PW_BT_PROOF_ARTIFACT_DIR: ${{ runner.temp }}/bt-aba-public-evidence');
    expect(source).not.toContain('artifacts/latest/**');
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
