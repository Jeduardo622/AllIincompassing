# Git Branch Hygiene

This repo carries a large amount of historical branch residue. Pulling every remote-only branch into local does not improve safety, so branch hygiene here is intentionally scoped to a checked-in allowlist of local cleanup targets.

## Policy

- Keep `main` synced with `origin/main`.
- Ignore remote-only branches unless you explicitly plan to work on them.
- Review only the branches listed in `docs/branch-hygiene-targets.json`.
- Prioritize tracked branches with drift before low-value local branch cleanup.

## Run The Audit

```bash
npm run git:branch:audit
```

The command is report-only. It does not fetch, pull, push, prune, reset, or delete branches.

## Target File Format

`docs/branch-hygiene-targets.json` must stay a JSON array of branch records:

```json
[
  {
    "name": "backup/pre-purge-main",
    "note": "Optional operator context"
  }
]
```

- `name` is required.
- `note` is optional.

Update the file when the set of branches you care about changes. Removing a branch from the file removes it from future audit output without touching git state.

## Status Meanings

- `local-only-needs-decision`: branch exists locally with no upstream. Decide whether it is a backup worth keeping, work that should be pushed, or stale work to delete.
- `tracked-behind`: local branch is behind remote. Reconcile it first if you still care about it.
- `tracked-ahead`: local branch has unpublished commits. Review whether those commits should be pushed.
- `tracked-diverged`: local and remote both have unique history. Review before choosing merge, rebase, cherry-pick, or deletion.
- `tracked-in-sync`: local branch matches upstream. If it is already merged into `main`, it is usually a deletion candidate.
- `missing-locally`: branch is still listed in the target file but no longer exists locally.

## Manual Follow-Up

Use the audit output to drive manual branch cleanup:

1. Resolve drifted tracked branches first.
2. Review the local-only branches and decide whether to keep, push, or delete them.
3. Remove stale entries from `docs/branch-hygiene-targets.json` after the branch is no longer part of the cleanup queue.

The initial target file reflects the March 22, 2026 cleanup focus and is expected to evolve as the local branch set changes.
