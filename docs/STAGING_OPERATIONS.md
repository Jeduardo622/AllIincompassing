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
   - `AGENT_ACTIONS_DISABLED` (optional kill-switch for agent actions)
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

## Agent action kill switch
- **Runtime config**: `public.agent_runtime_config` (`config_key = 'global'`) controls `actions_disabled`.
- **Emergency disable**: set `AGENT_ACTIONS_DISABLED=true` in Netlify to override the runtime config.
- **Verification**: check `agent_execution_traces` for `execution.gate.denied` steps with `killSwitchEnabled=true`.

## GitHub Actions quality gate (current state)

The active workflow (`.github/workflows/ci.yml`) currently runs a single `quality` job on `main` and `develop`:

1. **Trigger** – runs on pull requests and pushes to `main`/`develop`.
2. **Build parity** – executes `npm ci`, lint, typecheck, tests, and `npm run build`.
3. **Policy checks** – runs `npm run ci:check-focused` (including startup canary and governance guards).
4. **Failure alerting** – `ci:check-focused` sends a Slack alert when running in CI with `SLACK_WEBHOOK_URL` configured.

Staging deploys are currently executed from Netlify (or manual CLI), not via a dedicated `deploy-staging` GitHub job.

## Smoke test expectations

- Smoke tests must validate authentication flows, dashboard rendering, and at least one Supabase read/write operation.
- Capture failures in GitHub Action artifacts and alert the team in the `#deployments` Slack channel.

### Alerting on staging failures

**Automatic alerting**:
- CI policy-check failures automatically route through `npm run ci:check-focused` and send Slack notifications when `SLACK_WEBHOOK_URL` is present.

**Manual alerting**:
```bash
npm run alert:slack -- \
  --title "Staging deploy failure" \
  --text "<description of failure>" \
  --severity medium \
  --source "staging-operations" \
  --runbook docs/STAGING_OPERATIONS.md
```

See `docs/OBSERVABILITY_RUNBOOK.md` for severity mapping and escalation procedures.

## Incident response

- **If staging deploy fails**:
  1. Alert team via Slack (see alerting section above).
  2. Redeploy the last successful build from Netlify’s deploy history or re-run the GitHub Action once secrets are fixed.
  3. Document root cause in `#deployments`.
- **For Supabase regressions**:
  1. Alert team with severity `medium` (SEV2)
  2. Use project backups (Dashboard → **Database** → **Backups** / PITR) to restore the hosted project
  3. Re-apply migrations once the fix is ready
  4. Verify with smoke tests before marking resolved
- **Follow the incident response checklist** in `docs/INCIDENT_RESPONSE.md` for severity classification and escalation procedures.
