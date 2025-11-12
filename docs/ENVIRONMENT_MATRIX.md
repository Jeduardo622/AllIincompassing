# Environment Matrix

The matrix below summarizes how we manage credentials, deployments, and rollback procedures across environments. Use it as the source of truth when rotating secrets or promoting migrations.

| Environment | Git Branch | Hosting Surface | Supabase Project | Auth Keys | Smoke Tests |
|-------------|------------|-----------------|------------------|-----------|-------------|
| Local       | feature/*  | Vite dev server | Preview branches | `.env.local` pulled from 1Password | `npm run test` with `RUN_DB_IT=1` |
| Preview     | Pull request | Netlify deploy previews | Supabase preview branch | GitHub Actions secrets | `npm run preview:smoke` (preview URL) |
| Staging     | `develop`  | Netlify staging context | Dedicated staging project | Netlify staging env vars | GitHub Actions staging job |
| Production  | `main`     | Netlify production | Primary Supabase project | Netlify production env vars | Production post-deploy checks |

## Single-clinic mode configuration

- All environments must define `DEFAULT_ORGANIZATION_ID` (the UUID of the active clinic). The runtime config endpoint exposes this value to the browser, and the edge functions refuse writes for any other organization.
- Do **not** point the application at multiple organization IDs while single-clinic mode is enabled; feature flag overrides and plan assignments are now hard-locked to the configured ID.
- If the value is missing, `/api/dashboard` and feature flag mutations will return `403` because we cannot resolve a safe fallback organization context.

## Staging credential rotation

1. Schedule a weekly rotation window (Monday 10:00 PT) and announce it in `#platform`.
2. From the Supabase staging project, generate new anon and service role keys.
3. Update 1Password entries and mark the previous values as `expired`.
4. Update Netlify staging context variables with the new keys.
5. Redeploy the staging site manually and confirm successful Supabase connection via smoke tests.
6. Notify QA once the rotation completes.

## Rollback steps

### Application rollback

1. In Netlify, open **Deploys** → **Staging**.
2. Promote the last known-good deploy to staging.
3. Create a follow-up task to identify and fix the regression before reattempting deployment.

### Database rollback

1. Open the Supabase staging project → **Database** → **Backups**.
2. Restore the most recent backup taken before the failed deploy.
3. Re-run migrations locally against the restored database to validate the fix.
4. Once fixed, re-promote the `develop` branch following the [migration promotion flow](./supabase_branching.md#migration-promotion-flow-overview).
