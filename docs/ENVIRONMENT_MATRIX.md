# Environment Matrix

The matrix below summarizes how we manage credentials, deployments, and rollback procedures across environments. Use it as the source of truth when rotating secrets or promoting migrations.

| Environment | Git Branch | Hosting Surface | Supabase Project | Auth Keys | Smoke Tests |
|-------------|------------|-----------------|------------------|-----------|-------------|
| Local       | feature/*  | Vite dev server | Hosted project `wnnjeqheqxxyrgsjmygy` (single clinic) | `.env.local` from 1Password (anon + service role + DEFAULT_ORGANIZATION_ID) | `npm run test` with `RUN_DB_IT=1` |
| Preview     | Pull request | Netlify deploy previews | Same hosted project (request-scoped clients + tenant safety tooling) | GitHub Actions secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEFAULT_ORGANIZATION_ID`) | `npm run preview:smoke` against the deploy preview URL |
| Staging     | `develop`  | Netlify staging context | Same hosted project (single-tenant) | Netlify staging env vars synced from 1Password | GitHub Actions staging smoke (`preview:smoke:remote`) |
| Production  | `main`     | Netlify production | Same hosted project | Netlify production env vars | Manual post-deploy checks + monitoring |

## Single-clinic mode configuration

- All environments must define `DEFAULT_ORGANIZATION_ID` (the UUID of the active clinic). The runtime config endpoint exposes this value to the browser, and the edge functions refuse writes for any other organization.
- Do **not** point the application at multiple organization IDs while single-clinic mode is enabled; feature flag overrides and plan assignments are now hard-locked to the configured ID.
- If the value is missing, `/api/dashboard` and feature flag mutations will return `403` because we cannot resolve a safe fallback organization context.

## Shared credential rotation (staging + production)

> The app currently uses a **single** hosted Supabase project (wnnjeqheqxxyrgsjmygy) across preview, staging, and production. When we rotate keys, we rotate them everywhere.

1. Schedule a rotation window (Monday 10:00 PT) and announce it in `#platform`.
2. Generate new anon and service-role keys from the Supabase dashboard (`Settings → API`) for the shared project.
3. Update the 1Password vault entries and mark previous values as `expired`.
4. Update Netlify staging + production env vars, GitHub Actions secrets, and `.env.local` templates.
5. Kick off a Netlify redeploy (staging first, then production) and confirm Supabase connectivity via smoke tests.
6. Ping QA/SRE once the rotation completes so they can clear cached credentials.

## Rollback steps

### Application rollback

1. In Netlify, open **Deploys** for the impacted context (staging or production).
2. Promote the last known-good deploy.
3. File a follow-up issue to root-cause the regression before attempting another deploy.

### Database rollback

1. Open the Supabase project → **Database** → **Backups** (or PITR).
2. Restore the snapshot taken before the failed migration.
3. Re-run migrations locally against the restored copy to ensure the fix works.
4. Once verified, re-promote the `develop`/`main` branch following the [migration promotion flow](./supabase_branching.md#migration-promotion-flow-overview).
