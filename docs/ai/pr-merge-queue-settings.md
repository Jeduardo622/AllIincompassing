# PR Merge Queue Settings

Use these repository settings to reduce "Update branch" churn while keeping branch protection strict.

## Recommended GitHub Settings

For branch `main`:

1. Enable branch protection.
2. Enable "Require a pull request before merging".
3. Enable "Require status checks to pass before merging".
4. Enable "Require branches to be up to date before merging".
5. Enable "Require merge queue".
6. Enable "Auto-merge".
7. Keep "Include administrators" enabled.

## Why This Combination

- "Require branches to be up to date" protects against stale merges.
- Merge queue removes manual update/rebase loops.
- Auto-merge and queue let approved PRs merge once checks pass in queue order.

## Docs-Only Fast Path Scope

The fast path applies only to markdown/governance documentation paths (for example `docs/**/*.md`, `reports/**/*.md`, top-level `README*.md`, `AGENTS.md`, and skill `SKILL.md` files). Non-markdown files under docs/reports still take the full CI path.

## Required Checks Guidance

Preferred required check:

- `ci-gate`

Optional:

- `docs-guard` (docs-only fast-path gate)

Why:

- `ci-gate` always runs and evaluates the correct path:
  - docs-only changes require `docs-guard`
  - non-doc changes require the full heavy job chain
- This avoids brittle branch-protection behavior around skipped checks.

Legacy (transitional only): if your branch protection still requires individual checks (`policy`, `lint-typecheck`, `unit-tests`, `build`, `tier0-browser`, `auth-browser-smoke`), migrate to `ci-gate` in one update window and validate with a test PR before enforcing.

## Merge Queue Compatibility

`CI` now listens to `pull_request`, `push`, and `merge_group` events so merge-queue runs execute the same checks model as normal PRs.
