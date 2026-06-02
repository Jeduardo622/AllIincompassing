# PR Merge Queue Settings

Use this document to distinguish the current live merge contract on `main` from optional future merge-queue recommendations.

## Current Live `main` Contract

As of 2026-05-16, the live branch-protection contract on `main` is in the supervised `ci-gate` migration window:

- required status checks:
  - `policy`
  - `lint-typecheck`
  - `unit-tests`
  - `build`
  - `tier0-browser`
  - `auth-browser-smoke`
  - `ci-gate`
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

The intended steady-state branch-protection target is `ci-gate` as the single required CI check. During the supervised migration window, keep the six legacy checks and `ci-gate` required until the CI policy PR that sets `CI_REQUIRED_CHECKS=ci-gate` has merged and `main` is green.

Internal workflow behavior still matters:

- `docs-guard` is the docs-only fast-path validator.
- `ci-gate` summarizes CI lane outcomes and is the required-check target after migration.
- `iehp-assessment-import-smoke` is enforced through `ci-gate` for non-doc runs; keep its fixture and smoke-client values configured as CI secrets.
- docs-only PRs satisfy the browser/code-quality jobs by resolving them to `SKIPPED`, while `docs-guard` and `ci-gate` pass.

Do not remove the six legacy required checks until the non-doc migration PR proves `ci-gate` is gating the full policy, lint/typecheck, unit, build, tier-0 browser, and auth browser smoke chain.

## Merge Queue Compatibility

`CI` now listens to `pull_request`, `push`, and `merge_group` events so merge-queue runs enforce the same required gate (`ci-gate`) as normal PRs.

Note: docs-only PRs run the docs fast path on standard PR events, but merge-queue (`merge_group`) currently uses the full non-doc chain before `ci-gate`.
Note: `auth-browser-smoke` allows a non-fatal secret-missing skip on `pull_request`, but treats missing secrets as a failure on `merge_group`/`push`; do not treat PR soft-skip behavior as merge-queue parity.
Note: `iehp-assessment-import-smoke` fails on missing required smoke secrets for non-doc runs because it is intended to be an enforced import guard, not an advisory browser check.

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
