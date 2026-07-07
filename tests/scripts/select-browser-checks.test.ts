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

  it('runs full tier-0 without hosted auth smoke when browser selector changes', () => {
    const selection = runSelector('--changed-file', 'scripts/ci/select-browser-checks.mjs');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(false);
    expect(selection.tier0Specs).toContain('cypress/e2e/preauth_workflow.cy.ts');
    expect(selection.reasons).toEqual([
      'scripts/ci/select-browser-checks.mjs: browser check selector',
    ]);
  });

  it('keeps session cancellation changes out of hosted auth smoke', () => {
    const selection = runSelector('--changed-file', 'supabase/functions/sessions-cancel/index.ts');

    expect(selection.tier0Required).toBe(true);
    expect(selection.authSmokeRequired).toBe(false);
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

  it('keeps the PreAuth spec in the default local tier-0 Cypress run', () => {
    const runCypressSource = readFileSync('scripts/run-cypress.ts', 'utf8');

    expect(runCypressSource).toContain("'cypress/e2e/preauth_workflow.cy.ts'");
  });
});
