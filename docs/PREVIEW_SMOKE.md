Preview smoke test

Run a fast check against a Netlify Deploy Preview to ensure the app boots and the Supabase runtime config is wired.

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

Exit codes
- 0 = pass
- 1 = fail (details logged)

Notes
- Credentials are not logged; anon key is masked.
- Extend this script to add login or data checks if needed.


