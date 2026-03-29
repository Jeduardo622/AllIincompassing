# PR Merge Queue Settings

Use this document to distinguish the current live merge contract on `main` from optional future merge-queue recommendations.

## Current Live `main` Contract

As of 2026-03-29, the live branch-protection contract on `main` is:

- required status checks:
  - `policy`
  - `lint-typecheck`
  - `unit-tests`
  - `build`
  - `tier0-browser`
  - `auth-browser-smoke`
- branch-up-to-date requirement: enabled (`strict=true`)
- required pull-request approvals configured in GitHub: `1`

Interpretation notes:

- `tenant-safety` is a path-scoped workflow signal for protected-path slices. It is not a globally required merge check.
- `Supabase Validate` is a migration-scoped workflow signal. It is not a globally required merge check.
- `Lighthouse CI`, Netlify preview contexts, `Pages changed`, and `Supabase Preview` are visible but non-blocking.
- local Playwright failures are advisory when CI-authoritative browser checks (`tier0-browser`, `auth-browser-smoke`) pass.

## Recommended GitHub Settings

For branch `main` (and `develop` when that branch is actively protected):

1. Enable branch protection.
2. Enable "Require a pull request before merging".
3. Enable "Require status checks to pass before merging".
4. Enable "Require branches to be up to date before merging".
5. Enable "Require merge queue".
6. Enable "Auto-merge".
7. Keep "Include administrators" enabled (so admin-authored/admin-merged changes still respect the same protection rules).

## Why This Combination

- "Require branches to be up to date" protects against stale merges.
- Merge queue removes manual update/rebase loops.
- Auto-merge and queue let approved PRs merge once checks pass in queue order.

## Docs-Only Fast Path Scope

The fast path applies only to markdown/governance documentation paths (for example `docs/**/*.md`, `reports/**/*.md`, top-level `README*.md`, `AGENTS.md`, and skill `SKILL.md` files under `.agents/skills/**` and `.cursor/skills/**`). Non-markdown files under docs/reports still take the full CI path.

## Required Checks Guidance

Today, GitHub branch protection on `main` is enforced through the six global checks listed above. Treat those six checks as the merge-blocking source of truth until a separate supervised policy change intentionally replaces them.

Internal workflow behavior still matters:

- `docs-guard` is the docs-only fast-path validator.
- `ci-gate` summarizes CI lane outcomes and remains useful operator signal.
- docs-only PRs currently satisfy the six required checks by resolving them to `SKIPPED`, while `docs-guard` and `ci-gate` pass.

Do not describe `ci-gate` as the current required branch-protection target unless live GitHub settings and CI policy have been updated together in the same rollout.

## Merge Queue Compatibility

`CI` now listens to `pull_request`, `push`, and `merge_group` events so merge-queue runs enforce the same required gate (`ci-gate`) as normal PRs.

Note: docs-only PRs run the docs fast path on standard PR events, but merge-queue (`merge_group`) currently uses the full non-doc chain before `ci-gate`.
Note: `auth-browser-smoke` allows a non-fatal secret-missing skip on `pull_request`, but treats missing secrets as a failure on `merge_group`/`push`; do not treat PR soft-skip behavior as merge-queue parity.

## Approval Validation Result

Disposable probe PR [#311](https://github.com/Jeduardo622/AllIincompassing/pull/311) was created from a docs-only branch and intentionally left unapproved. After checks settled, GitHub reported:

- `latestReviews: []`
- `reviewDecision: ""`
- `mergeStateStatus: "CLEAN"`
- `mergeable: "MERGEABLE"`

Current platform truth for this single-owner repository:

- the configured approval requirement (`required_approving_review_count=1`) is not an effective merge blocker for the repo owner in this repo shape
- protected-path human review remains a repository process requirement, not a reliably GitHub-enforced gate today

If reviewer topology changes later, re-run this validation before describing approvals as a real enforcement boundary.
