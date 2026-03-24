# PR Merge Queue Settings

Use these repository settings to reduce "Update branch" churn while keeping branch protection strict.

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

The fast path applies only to markdown/governance documentation paths (for example `docs/**/*.md`, `reports/**/*.md`, top-level `README*.md`, `AGENTS.md`, and skill `SKILL.md` files). Non-markdown files under docs/reports still take the full CI path.

## Required Checks Guidance

Preferred required check:

- `ci-gate`

Do not add as an independent required branch-protection check:

- `docs-guard` (it is a docs-only internal gate enforced by `ci-gate`)

Why:

- `ci-gate` always runs and evaluates the correct path:
  - docs-only changes require `docs-guard`
  - non-doc changes require the full heavy job chain
- This avoids brittle branch-protection behavior around skipped checks.

Legacy (transitional only): if your branch protection still requires individual checks (`policy`, `lint-typecheck`, `unit-tests`, `build`, `tier0-browser`, `auth-browser-smoke`), migrate to `ci-gate` in one update window and validate with a test PR before enforcing.

Until the migration step that updates CI policy expectations (`CI_REQUIRED_CHECKS`) is complete, keep branch-protection and policy changes coordinated in the same rollout window to avoid temporary mismatch.

Migration order requirement:

1. Add `ci-gate` to GitHub branch protection while legacy required checks are still present.
2. Set `CI_REQUIRED_CHECKS=ci-gate` in CI policy enforcement.
3. Validate with a non-doc test PR.
4. Remove legacy required checks from branch protection after the test PR confirms green.

## Merge Queue Compatibility

`CI` now listens to `pull_request`, `push`, and `merge_group` events so merge-queue runs enforce the same required gate (`ci-gate`) as normal PRs.

Note: docs-only PRs run the docs fast path on standard PR events, but merge-queue (`merge_group`) currently uses the full non-doc chain before `ci-gate`.
Note: `auth-browser-smoke` allows a non-fatal secret-missing skip on `pull_request`, but treats missing secrets as a failure on `merge_group`/`push`; do not treat PR soft-skip behavior as merge-queue parity.
