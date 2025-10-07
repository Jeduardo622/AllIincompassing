# Production Readiness Runbook

This runbook distills the day-to-day operational tasks for the AI-first ABA platform once the CI/CD hardening in this change-set ships.

## 1. Secret rotation quick reference

| Scope | Keys | Source of truth | Rotation cadence |
| --- | --- | --- | --- |
| Supabase (preview/staging/prod) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_EDGE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` | Supabase project settings | Before every schema promotion |
| Netlify deploy contexts | `NETLIFY_AUTH_TOKEN`, `NETLIFY_STAGING_SITE_ID`, `NETLIFY_PRODUCTION_SITE_ID` | Netlify UI → Site settings → Build & deploy | Quarterly or when staff changes |
| Clearinghouse sandbox | `CLEARINGHOUSE_SANDBOX_CLIENT_ID`, `CLEARINGHOUSE_SANDBOX_API_KEY` | Clearinghouse portal | Quarterly |
| Telemetry | `TELEMETRY_WRITE_KEY` | Observability vendor console | Quarterly |
| AI integrations | `OPENAI_API_KEY`, `OPENAI_ORGANIZATION` | OpenAI dashboard | Monthly |
| Infrastructure | `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | AWS IAM | Rotate per credential report |
| Messaging | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Email provider portal | Quarterly |
| QA auth tokens | `TEST_JWT_ORG_A`, `TEST_JWT_ORG_B`, `TEST_JWT_SUPER_ADMIN` | Supabase preview auth tenants | Monthly |

**Rotation process:** Follow the [Secret Rotation Runbook](./SECRET_ROTATION_RUNBOOK.md) for detailed steps. After updating values in GitHub, Netlify, and Supabase, run `npm run ci:secrets` locally; the command now enforces all of the keys listed above.

## 2. CI failure decoder

| Stage | Command | Failure signal | Action |
| --- | --- | --- | --- |
| Secrets validation | `npm run ci:secrets` | Missing key list | Populate the named secrets in GitHub/Netlify; re-run.
| Lint | `npm run lint` | ESLint error output | Fix lint issues per [docs/ENVIRONMENT_MATRIX.md](./ENVIRONMENT_MATRIX.md) standards.
| Typecheck | `npm run typecheck` | `tsc` errors | Resolve TypeScript issues before retrying.
| Focused test guard | `git grep` + `npm run ci:check-focused` | Lists `.only`/`.skip` offenders | Remove focus/skip or wrap with `tests/utils/testControls` helpers.
| Unit tests | `npm run test:ci -- --bail=1` | Vitest failure logs | Address failing tests; ensure coverage remains ≥ 90%.
| Coverage gate | `npm run ci:verify-coverage` | Coverage percentage below threshold | Add/extend tests to restore ≥ 90% line coverage.
| Build canary | `npm run build:canary` | Node version mismatch or build failure | Ensure Node `20.16.0` is configured (`.nvmrc`); investigate build errors.
| Deploy preview smoke | `npm run preview:smoke -- --url <preview>` | `[smoke] FAIL ...` | Inspect runtime config + Supabase health; redeploy after fixing.

## 3. Rollback

### Application rollback (Netlify)
1. Open Netlify → Site → **Deploys**.
2. Promote the last known-good deploy for staging or production.
3. Post a runbook update summarising the root cause analysis task.

### Database rollback (Supabase)
1. Navigate to Supabase project → **Database** → **Backups**.
2. Restore the backup taken immediately prior to the problematic deploy.
3. Re-run migrations locally to reproduce and patch the issue before re-promoting.
4. Coordinate with QA before re-enabling staging deployments.

### Smoke validation after rollback
1. Run `npm run preview:smoke -- --url <restored deploy>`.
2. Confirm Supabase auth health and runtime config succeed.
3. Execute `npm run test:ci -- --bail=1` locally with `RUN_DB_IT=1` to confirm backend parity.
4. Update [docs/ENVIRONMENT_MATRIX.md](./ENVIRONMENT_MATRIX.md) if infrastructure changes were required.
