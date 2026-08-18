import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

const runSelector = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [
  'scripts/ci/select-browser-checks.mjs',
  ...args,
], {
  cwd: process.cwd(),
  encoding: 'utf8',
})) as {
  tier0Required: boolean;
  authSmokeRequired: boolean;
  iehpAssessmentImportSmokeRequired: boolean;
  supervisionCorrectionRequired: boolean;
  tier0Specs: string[];
  reasons: string[];
};

describe('select-browser-checks', () => {
  it('runs the PreAuth spec when the PreAuth workflow spec changes', () => {
    const selection = runSelector('--changed-file', 'cypress/e2e/preauth_workflow.cy.ts');

    expect(selection.tier0Required).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_client.cy.ts',
      'cypress/e2e/preauth_workflow.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'cypress/e2e/preauth_workflow.cy.ts: PreAuth workflow route',
    ]);
  });

  it('runs the PreAuth spec when the ClientDetails host route changes', () => {
    const selection = runSelector('--changed-file', 'src/pages/ClientDetails.tsx');

    expect(selection.tier0Required).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_client.cy.ts',
      'cypress/e2e/preauth_workflow.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'src/pages/ClientDetails.tsx: PreAuth workflow route',
    ]);
  });

  it('runs the PreAuth spec when PreAuth source changes', () => {
    const selection = runSelector('--changed-file', 'src/components/ClientDetails/PreAuthTab.tsx');

    expect(selection.tier0Required).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_client.cy.ts',
      'cypress/e2e/preauth_workflow.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'src/components/ClientDetails/PreAuthTab.tsx: PreAuth workflow route',
    ]);
  });

  it('runs the PreAuth spec when PreAuth unit coverage changes', () => {
    const selection = runSelector('--changed-file', 'src/components/__tests__/PreAuthTab.test.tsx');

    expect(selection.tier0Required).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_client.cy.ts',
      'cypress/e2e/preauth_workflow.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'src/components/__tests__/PreAuthTab.test.tsx: PreAuth workflow route',
    ]);
  });

  it('runs full tier-0 and hosted auth smoke when browser selector changes', () => {
    const selection = runSelector('--changed-file', 'scripts/ci/select-browser-checks.mjs');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.supervisionCorrectionRequired).toBe(true);
    expect(selection.tier0Specs).toContain('cypress/e2e/preauth_workflow.cy.ts');
    expect(selection.reasons).toEqual([
      'scripts/ci/select-browser-checks.mjs: browser CI support script',
    ]);
    expect(selection.iehpAssessmentImportSmokeRequired).toBe(true);
  });

  it('requires hosted auth smoke when the non-AI session credential contract changes', () => {
    const selection = runSelector(
      '--changed-file',
      'scripts/lib/playwright-nonai-sessions-contract.ts',
    );

    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_auth.cy.ts',
      'cypress/e2e/routes_schedule.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'scripts/lib/playwright-nonai-sessions-contract.ts: auth/session browser flow',
    ]);
  });

  it.each([
    'scripts/provision-ci-smoke-therapist.ts',
    'scripts/provision-ci-smoke-bcba.ts',
  ])('requires hosted auth smoke when synthetic actor provisioning changes: %s', (file) => {
    const selection = runSelector('--changed-file', file);

    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.tier0Required).toBe(true);
    expect(selection.iehpAssessmentImportSmokeRequired).toBe(false);
    expect(selection.supervisionCorrectionRequired).toBe(false);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_auth.cy.ts',
      'cypress/e2e/routes_schedule.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      `${file}: auth/session browser flow`,
    ]);
  });

  it('requires IEHP assessment import smoke for API and provisioning surfaces', () => {
    for (const file of [
      'netlify/functions/assessment-documents.ts',
      'netlify/functions/assessment-documents-extract-background.ts',
      'netlify/functions/assessment-drafts.ts',
      'netlify/functions/assessment-checklist.ts',
      'supabase/functions/extract-assessment-fields/iehp-skills-behaviors.ts',
      'src/server/api/assessment-documents.ts',
      'src/server/iehpAssessmentDocx.ts',
      'scripts/provision-ci-smoke-admin.ts',
      '.github/workflows/ci.yml',
    ]) {
      const selection = runSelector('--changed-file', file);

      expect(selection.iehpAssessmentImportSmokeRequired, file).toBe(true);
    }
  });

  it('fetches comparison history before selecting IEHP assessment import scope', () => {
    const workflowSource = readFileSync('.github/workflows/ci.yml', 'utf8');
    const jobStart = workflowSource.indexOf('  iehp_assessment_import_smoke:');
    const jobEnd = workflowSource.indexOf('  optional_playwright_smoke:', jobStart);
    const jobSource = workflowSource.slice(jobStart, jobEnd);

    expect(jobStart).toBeGreaterThanOrEqual(0);
    expect(jobSource).toContain('fetch-depth: 0');
    expect(jobSource.indexOf('fetch-depth: 0')).toBeLessThan(
      jobSource.indexOf('Select IEHP assessment import scope'),
    );
  });

  it('does not require IEHP assessment import smoke for unrelated client routes', () => {
    const selection = runSelector('--changed-file', 'src/components/ClientsTable.tsx');

    expect(selection.iehpAssessmentImportSmokeRequired).toBe(false);
  });

  it('flags the hosted supervision-correction proof when its workflow changes', () => {
    const selection = runSelector('--changed-file', '.github/workflows/bt-aba-disposable-browser-proof.yml');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.supervisionCorrectionRequired).toBe(true);
    expect(selection.reasons).toEqual([
      '.github/workflows/bt-aba-disposable-browser-proof.yml: shared route/auth surface',
    ]);
  });

  it('flags the hosted supervision-correction proof when its script changes', () => {
    const selection = runSelector('--changed-file', 'scripts/playwright-supervision-correction.ts');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.supervisionCorrectionRequired).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_auth.cy.ts',
      'cypress/e2e/routes_schedule.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'scripts/playwright-supervision-correction.ts: auth/session browser flow',
    ]);
  });

  it('runs full tier-0 without hosted auth smoke when deploy bundle script changes', () => {
    const selection = runSelector('--changed-file', 'scripts/ci/deploy-session-edge-bundle.mjs');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(false);
    expect(selection.tier0Specs).toContain('cypress/e2e/routes_schedule.cy.ts');
    expect(selection.reasons).toEqual([
      'scripts/ci/deploy-session-edge-bundle.mjs: browser CI support script',
    ]);
  });

  it('runs hosted auth smoke for session cancellation changes', () => {
    const selection = runSelector('--changed-file', 'supabase/functions/sessions-cancel/index.ts');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_schedule.cy.ts',
      'cypress/e2e/routes_auth.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'supabase/functions/sessions-cancel/index.ts: session cancellation edge flow',
    ]);
  });

  it('still requires hosted auth smoke for session start changes', () => {
    const selection = runSelector('--changed-file', 'supabase/functions/sessions-start/index.ts');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_auth.cy.ts',
      'cypress/e2e/routes_schedule.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'supabase/functions/sessions-start/index.ts: auth/session browser flow',
    ]);
  });

  it('requires hosted auth smoke for therapist user assignment changes', () => {
    const selection = runSelector('--changed-file', 'supabase/functions/assign-therapist-user/index.ts');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_admin.cy.ts',
      'cypress/e2e/routes_auth.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'supabase/functions/assign-therapist-user/index.ts: therapist provisioning auth flow',
    ]);
  });

  it('requires hosted auth smoke when the shared Playwright route helper changes', () => {
    const selection = runSelector('--changed-file', 'scripts/lib/playwright-smoke.ts');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_auth.cy.ts',
      'cypress/e2e/routes_schedule.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'scripts/lib/playwright-smoke.ts: auth/session browser flow',
    ]);
  });

  it('requires hosted auth smoke when the in-progress session setup helper changes', () => {
    const selection = runSelector('--changed-file', 'scripts/lib/playwright-inprogress-session-setup.ts');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(true);
    expect(selection.tier0Specs).toEqual([
      'cypress/e2e/routes_auth.cy.ts',
      'cypress/e2e/routes_schedule.cy.ts',
    ]);
    expect(selection.reasons).toEqual([
      'scripts/lib/playwright-inprogress-session-setup.ts: auth/session browser flow',
    ]);
  });

  it('keeps the PreAuth spec in the default local tier-0 Cypress run', () => {
    const runCypressSource = readFileSync('scripts/run-cypress.ts', 'utf8');

    expect(runCypressSource).toContain("'cypress/e2e/preauth_workflow.cy.ts'");
    expect(runCypressSource).toContain("cypressArgs.push('--browser', 'electron')");
  });
});
