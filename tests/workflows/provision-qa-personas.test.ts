import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  path.resolve(process.cwd(), '.github/workflows/provision-qa-personas.yml'),
  'utf8',
);

describe('persistent QA persona protected workflow', () => {
  it('is owner-only, main-only, issue-bound, and immutable-SHA-bound', () => {
    expect(workflow).toContain("github.actor_id == '129695080'");
    expect(workflow).toContain("github.event.repository.owner.type == 'User'");
    expect(workflow).toContain("github.event.repository.owner.id == 129695080");
    expect(workflow).toContain("I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING");
    expect(workflow).toContain("process.env.GITHUB_REF !== 'refs/heads/main'");
    expect(workflow).toContain("mainRef.object?.sha !== commitSha");
    expect(workflow).toContain("pull.merge_commit_sha !== commitSha");
    expect(workflow).toContain('Approval pull request must reference WIN-43.');
  });

  it('does not accept mutable persona, role, organization, or credential inputs', () => {
    const inputBlock = workflow.slice(workflow.indexOf('inputs:'), workflow.indexOf('permissions:'));
    expect(inputBlock).toContain('commit_sha:');
    expect(inputBlock).toContain('pull_request_number:');
    expect(inputBlock).toContain('approval_acknowledgement:');
    expect(inputBlock).not.toMatch(/organization|persona|role|email|password/i);
  });

  it('uses isolated bootstrap secrets and never mutates active Playwright secrets', () => {
    for (const role of ['BT', 'THERAPIST', 'BCBA', 'MIDTIER', 'ADMIN_SCHEDULE', 'CLIENT', 'ADMIN', 'SUPERADMIN']) {
      expect(workflow).toContain(`secrets.QA_BOOTSTRAP_${role}_EMAIL`);
      expect(workflow).toContain(`secrets.QA_BOOTSTRAP_${role}_PASSWORD`);
    }
    expect(workflow).not.toContain('gh secret set');
    expect(workflow).not.toContain('actions: write');
    expect(workflow).not.toContain('contents: write');
  });

  it('re-attests main before credentials and uploads only the sanitized manifest', () => {
    const reattest = workflow.indexOf('Re-attest current main immediately before protected credentials');
    const provision = workflow.indexOf('Provision and verify persistent synthetic QA personas');
    expect(reattest).toBeGreaterThan(-1);
    expect(provision).toBeGreaterThan(reattest);
    expect(workflow).toContain('QA_PERSONA_MANIFEST_PATH: artifacts/win-43/qa-persona-manifest.json');
    expect(workflow).toContain('retention-days: 7');
  });
});
