Preview smoke test

Run a fast check against a build artefact to ensure the app boots and the Supabase runtime config is wired.
The CI workflow now builds preview assets, serves them locally, and executes the smoke suite automatically after the canary build completes.

Usage

1) Build preview assets and run the local smoke server:

```bash
npm run preview:build
npm run preview:smoke
```

2) Provide a remote preview URL (examples: https://deploy-preview-123--yoursite.netlify.app) via env or flag when validating Netlify builds:

```bash
PREVIEW_URL=https://deploy-preview-123--<yoursite>.netlify.app npm run preview:smoke:remote
# or
npm run preview:smoke:remote -- --url https://deploy-preview-123--<yoursite>.netlify.app
```

3) What it verifies
- index.html renders and contains the root div
- `/api/runtime-config` returns 200 JSON with Supabase URL + anon key
- Supabase `auth/v1/health` responds 200 (auth edge healthy)
- Anonymous Supabase auth flow returns no active session (guardrails intact)

4) CI integration & debugging
- `.github/workflows/ci.yml` runs `npm run preview:build` followed by `npm run preview:smoke` and archives `preview-smoke.log` / `preview-smoke-junit.log` artifacts for downstream reviewers.
- The dedicated `preview` job exposes a local preview URL via job outputs, while the `audit` job enforces the regression checks described in [Production Readiness Runbook §CI/CD Expectations](./PRODUCTION_READINESS_RUNBOOK.md#cicd-expectations).
- The job fails on non-200 responses or missing runtime-config keys; rerun the same command locally with the URL surfaced in the workflow logs (or the attached artifacts) to debug.
- `.github/workflows/ci.yml` runs `npm run preview:build` followed by `npm run preview:smoke`. Deploy preview URLs still trigger `npm run preview:smoke:remote`.
- The job fails on non-200 responses or missing runtime-config keys; rerun the same command locally with the URL surfaced in the workflow logs to debug.
- Secrets printed by the script remain masked (anon keys are redacted), so it is safe to copy relevant output into incident reports.

Exit codes
- 0 = pass
- 1 = fail (details logged)

Notes
- Credentials are not logged; anon key is masked.
- Extend this script to add login or data checks if needed.


