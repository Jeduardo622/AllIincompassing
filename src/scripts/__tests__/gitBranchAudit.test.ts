import { describe, expect, it } from 'vitest';
import {
  auditTargets,
  buildMainBranchStatus,
  formatBranchAuditReport,
  formatTrackState,
  parseBranchTargets,
  parseRefList,
  resolveBranchStatus,
} from '../gitBranchAudit';

describe('parseBranchTargets', () => {
  it('accepts an array of branch records', () => {
    const targets = parseBranchTargets(JSON.stringify([
      { name: 'backup/pre-purge-main', note: 'Keep until main cleanup is validated.' },
      { name: 'codex/pr-hygiene-skill' },
    ]));

    expect(targets).toEqual([
      { name: 'backup/pre-purge-main', note: 'Keep until main cleanup is validated.' },
      { name: 'codex/pr-hygiene-skill', note: undefined },
    ]);
  });

  it('rejects invalid branch records', () => {
    expect(() => parseBranchTargets(JSON.stringify([{ note: 'missing name' }]))).toThrow(/name/i);
  });
});

describe('branch classification', () => {
  const refs = parseRefList([
    'backup/pre-purge-main|||07a003ab|Backup snapshot',
    'codex/disable-add-admin-without-org|origin/codex/disable-add-admin-without-org|[behind 3]|9e3fe007|Disable add-admin CTA without org context',
    'codex/add-verify-change-skill|origin/codex/add-verify-change-skill|[ahead 1]|feda8f36|Add verify-change skill',
    'codex/pr-hygiene-skill|origin/codex/pr-hygiene-skill|[ahead 1, behind 6]|108fb6d1|Add pr-hygiene repo-local skill',
    'codex/cleanup-repo-skill-root|origin/codex/cleanup-repo-skill-root||a7cf200a|Clean up repo-local skill root',
  ].join('\n'));

  it('classifies local-only branches with no upstream', () => {
    expect(resolveBranchStatus(refs.get('backup/pre-purge-main') ?? null)).toBe('local-only-needs-decision');
  });

  it('classifies tracked branches that are behind remote', () => {
    expect(resolveBranchStatus(refs.get('codex/disable-add-admin-without-org') ?? null)).toBe('tracked-behind');
  });

  it('classifies tracked branches that are ahead of remote', () => {
    expect(resolveBranchStatus(refs.get('codex/add-verify-change-skill') ?? null)).toBe('tracked-ahead');
  });

  it('classifies tracked branches that diverged from remote', () => {
    expect(resolveBranchStatus(refs.get('codex/pr-hygiene-skill') ?? null)).toBe('tracked-diverged');
  });

  it('classifies tracked branches that are in sync', () => {
    expect(resolveBranchStatus(refs.get('codex/cleanup-repo-skill-root') ?? null)).toBe('tracked-in-sync');
  });

  it('classifies missing branches from the allowlist', () => {
    expect(resolveBranchStatus(null)).toBe('missing-locally');
  });
});

describe('audit recommendations', () => {
  const refs = parseRefList([
    'backup/pre-purge-main|||07a003ab|Backup snapshot',
    'codex/pr-hygiene-skill|origin/codex/pr-hygiene-skill|[ahead 1, behind 6]|108fb6d1|Add pr-hygiene repo-local skill',
    'codex/cleanup-repo-skill-root|origin/codex/cleanup-repo-skill-root||a7cf200a|Clean up repo-local skill root',
  ].join('\n'));

  const mergedBranches = new Set(['backup/pre-purge-main', 'codex/cleanup-repo-skill-root']);

  it('recommends deleting a merged local-only branch unless it is an intentional backup', () => {
    const [result] = auditTargets([{ name: 'backup/pre-purge-main' }], refs, mergedBranches);

    expect(result.mergedIntoMain).toBe(true);
    expect(result.recommendedNextStep).toMatch(/Delete it locally unless it is an intentional backup branch/i);
  });

  it('recommends manual reconciliation for diverged branches', () => {
    const [result] = auditTargets([{ name: 'codex/pr-hygiene-skill' }], refs, mergedBranches);

    expect(result.status).toBe('tracked-diverged');
    expect(result.recommendedNextStep).toMatch(/merge, rebase, cherry-pick, or delete/i);
  });

  it('recommends local deletion for in-sync branches already merged into main', () => {
    const [result] = auditTargets([{ name: 'codex/cleanup-repo-skill-root' }], refs, mergedBranches);

    expect(result.status).toBe('tracked-in-sync');
    expect(result.recommendedNextStep).toMatch(/safe candidate for local deletion/i);
  });
});

describe('report formatting helpers', () => {
  it('formats track state succinctly', () => {
    expect(formatTrackState(0, 0)).toBe('in sync');
    expect(formatTrackState(1, 0)).toBe('ahead 1');
    expect(formatTrackState(0, 3)).toBe('behind 3');
    expect(formatTrackState(1, 6)).toBe('ahead 1, behind 6');
  });

  it('reports main status as informational sync state', () => {
    const refs = parseRefList('main|origin/main||b5c8b91b|Merge pull request #217');
    const mainStatus = buildMainBranchStatus(refs.get('main') ?? null);

    expect(mainStatus.inSyncWithUpstream).toBe(true);
    expect(mainStatus.statusText).toMatch(/in sync with origin\/main/i);
  });

  it('renders a human-readable audit report', () => {
    const report = {
      generatedAt: '2026-03-22T12:00:00.000Z',
      targetFile: 'docs/branch-hygiene-targets.json',
      mainStatus: {
        name: 'main' as const,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        inSyncWithUpstream: true,
        statusText: 'main is in sync with origin/main.',
      },
      results: auditTargets(
        [{ name: 'codex/pr-hygiene-skill', note: 'Diverged tracked branch.' }],
        parseRefList('codex/pr-hygiene-skill|origin/codex/pr-hygiene-skill|[ahead 1, behind 6]|108fb6d1|Add pr-hygiene repo-local skill'),
        new Set<string>(),
      ),
    };

    const formatted = formatBranchAuditReport(report);

    expect(formatted).toContain('Git Branch Hygiene Audit');
    expect(formatted).toContain('status: tracked-diverged');
    expect(formatted).toContain('note: Diverged tracked branch.');
  });
});
