# Staging Operations Playbook

This playbook captures the operational steps required to stand up and maintain the staging environment that mirrors production while protecting secrets. Update it whenever workflows change.

## Netlify staging context

1. In Netlify, open the site **AllIincompassing** → **Site configuration** → **Environment variables**.
2. Create a new deploy context named `staging` (Netlify UI → **Build & deploy** → **Continuous deployment** → **Deploy contexts**).
3. Point the context at the `develop` branch. Branch deploys from `develop` should publish to the staging URL.
4. Add the Supabase staging credentials as environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ACCESS_TOKEN`
5. Store the raw values in the shared secrets manager (1Password vault `Platform / Supabase`). Paste only redacted values (e.g., `****`) into pull requests or chat logs.
6. Trigger a staging build from the Netlify UI to ensure the new context provisions correctly.

## Supabase staging project

- Create a dedicated Supabase project that mirrors production and link it to the `develop` branch. Reference: [Supabase Branching Runbook](./supabase_branching.md#promoting-to-staging-develop).
- Tag the staging project with `environment: staging` so billing reports remain accurate.
- Seed the project with anonymized data using the scripts in `scripts/` and validate RLS policies before sharing the credentials with QA.

## GitHub Actions staging deployment job

Platform engineering must extend the existing deployment workflow with a staging job. Because `.github/` changes are restricted for Codex agents, implement this update manually with the following guardrails:

1. Trigger the job on pushes to `develop` and manual `workflow_dispatch` invocations.
2. Reuse the build artifacts from the primary job to avoid duplicate installs.
3. Publish the build to Netlify via `netlify deploy --prod-if-unlocked=false --context=staging` using the staging site ID and auth token.
4. After deploy, run smoke tests against the staging URL:
   ```bash
   PREVIEW_URL=$STAGING_URL npm run preview:smoke
   ```
5. Mark the job as a required status check before merging into `main`.

Document the final workflow in this repository once infrastructure changes land.

## Smoke test expectations

- Smoke tests must validate authentication flows, dashboard rendering, and at least one Supabase read/write operation.
- Capture failures in GitHub Action artifacts and alert the team in the `#deployments` Slack channel.

## Incident response

- If the staging deploy fails, roll back by redeploying the last successful build from Netlify’s deploy history.
- For Supabase regressions, restore the latest staging backup (Dashboard → **Database** → **Backups**) and re-apply migrations from `develop` after the fix ships.
