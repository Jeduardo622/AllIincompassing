# Secret Rotation Runbook

This runbook documents where critical secrets are stored, who owns each system, and how to rotate credentials without breaking CI/CD.

## Supabase

- **Source of truth:** Supabase dashboard (Project Settings → API) with mirrored entries in 1Password (`Platform / Supabase`).
- **Managed by:** Platform engineering.
- **Secrets covered:**
  - `SUPABASE_URL`
  - `SUPABASE_EDGE_URL`
  - `SUPABASE_PUBLISHABLE_KEY` *(preferred client key for runtime config)*
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_ACCESS_TOKEN`
  - `DEFAULT_ORGANIZATION_ID`
- **Rotation steps:**
  1. Generate fresh publishable/service-role keys in the Supabase dashboard. Immediately update the 1Password record so there is a single source of truth.
  2. Update GitHub Actions secrets (`Settings → Secrets and variables → Actions`) and Netlify environment variables (production + staging contexts). Mask values as `****` in screenshots/logs.
  3. In Netlify, prefer setting `SUPABASE_PUBLISHABLE_KEY` as a custom variable even when Supabase integration is enabled. Some integration-managed `SUPABASE_ANON_KEY` values can remain on a legacy JWT key and cause login failures (`Legacy API keys are disabled`).
  4. Verify the deployed runtime key via:
     - `GET /api/runtime-config` (must return `supabaseAnonKey` beginning with `sb_publishable_`)
     - `npm run playwright:auth` (must pass)
  5. If `Build plugins/extensions` fail with `Failed retrieving extensions ... 504`, treat this as a transient Netlify platform failure and retry deployment; no repo config change is required if `netlify.toml` has no `[[plugins]]` entries.
  6. Run `supabase secrets set` for the hosted project so Edge Functions pick up the rotated keys.
  7. Ping the team to refresh local `.env.local` files and run `npm run ci:secrets` to verify their environment (the CI workflow calls the same script before builds).

## OpenAI

- **Source of truth:** OpenAI dashboard (organization admins).
- **Managed by:** AI integrations team.
- **Secrets covered:** `OPENAI_API_KEY`, `OPENAI_ORGANIZATION`.
- **Rotation steps:**
  1. Create a replacement API key in OpenAI.
  2. Update GitHub secrets and Netlify build environment variables.
  3. Sync the new key into the Supabase secret store for edge functions.
  4. Announce the cutover and ensure local validation passes with `npm run ci:secrets`.

## AWS (S3)

- **Source of truth:** AWS IAM.
- **Managed by:** Infrastructure team.
- **Secrets covered:** `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- **Rotation steps:**
  1. Create a new IAM access key pair for the automation user.
  2. Update GitHub secrets and Netlify environment variables.
  3. Rotate the Supabase storage integration if applicable.
  4. Revoke the old IAM keys once builds succeed.

## SMTP

- **Source of truth:** Email provider dashboard.
- **Managed by:** Communications team.
- **Secrets covered:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Rotation steps:**
  1. Generate new SMTP credentials.
  2. Update GitHub secrets and Netlify environment variables.
  3. Ensure Supabase Edge Functions referencing SMTP pick up the new credentials.
  4. Send a smoke-test email to confirm delivery.

## Test JWTs

- **Source of truth:** Supabase authentication (non-production tenants).
- **Managed by:** QA engineering.
- **Secrets covered:** `TEST_JWT_ORG_A`, `TEST_JWT_ORG_B`, `TEST_JWT_SUPER_ADMIN`.
- **Rotation steps:**
  1. Issue fresh JWTs for the designated test users.
  2. Store the tokens in GitHub secrets and Netlify (for preview QA runs).
  3. Update the Supabase branch secrets when running integration tests.
  4. Trigger `npm run ci:secrets` locally to confirm availability.

## Local validation

Developers can run `npm run ci:secrets` to confirm their environment has all required secrets before pushing changes. The CI workflow calls the same script before running linting or tests, ensuring missing secrets fail fast.

## Repository hygiene safeguards

- `scripts/check-secrets.ts` now scans tracked code/docs/config/report artifacts for:
  - Supabase access/secret keys,
  - credentialed Postgres URLs,
  - Slack webhook URLs,
  - JWT literals and private key blocks.
- Generated local report artifacts under `.reports/*.json` and `.reports/*.md` are ignored to avoid accidental credential leakage from command output.
- `.cursor/mcp.json` must never contain live tokens; keep placeholder values in git and source the token from local environment only.

## Incident response (credential exposure)

1. Revoke/rotate exposed credentials immediately in source systems (Supabase, DB, Slack, etc.).
2. Remove secret material from tracked files and force regeneration of affected runtime tokens.
3. Re-run `npm run ci:secrets` and `npm run ci:check-focused` before merge.
4. Record incident summary and rotation completion in the release/change log.
