# Secret Rotation Runbook

This runbook documents where critical secrets are stored, who owns each system, and how to rotate credentials without breaking CI/CD.

## Supabase

- **Source of truth:** Supabase project secrets.
- **Managed by:** Platform engineering.
- **Secrets covered:**
  - `SUPABASE_URL`
  - `SUPABASE_EDGE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_ACCESS_TOKEN`
- **Rotation steps:**
  1. Generate new credentials in the Supabase dashboard (Project Settings → API).
  2. Update the secrets in GitHub (`Settings → Secrets and variables → Actions`).
  3. Mirror the values into Netlify environment variables for preview builds.
  4. Notify developers to refresh their local `.env.codex` via `npm run ci:secrets`.

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
