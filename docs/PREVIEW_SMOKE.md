# Preview Smoke Test

Run a fast check against a build artefact to ensure the app boots and the Supabase runtime config is wired.
The CI workflow builds a production bundle (`npm run build`) and runs the tier-0 browser regression gate. Preview smoke commands remain the local/manual baseline for staging and deploy-preview checks.

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
- `.github/workflows/ci.yml` currently runs:
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:check-focused` (includes `check-e2e-reliability-gates`)
- Reliability-first Playwright contract:
  - `npm run playwright:preflight` validates required personas/foreign IDs **and** non-AI session-flow contract requirements (schedule/admin credentials + Supabase runtime keys) before critical Playwright smokes.
  - `npm run ci:playwright` starts with preflight and fails fast with actionable missing-env guidance instead of mid-run browser failures.
  - CI auth/session browser gate now includes both terminal lifecycle modes (`no-show` and `completed`) before blocked-close guidance validation.
- Use local smoke commands to troubleshoot runtime config and Supabase boot:
  - `npm run preview:build && npm run preview:smoke`
  - `npm run preview:smoke:remote -- --url <deploy-preview-url>`
- The smoke command fails on non-200 responses or missing runtime-config keys.
- Secrets printed by the script remain masked (anon keys are redacted), so it is safe to copy relevant output into incident reports.

Exit codes
- 0 = pass
- 1 = fail (details logged)

Notes
- Credentials are not logged; anon key is masked.
- Extend this script to add login or data checks if needed.


