import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  path.resolve(process.cwd(), '.github/workflows/rotate-qa-persona-credentials.yaml'),
  'utf8',
);

const attestationPath = path.resolve(
  process.cwd(),
  'docs/ai/reviews/WIN-43-qa-persona-credential-rotation-attestation.json',
);

const protectedSurfaces = [
  '.github/workflows/rotate-qa-persona-credentials.yaml',
  'scripts/provision-persistent-qa-personas.ts',
  'scripts/rotate-persistent-qa-persona-credentials.ts',
  'tests/scripts/provision-persistent-qa-personas.test.ts',
  'tests/scripts/rotate-persistent-qa-persona-credentials.test.ts',
  'tests/workflows/rotate-qa-persona-credentials.test.ts',
  'AGENTS.md',
  '.agents/skills/route-task/SKILL.md',
  'docs/ai/cto-lane-contract.md',
  'docs/ai/high-risk-paths.md',
  'docs/ai/WIN-43-persistent-qa-personas-handoff.md',
] as const;

const normalizedSha256 = (surface: string): string => createHash('sha256')
  .update(readFileSync(path.resolve(process.cwd(), surface), 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');

describe('persistent QA persona credential rotation workflow', () => {
  it('is owner-only, main-only, issue-bound, exact-head-CI-bound, and sole-maintainer-gated', () => {
    expect(workflow).toContain("github.actor_id == '129695080'");
    expect(workflow).toContain("github.event.repository.owner.type == 'User'");
    expect(workflow).toContain("github.event.repository.owner.id == 129695080");
    expect(workflow).toContain("I_APPROVE_WIN_43_QA_PERSONA_CREDENTIAL_ROTATION");
    expect(workflow).toContain("process.env.GITHUB_REF !== 'refs/heads/main'");
    expect(workflow).toContain("mainRef.object?.sha !== commitSha");
    expect(workflow).toContain("pull.merge_commit_sha !== commitSha");
    expect(workflow).toContain('Approval pull request must reference WIN-43.');
    expect(workflow).toContain('collaborators?affiliation=direct');
    expect(workflow).toContain('maintainers.length !== 1');
    expect(workflow).toContain('/branches/main/protection/required_status_checks');
    expect(workflow).toContain('BRANCH_PROTECTION_READ_TOKEN: ${{ secrets.QA_ROTATION_GITHUB_ADMIN_READ_TOKEN }}');
    expect(workflow).toContain('Authorization: `Bearer ${process.env.BRANCH_PROTECTION_READ_TOKEN}`');
    expect(workflow).toContain('requiredStatusChecks.strict !== true');
    expect(workflow).toContain('requiredStatusChecks.checks ?? []');
    expect(workflow).toContain('check.app?.id === required.appId');
    expect(workflow).not.toContain("const requiredCiChecks = ['policy'");
    expect(workflow).not.toContain('administration: write');
  });

  it('accepts only immutable review inputs and no mutable persona or credential inputs', () => {
    const inputBlock = workflow.slice(workflow.indexOf('inputs:'), workflow.indexOf('permissions:'));
    expect(inputBlock).toContain('commit_sha:');
    expect(inputBlock).toContain('pull_request_number:');
    expect(inputBlock).toContain('approval_acknowledgement:');
    expect(inputBlock).not.toMatch(/organization|persona|role|email|password/i);
  });

  it('requires a dedicated rotation attestation with six PASS specialist keys and the exact protected surface key set', () => {
    expect(workflow).toContain('WIN-43-qa-persona-credential-rotation-attestation.json');
    expect(workflow).toContain('protectedSurfaceHashes');
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
      expect(attestation.protectedSurfaceHashes?.[surface]).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const surface of protectedSurfaces) {
      expect(attestation.protectedSurfaceHashes?.[surface]).toBe(normalizedSha256(surface));
    }
  });

  it('maps bootstrap secrets into the preverify PW contract and rotation secrets into the rotation script and postverify PW contract', () => {
    for (const role of ['BT', 'THERAPIST', 'BCBA', 'MIDTIER', 'ADMIN_SCHEDULE', 'CLIENT', 'ADMIN', 'SUPERADMIN']) {
      expect(workflow).toContain(`secrets.QA_BOOTSTRAP_${role}_EMAIL`);
      expect(workflow).toContain(`secrets.QA_BOOTSTRAP_${role}_PASSWORD`);
      expect(workflow).toContain(`secrets.QA_ROTATION_${role}_EMAIL`);
      expect(workflow).toContain(`secrets.QA_ROTATION_${role}_PASSWORD`);
    }
    expect(workflow).toContain('PW_SCHEDULE_EMAIL: ${{ secrets.QA_BOOTSTRAP_ADMIN_SCHEDULE_EMAIL }}');
    expect(workflow).toContain('PW_SCHEDULE_PASSWORD: ${{ secrets.QA_BOOTSTRAP_ADMIN_SCHEDULE_PASSWORD }}');
    expect(workflow).toContain('PW_SCHEDULE_EMAIL: ${{ secrets.QA_ROTATION_ADMIN_SCHEDULE_EMAIL }}');
    expect(workflow).toContain('PW_SCHEDULE_PASSWORD: ${{ secrets.QA_ROTATION_ADMIN_SCHEDULE_PASSWORD }}');
    expect(workflow).not.toContain('secrets.PW_ADMIN_EMAIL');
    expect(workflow).not.toContain('secrets.PW_SCHEDULE_EMAIL');
    expect(workflow).toContain('npx tsx scripts/provision-persistent-qa-personas.ts --verify');
    expect(workflow).toContain('npx tsx scripts/rotate-persistent-qa-persona-credentials.ts --rotate');
    expect(workflow).toContain('QA_PERSONA_MANIFEST_PATH: artifacts/win-43/qa-persona-preverify-manifest.json');
    expect(workflow).toContain('QA_PERSONA_MANIFEST_PATH: artifacts/win-43/qa-persona-rotation-manifest.json');
    expect(workflow).toContain('QA_PERSONA_MANIFEST_PATH: artifacts/win-43/qa-persona-postverify-manifest.json');
  });

  it('pins approved action SHAs and uploads the three sanitized manifests as one artifact', () => {
    expect(workflow).toContain('actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09');
    expect(workflow).toContain('actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444');
    expect(workflow).toContain('actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f');
    expect(workflow).not.toMatch(/uses:\s+actions\/[\w-]+@v\d+/);
    expect(workflow).toContain('name: win-43-qa-persona-rotation-manifests');
    expect(workflow).toContain('artifacts/win-43/qa-persona-preverify-manifest.json');
    expect(workflow).toContain('artifacts/win-43/qa-persona-rotation-manifest.json');
    expect(workflow).toContain('artifacts/win-43/qa-persona-postverify-manifest.json');
    expect(workflow).not.toContain('gh secret set');
    expect(workflow).not.toContain('actions: write');
    expect(workflow).not.toContain('contents: write');
  });

  it('revalidates authority before secrets and does not encode a delegated Codex dispatch path', () => {
    const reattest = workflow.indexOf('Revalidate authority immediately before protected credentials');
    const preverify = workflow.indexOf('Preverify current bootstrap credentials and tenant graph');
    expect(reattest).toBeGreaterThan(-1);
    expect(preverify).toBeGreaterThan(reattest);

    const revalidationStep = workflow.slice(reattest, preverify);
    expect(revalidationStep).toContain('mainRef.object?.sha !== process.env.EXPECTED_SHA');
    expect(revalidationStep).toContain('process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER');
    expect(revalidationStep).toContain("check.head_sha === process.env.EXPECTED_SHA");
    expect(revalidationStep).toContain('maintainers.length !== 1');

    expect(workflow).not.toContain('Delegated browser dispatch allowlist');
    expect(workflow).not.toContain('qa-persona-delegated-browser-dispatch-attestation');
  });
});
