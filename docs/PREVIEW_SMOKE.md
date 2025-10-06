Preview smoke test

Run a fast check against a Netlify Deploy Preview to ensure the app boots and the Supabase runtime config is wired.
The CI workflow runs this script automatically after the canary build completes.

Usage

1) Provide the preview URL (examples: https://deploy-preview-123--yoursite.netlify.app) via env or flag:

```bash
PREVIEW_URL=https://deploy-preview-123--<yoursite>.netlify.app npm run preview:smoke
# or
npm run preview:smoke --url https://deploy-preview-123--<yoursite>.netlify.app
```

2) What it verifies
- index.html renders and contains the root div
- /api/runtime-config returns 200 JSON with supabaseUrl and supabaseAnonKey

3) CI integration & debugging
- `.github/workflows/ci.yml` runs `node scripts/preview-smoke.js --url "$PREVIEW_URL"` whenever a deploy-preview URL is exposed by Netlify. Missing preview URLs skip the check.
- The job fails on non-200 responses or missing runtime-config keys; rerun the same command locally with the URL surfaced in the workflow logs to debug.
- Secrets printed by the script remain masked (anon keys are redacted), so it is safe to copy relevant output into incident reports.

Exit codes
- 0 = pass
- 1 = fail (details logged)

Notes
- Credentials are not logged; anon key is masked.
- Extend this script to add login or data checks if needed.


