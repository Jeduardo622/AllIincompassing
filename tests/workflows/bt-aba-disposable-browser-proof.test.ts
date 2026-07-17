import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = path.join(
  process.cwd(),
  '.github/workflows/bt-aba-disposable-browser-proof.yml',
);

describe('manual disposable BT/ABA browser proof workflow', () => {
  it('is manual-only and guarantees redacted evidence upload plus branch cleanup', () => {
    const source = readFileSync(workflowPath, 'utf8');
    const workflow = parse(source) as {
      on?: Record<string, unknown>;
      jobs?: { proof?: { steps?: Array<Record<string, unknown>> } };
    };

    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.on?.workflow_dispatch).toMatchObject({
      inputs: { ref: { required: true } },
    });
    expect(source).not.toContain('pull_request:');
    expect(source).not.toContain('push:');
    expect(source).toContain('if: always()');
    expect(source).toContain('--cleanup');
    expect(source).not.toContain('--with-data');
    expect(source).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(source).toContain('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5');
    expect(source).toContain('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
    expect(source).toContain('supabase/setup-cli@b60b5899c73b63a2d2d651b1e90db8d4c9392f51');
    expect(source).toContain('PROOF_SOURCE_REF: ${{ inputs.ref }}');
    expect(source).not.toContain('echo "source_ref=${{ inputs.ref }}"');
  });

  it('contains the fail-closed branch, migration, fixture, preview, and browser sequence', () => {
    const source = readFileSync(workflowPath, 'utf8');
    const workflow = parse(source) as {
      jobs?: { proof?: { steps?: Array<{ name?: string; run?: string }> } };
    };
    const steps = workflow.jobs?.proof?.steps ?? [];
    const createStep = steps.find((step) => step.name?.startsWith('Create and poll'));
    const validationStep = steps.find((step) => step.name === 'Validate non-production branch boundary');

    expect(source).toContain('npm run bt-aba:disposable-branch -- --create');
    expect(createStep?.run).not.toContain('branch_id=');
    expect(validationStep?.run).toContain('branch_id=${SUPABASE_BRANCH_ID}');
    expect(source).toContain('SUPABASE_BRANCH_PROJECT_REF');
    expect(source).toContain('Refusing production Supabase project');
    expect(source).toContain('supabase link --project-ref "$SUPABASE_BRANCH_PROJECT_REF" --yes');
    expect(source).toContain('supabase db query --linked --file supabase/migrations/20260716212837_bt_aba_session_note_closeout.sql');
    expect(source).not.toContain('${{ env.SUPABASE_SECRET_KEY }}');
    expect(source.match(/export SUPABASE_SERVICE_ROLE_KEY="\$SUPABASE_SECRET_KEY"/g)).toHaveLength(3);
    expect(source).not.toMatch(/VITE_[A-Z0-9_]*SECRET/);
    expect(source).toContain('tsx scripts/provision-ci-smoke-bt-aba.ts');
    expect(source).toContain('PREVIEW_ENABLE_SESSION_NOTES_API: "true"');
    expect(source).toContain('npm run playwright:bt-aba-session-note');
    expect(source).toContain('artifacts/latest/**');
    expect(source).not.toMatch(/artifacts:[\s\S]*SUPABASE_SECRET_KEY/);
  });
});
