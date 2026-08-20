import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  path.resolve(process.cwd(), '.github/workflows/provision-qa-personas.yaml'),
  'utf8',
);

const attestationPath = path.resolve(
  process.cwd(),
  'docs/ai/reviews/WIN-43-qa-persona-delegated-browser-dispatch-attestation.json',
);

const protectedSurfaces = [
  '.github/workflows/provision-qa-personas.yaml',
  'scripts/provision-persistent-qa-personas.ts',
  'tests/scripts/provision-persistent-qa-personas.test.ts',
  'tests/workflows/provision-qa-personas.test.ts',
  'tests/agentWorkLedgerDelegatedBrowserDispatchPolicy.test.ts',
  'AGENTS.md',
  '.agents/skills/route-task/SKILL.md',
  'docs/ai/cto-lane-contract.md',
  'docs/ai/high-risk-paths.md',
  'docs/ai/WIN-43-persistent-qa-personas-handoff.md',
  'docs/ai/WIN-43-qa-audit-credential-handoff.md',
  'docs/ai/handoffs/WIN-275-stale-edge-secret-cleanup.md',
  'docs/ai/handoffs/WIN-275-hosted-advisory-canary.md',
  'docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-attestation.md',
  'docs/ai/reviews/WIN-275-hosted-advisory-canary-attestation.md',
  'docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-solo-maintainer-attestation.json',
  'docs/ai/reviews/WIN-275-hosted-advisory-canary-solo-maintainer-attestation.json',
  'docs/ai/reviews/WIN-275-solo-maintainer-attestation.json',
] as const;

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

  it('requires exact-head CI, solo-maintainer topology, and hash-bound reviews', () => {
    expect(workflow).toContain('checks: read');
    expect(workflow).toContain(
      "const requiredCiChecks = ['policy', 'lint-typecheck', 'unit-tests', 'build', 'tier0-browser', 'auth-browser-smoke', 'ci-gate'];",
    );
    expect(workflow).toContain("check.head_sha === commitSha");
    expect(workflow).toContain("check.app?.slug === 'github-actions'");
    expect(workflow).toContain("check.conclusion === 'success'");
    expect(workflow).toContain('collaborators?affiliation=direct');
    expect(workflow).toContain('maintainers.length !== 1');
    expect(workflow).toContain(
      'WIN-43-qa-persona-delegated-browser-dispatch-attestation.json',
    );
    expect(workflow).toContain('protectedSurfaceHashes');
    expect(workflow).toContain(
      'WIN-275-stale-edge-secret-cleanup-solo-maintainer-attestation.json',
    );
    expect(workflow).toContain(
      'WIN-275-hosted-advisory-canary-solo-maintainer-attestation.json',
    );
    expect(workflow).toContain('WIN-275-solo-maintainer-attestation.json');
    for (const specialist of [
      'code-review-engineer',
      'security-engineer',
      'test-engineer',
      'software-architect',
      'supabase-reviewer',
      'devops-engineer',
    ]) {
      expect(workflow).toContain(`'${specialist}'`);
    }
  });

  it('binds passing specialist identities to every protected surface hash', () => {
    const attestation = JSON.parse(readFileSync(attestationPath, 'utf8')) as {
      schemaVersion?: number;
      issue?: string;
      reviewMode?: string;
      repository?: string;
      specialistReviews?: Record<string, { agentId?: string; verdict?: string }>;
      protectedSurfaceHashes?: Record<string, string>;
    };

    expect(attestation).toMatchObject({
      schemaVersion: 1,
      issue: 'WIN-43',
      reviewMode: 'solo-maintainer-owner-attestation',
      repository: 'Jeduardo622/AllIincompassing',
    });
    for (const specialist of [
      'code-review-engineer',
      'security-engineer',
      'test-engineer',
      'software-architect',
      'supabase-reviewer',
      'devops-engineer',
    ]) {
      expect(attestation.specialistReviews?.[specialist]).toMatchObject({
        verdict: 'PASS',
      });
      expect(attestation.specialistReviews?.[specialist]?.agentId).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    }
    expect(Object.keys(attestation.protectedSurfaceHashes ?? {}).sort()).toEqual(
      [...protectedSurfaces].sort(),
    );
    for (const surface of protectedSurfaces) {
      const actual = createHash('sha256')
        .update(readFileSync(path.resolve(process.cwd(), surface), 'utf8').replace(/\r\n/g, '\n'))
        .digest('hex');
      expect(attestation.protectedSurfaceHashes?.[surface]).toBe(actual);
    }
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

  it('pins every GitHub-authored action to a repository-approved immutable SHA', () => {
    expect(workflow).toContain('actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09');
    expect(workflow).toContain('actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444');
    expect(workflow).toContain('actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f');
    expect(workflow).not.toMatch(/uses:\s+actions\/[\w-]+@v\d+/);
  });

  it('revalidates authority before credentials and uploads only the sanitized manifest', () => {
    const reattest = workflow.indexOf('Revalidate authority immediately before protected credentials');
    const provision = workflow.indexOf('Provision and verify persistent synthetic QA personas');
    expect(reattest).toBeGreaterThan(-1);
    expect(provision).toBeGreaterThan(reattest);
    const revalidationStep = workflow.slice(reattest, provision);
    expect(revalidationStep).toContain(
      'mainRef.object?.sha !== process.env.EXPECTED_SHA',
    );
    expect(revalidationStep).toContain(
      'process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER',
    );
    expect(revalidationStep).toContain(
      "check.head_sha === process.env.EXPECTED_SHA",
    );
    expect(revalidationStep).toContain('maintainers.length !== 1');
    expect(workflow).toContain('QA_PERSONA_MANIFEST_PATH: artifacts/win-43/qa-persona-manifest.json');
    expect(workflow).toContain('retention-days: 7');
  });
});
