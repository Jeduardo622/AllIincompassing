# Policy Job Branch-Protection Baseline

## Incident snapshot

- Workflow: `CI`
- Failed run: `23278553004`
- Failed step: `policy` -> `npm run ci:check-focused`
- Error: `Branch main is not protected. Enable branch protection and required checks before release.`

## Strict contract (release branches)

Policy checks in CI require branch protection and required status checks for:

- `main`
- `develop` (when the branch exists and is activated for release flow)

Required checks:

- `policy`
- `lint-typecheck`
- `unit-tests`
- `build`
- `tier0-browser`
- `auth-browser-smoke`

## Enforcement points

- `scripts/ci/run-policy-checks.mjs` runs governance checks.
- `scripts/ci/check-main-branch-protection.mjs` validates branch protection metadata and required checks.
- `.github/workflows/ci.yml` passes CI policy env contract to the policy step.

## Additional policy failure observed during verification

After branch-protection remediation, `ci:check-focused` surfaced Supabase function auth parity drift for session lifecycle functions (`verify_jwt` mismatches and one missing deployment).

Mitigation applied:

- `.github/workflows/ci.yml` policy job now deploys the session edge bundle on push before running focused policy checks.

## Current baseline (pre-remediation)

- PR run: `23279120975` (`fix/policy-job-strict`, PR `#184`)
  - `policy` failed at `npm run ci:check-focused`
  - `lint-typecheck`, `unit-tests`, `auth-browser-smoke`, `build`, and `tier0-browser` were skipped due to `needs: policy`
- Main push run: `23278553004`
  - `policy` failed with the same Supabase auth parity drift
  - Downstream quality/build/browser jobs were skipped by dependency cascade
- Parallel workflow failure: `lighthouse-ci` run `23279120952`
  - Failed with `Preview URL missing` (no `LIGHTHOUSE_PREVIEW_URL`, inferred URL not reachable)
