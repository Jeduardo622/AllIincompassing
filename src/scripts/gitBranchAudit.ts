import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type BranchAuditStatus =
  | 'local-only-needs-decision'
  | 'tracked-behind'
  | 'tracked-ahead'
  | 'tracked-diverged'
  | 'tracked-in-sync'
  | 'missing-locally';

export type BranchAuditTarget = {
  name: string;
  note?: string;
};

export type BranchRefInfo = {
  name: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommitSha: string;
  lastCommitSubject: string;
};

export type BranchAuditResult = {
  name: string;
  note?: string;
  status: BranchAuditStatus;
  upstream: string | null;
  ahead: number;
  behind: number;
  mergedIntoMain: boolean | null;
  lastCommitSha: string | null;
  lastCommitSubject: string | null;
  recommendedNextStep: string;
};

export type MainBranchStatus = {
  name: 'main';
  upstream: string | null;
  ahead: number;
  behind: number;
  inSyncWithUpstream: boolean;
  statusText: string;
};

export type BranchAuditReport = {
  generatedAt: string;
  targetFile: string;
  mainStatus: MainBranchStatus;
  results: BranchAuditResult[];
};

export type GitRunner = (args: string[], cwd: string) => string;

const REF_FORMAT = '%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname:short)|%(contents:subject)';

export function defaultGitRunner(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function parseBranchTargets(raw: string): BranchAuditTarget[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Branch target file must contain a JSON array.');
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Branch target at index ${index} must be an object.`);
    }

    const { name, note } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Branch target at index ${index} is missing a non-empty "name" field.`);
    }

    if (note !== undefined && typeof note !== 'string') {
      throw new Error(`Branch target "${name}" has a non-string "note" field.`);
    }

    return {
      name: name.trim(),
      note,
    };
  });
}

function parseTrackDetail(trackDetail: string): { ahead: number; behind: number } {
  let ahead = 0;
  let behind = 0;

  const normalized = trackDetail.trim();
  if (!normalized || normalized === '[gone]') {
    return { ahead, behind };
  }

  const aheadMatch = normalized.match(/ahead (\d+)/i);
  const behindMatch = normalized.match(/behind (\d+)/i);

  if (aheadMatch) {
    ahead = Number.parseInt(aheadMatch[1], 10);
  }
  if (behindMatch) {
    behind = Number.parseInt(behindMatch[1], 10);
  }

  return { ahead, behind };
}

export function parseRefLine(line: string): BranchRefInfo {
  const [name, upstreamRaw, trackDetailRaw, lastCommitShaRaw, ...subjectParts] = line.split('|');
  const upstream = upstreamRaw?.trim() ? upstreamRaw.trim() : null;
  const trackDetail = trackDetailRaw?.trim() ?? '';
  const { ahead, behind } = parseTrackDetail(trackDetail);

  return {
    name: name.trim(),
    upstream,
    ahead,
    behind,
    lastCommitSha: lastCommitShaRaw?.trim() ?? '',
    lastCommitSubject: subjectParts.join('|').trim(),
  };
}

export function parseRefList(raw: string): Map<string, BranchRefInfo> {
  const refs = new Map<string, BranchRefInfo>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const ref = parseRefLine(trimmed);
    refs.set(ref.name, ref);
  }
  return refs;
}

export function resolveBranchStatus(ref: BranchRefInfo | null): BranchAuditStatus {
  if (!ref) {
    return 'missing-locally';
  }
  if (!ref.upstream) {
    return 'local-only-needs-decision';
  }
  if (ref.ahead > 0 && ref.behind > 0) {
    return 'tracked-diverged';
  }
  if (ref.behind > 0) {
    return 'tracked-behind';
  }
  if (ref.ahead > 0) {
    return 'tracked-ahead';
  }
  return 'tracked-in-sync';
}

export function getRecommendedNextStep(status: BranchAuditStatus, mergedIntoMain: boolean | null): string {
  switch (status) {
    case 'missing-locally':
      return 'Branch is listed in the audit target file but missing locally. Remove it from the allowlist if no longer relevant, or recreate it locally if you still plan to inspect it.';
    case 'local-only-needs-decision':
      if (mergedIntoMain) {
        return 'No upstream is configured and the branch is already merged into main. Delete it locally unless it is an intentional backup branch.';
      }
      return 'No upstream is configured. Decide whether to keep it as a backup, push it to origin, or delete it locally if the work is stale.';
    case 'tracked-behind':
      return 'Local branch is behind its upstream. If the branch still matters, reconcile it by fast-forwarding or resetting to the remote tip before doing other cleanup.';
    case 'tracked-ahead':
      return 'Local branch is ahead of its upstream. Review the unpublished local commits and either push them intentionally or delete the branch if the work is obsolete.';
    case 'tracked-diverged':
      return 'Local and remote history diverged. Review local-only commits and newer remote commits before deciding whether to merge, rebase, cherry-pick, or delete the local branch.';
    case 'tracked-in-sync':
      if (mergedIntoMain) {
        return 'Branch matches its upstream and is already merged into main. It is a safe candidate for local deletion if no longer needed.';
      }
      return 'Branch matches its upstream. Leave it alone unless you explicitly plan to resume work on it.';
  }
}

export function formatTrackState(ahead: number, behind: number): string {
  if (ahead === 0 && behind === 0) {
    return 'in sync';
  }
  if (ahead > 0 && behind > 0) {
    return `ahead ${ahead}, behind ${behind}`;
  }
  if (ahead > 0) {
    return `ahead ${ahead}`;
  }
  return `behind ${behind}`;
}

export function buildMainBranchStatus(mainRef: BranchRefInfo | null): MainBranchStatus {
  if (!mainRef) {
    return {
      name: 'main',
      upstream: null,
      ahead: 0,
      behind: 0,
      inSyncWithUpstream: false,
      statusText: 'main is missing locally, so branch hygiene cannot be assessed safely.',
    };
  }

  const inSyncWithUpstream = Boolean(mainRef.upstream) && mainRef.ahead === 0 && mainRef.behind === 0;
  const upstreamLabel = mainRef.upstream ?? 'no upstream configured';
  const statusText = inSyncWithUpstream
    ? `main is in sync with ${upstreamLabel}.`
    : `main is ${formatTrackState(mainRef.ahead, mainRef.behind)} relative to ${upstreamLabel}.`;

  return {
    name: 'main',
    upstream: mainRef.upstream,
    ahead: mainRef.ahead,
    behind: mainRef.behind,
    inSyncWithUpstream,
    statusText,
  };
}

export function auditTargets(
  targets: BranchAuditTarget[],
  refs: Map<string, BranchRefInfo>,
  mergedBranches: Set<string>,
): BranchAuditResult[] {
  return targets.map((target) => {
    const ref = refs.get(target.name) ?? null;
    const mergedIntoMain = ref ? mergedBranches.has(target.name) : null;
    const status = resolveBranchStatus(ref);

    return {
      name: target.name,
      note: target.note,
      status,
      upstream: ref?.upstream ?? null,
      ahead: ref?.ahead ?? 0,
      behind: ref?.behind ?? 0,
      mergedIntoMain,
      lastCommitSha: ref?.lastCommitSha ?? null,
      lastCommitSubject: ref?.lastCommitSubject ?? null,
      recommendedNextStep: getRecommendedNextStep(status, mergedIntoMain),
    };
  });
}

export function readBranchTargets(targetFile: string): BranchAuditTarget[] {
  return parseBranchTargets(readFileSync(targetFile, 'utf8'));
}

export function generateBranchAuditReport(
  repoRoot: string,
  targetFile: string,
  gitRunner: GitRunner = defaultGitRunner,
): BranchAuditReport {
  const refs = parseRefList(gitRunner(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads'], repoRoot));
  const mergedBranches = new Set(
    gitRunner(['branch', '--format=%(refname:short)', '--merged', 'main'], repoRoot)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean),
  );
  const targets = readBranchTargets(targetFile);

  return {
    generatedAt: new Date().toISOString(),
    targetFile: path.relative(repoRoot, targetFile).replace(/\\/g, '/'),
    mainStatus: buildMainBranchStatus(refs.get('main') ?? null),
    results: auditTargets(targets, refs, mergedBranches),
  };
}

function formatMergedState(mergedIntoMain: boolean | null): string {
  if (mergedIntoMain === null) {
    return 'n/a';
  }
  return mergedIntoMain ? 'yes' : 'no';
}

export function formatBranchAuditReport(report: BranchAuditReport): string {
  const lines: string[] = [];

  lines.push('Git Branch Hygiene Audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Target file: ${report.targetFile}`);
  lines.push('');
  lines.push('Policy');
  lines.push('- main is informational and should stay synced with origin/main');
  lines.push('- remote-only branches are ignored by this audit');
  lines.push('- only explicitly allowlisted branches are reviewed');
  lines.push('- drifted tracked branches should be reconciled before low-value cleanup');
  lines.push('');
  lines.push('Main');
  lines.push(`- ${report.mainStatus.statusText}`);
  lines.push('');
  lines.push('Targets');

  for (const result of report.results) {
    lines.push(`- ${result.name}`);
    lines.push(`  status: ${result.status}`);
    lines.push(`  upstream: ${result.upstream ?? 'none'}`);
    lines.push(`  track: ${formatTrackState(result.ahead, result.behind)}`);
    lines.push(`  merged into main: ${formatMergedState(result.mergedIntoMain)}`);
    lines.push(`  last commit: ${result.lastCommitSha ?? 'n/a'} ${result.lastCommitSubject ?? ''}`.trimEnd());
    if (result.note) {
      lines.push(`  note: ${result.note}`);
    }
    lines.push(`  next step: ${result.recommendedNextStep}`);
  }

  return lines.join('\n');
}
