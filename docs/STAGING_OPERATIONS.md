# Staging Operations Playbook

This playbook captures the operational steps required to stand up and maintain the staging environment that mirrors production while protecting secrets. Update it whenever workflows change.

## Netlify staging context

1. In Netlify, open the site **AllIincompassing** → **Site configuration** → **Environment variables**.
2. Ensure the `netlify.toml` `[context.staging]` block remains present; it mirrors the production build (same command/publish directory) while exposing `VITE_RUNTIME_ENV=staging` for telemetry.
3. Point the deploy context at the `develop` branch. Branch deploys from `develop` publish to the staging URL.
4. Add the Supabase staging credentials as environment variables (configure in the Netlify UI, do **not** commit raw values):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ACCESS_TOKEN`
5. Store the raw values in the shared secrets manager (1Password vault `Platform / Supabase`). Paste only redacted values (e.g., `****`) into pull requests or chat logs.
6. Stage-specific Netlify secrets:
   - `NETLIFY_AUTH_TOKEN`
   - `NETLIFY_STAGING_SITE_ID`
7. Trigger a staging build from the Netlify UI to ensure the updated context provisions correctly.

## Supabase staging project

- Create a dedicated Supabase project that mirrors production and link it to the `develop` branch. Reference: [Supabase Branching Runbook](./supabase_branching.md#promoting-to-staging-develop).
- Tag the staging project with `environment: staging` so billing reports remain accurate.
- Seed the project with anonymized data using the scripts in `scripts/` and validate RLS policies before sharing the credentials with QA.

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

- If the staging deploy fails, roll back by redeploying the last successful build from Netlify’s deploy history.
- For Supabase regressions, restore the latest staging backup (Dashboard → **Database** → **Backups**) and re-apply migrations from `develop` after the fix ships.
