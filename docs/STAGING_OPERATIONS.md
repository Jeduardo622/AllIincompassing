# Staging Operations Playbook

This playbook captures the operational steps required to stand up and maintain the staging environment that mirrors production while protecting secrets. Update it whenever workflows change.

## Netlify staging context

1. In Netlify, open the **AllIincompassing** site → **Environment variables**.
2. The `[context.staging]` block in `netlify.toml` mirrors production (same build command/publish directory) but sets `VITE_RUNTIME_ENV=staging` for telemetry.
3. Deploy context: `develop` branch → staging URL.
4. Add environment variables via the Netlify UI (never commit raw values):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ACCESS_TOKEN`
   - `DEFAULT_ORGANIZATION_ID`
   - Any additional runtime secrets (OpenAI, S3, etc.) required for end-to-end flows.
5. Store raw values in 1Password (`Platform / Supabase`). Only redacted snippets (`****`) belong in PRs or chat logs.
6. Stage-specific Netlify secrets live in GitHub Actions as well:
   - `NETLIFY_AUTH_TOKEN`
   - `NETLIFY_STAGING_SITE_ID`
7. Trigger a staging build from the Netlify UI or re-run the GitHub Action to confirm the context deploys cleanly.

## Supabase project usage

- All environments currently share the hosted Supabase project `wnnjeqheqxxyrgsjmygy`. There is no separate “staging” database.
- Keep `DEFAULT_ORGANIZATION_ID` consistent across Netlify contexts, GitHub secrets, and `.env.local`.
- When testing schema changes, use Supabase **branches** (`npm run db:branch:create`) rather than provisioning a new project; follow the [Supabase Branching Runbook](./supabase_branching.md) for promotion.

## GitHub Actions staging deployment job

The GitHub Actions workflow (`.github/workflows/ci.yml`) now includes an automated `deploy-staging` job with the following behavior:

1. **Trigger** – runs on pushes to `develop` after the primary `build` job succeeds.
2. **Build** – executes `npm ci` and `npm run build` in a fresh runner to keep parity with production outputs.
3. **Deploy** – calls `npx netlify-cli deploy --context=staging` using `NETLIFY_AUTH_TOKEN` and `NETLIFY_STAGING_SITE_ID`, capturing the resulting `deploy_url` as a job output and environment URL.
4. **Smoke** – runs `npm run preview:smoke` with the staging URL to verify `/api/runtime-config` and the SPA root document. Failures bubble up as job failures.
5. **Status checks** – require the `deploy-staging` job for `develop` merges so staging stays healthy.

If secrets are missing, the job fails early with an actionable error. Update Netlify secrets and re-run the workflow to recover.

## Smoke test expectations

- Smoke tests must validate authentication flows, dashboard rendering, and at least one Supabase read/write operation.
- Capture failures in GitHub Action artifacts and alert the team in the `#deployments` Slack channel.

## Incident response

- If the staging deploy fails, redeploy the last successful build from Netlify’s deploy history or re-run the GitHub Action once secrets are fixed.
- For Supabase regressions, use the project backups (Dashboard → **Database** → **Backups** / PITR) to restore the hosted project, then re-apply migrations once the fix is ready.
