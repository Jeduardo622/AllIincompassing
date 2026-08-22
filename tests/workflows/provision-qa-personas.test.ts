import { createHash, randomUUID } from 'node:crypto';
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
  'scripts/playwright-qa-persona-readiness.ts',
  'scripts/lib/playwright-smoke.ts',
  'tests/scripts/provision-persistent-qa-personas.test.ts',
  'tests/scripts/playwright-qa-persona-readiness.test.ts',
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

const requiredCiChecks = [
  'policy',
  'lint-typecheck',
  'unit-tests',
  'build',
  'tier0-browser',
  'auth-browser-smoke',
  'ci-gate',
];
const docsOnlyCiChecks = ['change-scope', 'docs-guard', 'ci-gate'];

const extractCiHelper = () => {
  const marker = 'cat > "${CI_HELPER_PATH}" <<\'EOF\'';
  const markerIndex = workflow.indexOf(marker);
  const start = workflow.indexOf('\n', markerIndex) + 1;
  const end = workflow.indexOf('\n          EOF', start);
  expect(markerIndex).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end).replace(/^          /gm, '');
};

const loadCiResolver = async () => {
  const source = Buffer.from(extractCiHelper()).toString('base64');
  return import(`data:text/javascript;base64,${source}#${randomUUID()}`) as Promise<{
    resolveRequiredCiEvidence: (
      repository: string,
      startingSha: string,
    ) => Promise<{ resolvedCiSha: string; runId: number }>;
  }>;
};

const successfulJobs = (names: string[]) =>
  names.map((name) => ({ name, status: 'completed', conclusion: 'success' }));

const installGitHubFetch = ({
  runsBySha,
  jobsByRun,
  commitsBySha = {},
}: {
  runsBySha: Record<string, Array<Record<string, unknown>>>;
  jobsByRun: Record<string, Array<Record<string, unknown>>>;
  commitsBySha?: Record<string, Record<string, unknown>>;
}) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    let payload: unknown;
    if (url.endsWith('/branches/main/protection/required_status_checks')) {
      payload = {
        checks: requiredCiChecks.map((context) => ({ context, app_id: 15368 })),
      };
    } else if (url.includes('/actions/workflows/ci.yml/runs?')) {
      const sha = new URL(url).searchParams.get('head_sha');
      if (!sha) throw new Error('CI workflow run query must include head_sha.');
      payload = { workflow_runs: runsBySha[sha] ?? [] };
    } else if (url.includes('/actions/runs/')) {
      const runId = url.match(/\/actions\/runs\/(\d+)\/jobs/)?.[1];
      payload = { jobs: jobsByRun[String(runId)] ?? [] };
    } else if (url.includes('/commits/')) {
      const sha = url.match(/\/commits\/([0-9a-f]{40})/)?.[1];
      payload = commitsBySha[String(sha)];
    }
    if (!payload) throw new Error(`Unexpected GitHub API request: ${url}`);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => payload,
    } as Response;
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
};

const ciRun = (id: number, sha: string, conclusion = 'success') => ({
  id,
  head_sha: sha,
  event: 'push',
  head_branch: 'main',
  status: 'completed',
  conclusion,
});

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

  it('resolves required CI from a unique push run across only bounded docs-only commits', () => {
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('checks: read');
    expect(workflow).toContain(
      "const requiredCiChecks = ['policy', 'lint-typecheck', 'unit-tests', 'build', 'tier0-browser', 'auth-browser-smoke', 'ci-gate'];",
    );
    expect(workflow).toContain(
      "const docsOnlyCiChecks = ['change-scope', 'docs-guard', 'ci-gate'];",
    );
    expect(workflow).toContain('const maxDocsOnlyCommits = 10;');
    expect(workflow).toContain('/actions/workflows/ci.yml/runs?');
    expect(workflow).toContain('event=push');
    expect(workflow).toContain('branch=main');
    expect(workflow).toContain('/actions/runs/${run.id}/jobs?');
    expect(workflow).not.toContain('/branches/main/protection/required_status_checks');
    expect(workflow).not.toContain('QA_ROTATION_GITHUB_ADMIN_READ_TOKEN');
    expect(workflow).toContain('commit.parents?.length !== 1');
    expect(workflow).toContain('docs-only CI evidence');
    expect(workflow).toContain('docs-only ancestry exceeded the fail-closed limit');
    expect(workflow).toContain(
      '/^(docs\\/.*\\.md|reports\\/.*\\.md|README.*\\.md|AGENTS\\.md|\\.agents\\/skills\\/.*\\/SKILL\\.md|\\.cursor\\/skills\\/.*\\/SKILL\\.md)$/',
    );
    expect(workflow.match(/resolveRequiredCiEvidence\(/g)).toHaveLength(3);
  });

  it('accepts a unique successful exact-main CI push run', async () => {
    const sha = 'a'.repeat(40);
    const restoreFetch = installGitHubFetch({
      runsBySha: { [sha]: [ciRun(1, sha)] },
      jobsByRun: { '1': successfulJobs(requiredCiChecks) },
    });
    try {
      const { resolveRequiredCiEvidence } = await loadCiResolver();
      await expect(resolveRequiredCiEvidence('owner/repo', sha)).resolves.toEqual({
        resolvedCiSha: sha,
        runId: 1,
      });
    } finally {
      restoreFetch();
    }
  });

  it('accepts the nearest full-CI ancestor across a two-commit docs-only chain', async () => {
    const currentSha = 'a'.repeat(40);
    const parentSha = 'b'.repeat(40);
    const codeSha = 'c'.repeat(40);
    const restoreFetch = installGitHubFetch({
      runsBySha: {
        [currentSha]: [ciRun(1, currentSha)],
        [parentSha]: [ciRun(2, parentSha)],
        [codeSha]: [ciRun(3, codeSha)],
      },
      jobsByRun: {
        '1': successfulJobs(docsOnlyCiChecks),
        '2': successfulJobs(docsOnlyCiChecks),
        '3': successfulJobs(requiredCiChecks),
      },
      commitsBySha: {
        [currentSha]: {
          sha: currentSha,
          parents: [{ sha: parentSha }],
          files: [{ filename: 'docs/ai/current.md' }],
        },
        [parentSha]: {
          sha: parentSha,
          parents: [{ sha: codeSha }],
          files: [{ filename: 'reports/prior.md' }],
        },
      },
    });
    try {
      const { resolveRequiredCiEvidence } = await loadCiResolver();
      await expect(
        resolveRequiredCiEvidence('owner/repo', currentSha),
      ).resolves.toEqual({ resolvedCiSha: codeSha, runId: 3 });
    } finally {
      restoreFetch();
    }
  });

  it('rejects a non-doc commit before a full-CI ancestor', async () => {
    const currentSha = 'a'.repeat(40);
    const parentSha = 'b'.repeat(40);
    const restoreFetch = installGitHubFetch({
      runsBySha: { [currentSha]: [ciRun(1, currentSha)] },
      jobsByRun: { '1': successfulJobs(docsOnlyCiChecks) },
      commitsBySha: {
        [currentSha]: {
          sha: currentSha,
          parents: [{ sha: parentSha }],
          files: [{ filename: 'src/auth.ts' }],
        },
      },
    });
    try {
      const { resolveRequiredCiEvidence } = await loadCiResolver();
      await expect(resolveRequiredCiEvidence('owner/repo', currentSha)).rejects.toThrow(
        'is not docs-only by the exact ci.yml allowlist',
      );
    } finally {
      restoreFetch();
    }
  });

  it('rejects a production file renamed into the docs-only allowlist', async () => {
    const currentSha = 'a'.repeat(40);
    const parentSha = 'b'.repeat(40);
    const restoreFetch = installGitHubFetch({
      runsBySha: { [currentSha]: [ciRun(1, currentSha)] },
      jobsByRun: { '1': successfulJobs(docsOnlyCiChecks) },
      commitsBySha: {
        [currentSha]: {
          sha: currentSha,
          parents: [{ sha: parentSha }],
          files: [{ filename: 'docs/example.md', previous_filename: 'src/example.ts' }],
        },
      },
    });
    try {
      const { resolveRequiredCiEvidence } = await loadCiResolver();
      await expect(resolveRequiredCiEvidence('owner/repo', currentSha)).rejects.toThrow(
        'is not docs-only by the exact ci.yml allowlist: src/example.ts',
      );
    } finally {
      restoreFetch();
    }
  });

  it('rejects ambiguous exact-SHA CI runs even when one older run passed', async () => {
    const sha = 'a'.repeat(40);
    const restoreFetch = installGitHubFetch({
      runsBySha: { [sha]: [ciRun(1, sha), ciRun(2, sha, 'failure')] },
      jobsByRun: { '1': successfulJobs(requiredCiChecks) },
    });
    try {
      const { resolveRequiredCiEvidence } = await loadCiResolver();
      await expect(resolveRequiredCiEvidence('owner/repo', sha)).rejects.toThrow(
        'Ambiguous CI workflow runs',
      );
    } finally {
      restoreFetch();
    }
  });

  it('rejects a docs-only commit whose docs guard did not pass', async () => {
    const currentSha = 'a'.repeat(40);
    const parentSha = 'b'.repeat(40);
    const restoreFetch = installGitHubFetch({
      runsBySha: { [currentSha]: [ciRun(1, currentSha)] },
      jobsByRun: { '1': successfulJobs(['change-scope', 'ci-gate']) },
      commitsBySha: {
        [currentSha]: {
          sha: currentSha,
          parents: [{ sha: parentSha }],
          files: [{ filename: 'docs/ai/current.md' }],
        },
      },
    });
    try {
      const { resolveRequiredCiEvidence } = await loadCiResolver();
      await expect(resolveRequiredCiEvidence('owner/repo', currentSha)).rejects.toThrow(
        'docs-only CI evidence is missing',
      );
    } finally {
      restoreFetch();
    }
  });

  it('rejects ancestry that exceeds ten docs-only commits', async () => {
    const shas = '123456789abc'.split('').map((value) => value.repeat(40));
    const runsBySha = Object.fromEntries(
      shas.slice(0, 11).map((sha, index) => [sha, [ciRun(index + 1, sha)]]),
    );
    const jobsByRun = Object.fromEntries(
      shas.slice(0, 11).map((_, index) => [String(index + 1), successfulJobs(docsOnlyCiChecks)]),
    );
    const commitsBySha = Object.fromEntries(
      shas.slice(0, 10).map((sha, index) => [
        sha,
        {
          sha,
          parents: [{ sha: shas[index + 1] }],
          files: [{ filename: `docs/ai/${index}.md` }],
        },
      ]),
    );
    const restoreFetch = installGitHubFetch({ runsBySha, jobsByRun, commitsBySha });
    try {
      const { resolveRequiredCiEvidence } = await loadCiResolver();
      await expect(resolveRequiredCiEvidence('owner/repo', shas[0])).rejects.toThrow(
        'docs-only ancestry exceeded the fail-closed limit',
      );
    } finally {
      restoreFetch();
    }
  });

  it('requires solo-maintainer topology and hash-bound reviews', () => {
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
      invariants?: Record<string, boolean>;
      protectedSurfaceHashes?: Record<string, string>;
    };

    expect(attestation).toMatchObject({
      schemaVersion: 1,
      issue: 'WIN-43',
      reviewMode: 'solo-maintainer-owner-attestation',
      repository: 'Jeduardo622/AllIincompassing',
      invariants: {
        ownerSessionDispatchChannels: true,
        purposeBuiltConnectorFailClosed: true,
        directCliRawApiTokenDispatchForbidden: true,
        singleConsumedDispatchSubmission: true,
      },
    });
    expect(attestation.invariants).not.toHaveProperty('browserPluginOnly');
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

  it('accepts only immutable review inputs and the two bounded operation choices', () => {
    const inputBlock = workflow.slice(workflow.indexOf('inputs:'), workflow.indexOf('permissions:'));
    expect(inputBlock).toContain('commit_sha:');
    expect(inputBlock).toContain('pull_request_number:');
    expect(inputBlock).toContain('approval_acknowledgement:');
    expect(inputBlock).toContain('operation:');
    expect(inputBlock).toContain('default: verify-readiness');
    expect(inputBlock).toContain('- verify-readiness');
    expect(inputBlock).toContain('- provision-empty-namespace');
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
      'resolveRequiredCiEvidence(process.env.REPOSITORY, process.env.EXPECTED_SHA)',
    );
    expect(revalidationStep).toContain(
      'resolvedCiSha !== process.env.EXPECTED_CI_SHA',
    );
    expect(revalidationStep).toContain('maintainers.length !== 1');
    expect(workflow).toContain('QA_PERSONA_MANIFEST_PATH: artifacts/win-43/qa-persona-manifest.json');
    expect(workflow).toContain('retention-days: 7');
  });

  it('keeps readiness inside the existing protected dispatch and exports no auth identifiers', () => {
    expect(workflow).toContain('timeout-minutes: 30');
    expect(workflow).toContain("if: inputs.operation == 'provision-empty-namespace'");
    expect(workflow).toContain("if: inputs.operation == 'verify-readiness'");
    expect(workflow).toContain('npx tsx scripts/provision-persistent-qa-personas.ts --verify');
    expect(workflow).toContain('npx tsx scripts/playwright-qa-persona-readiness.ts');
    expect(workflow).toContain('QA_PERSONA_MANIFEST_PATH: ${{ runner.temp }}/qa-persona-preverify-manifest.json');
    expect(workflow).toContain('artifacts/win-43/qa-persona-readiness-manifest.json');
    expect(workflow).not.toContain('artifacts/win-43/qa-persona-preverify-manifest.json');
    expect(workflow).toContain('if-no-files-found: warn');
    expect(workflow).not.toContain('.png');
  });
});
