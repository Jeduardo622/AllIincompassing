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

## Required Checks Guidance

Keep required checks aligned with the CI workflow job names:

- `policy`
- `lint-typecheck`
- `unit-tests`
- `build`
- `tier0-browser`
- `auth-browser-smoke`

Optional:

- `docs-guard` (docs-only fast-path gate)

If you add `docs-guard` as required, validate branch protection behavior in a test PR first, since docs-only and non-doc flows intentionally use skipped jobs differently.

## Merge Queue Compatibility

`CI` now listens to `pull_request`, `push`, and `merge_group` events so merge-queue runs execute the same checks model as normal PRs.
