# Playwright Readiness And Optional Smoke Gates

Status: implemented as protected CI/tooling follow-up.

Current hosted follow-up:

- GitHub secret `PW_ASSESSMENT_CLIENT_ID` was added after the first PR CI attempt reported it missing.
- `PW_ASSESSMENT_SAMPLE_FILE` was already configured.
- The selected hosted client is explicitly marked as a test client; do not replace it with a real client.
- PR CI was rerun after the secret update so `playwright-env-readiness` and `iehp-assessment-import-smoke` can validate the corrected environment.

## Route-task

- classification: `high-risk human-reviewed`
- lane: `critical`
- Linear: `WIN-209`
- why: adds GitHub Actions jobs and CI scripts that handle secret-backed browser readiness and optional hosted smoke execution
- triggering paths: `.github/workflows/ci.yml`, `scripts/ci/**`, `package.json`

## Environment readiness report

`npm run ci:playwright:env-readiness` writes:

- `artifacts/latest/readiness/playwright-env-readiness.json`
- `artifacts/latest/readiness/playwright-env-readiness.md`

The report never writes secret values. It classifies each required or optional input as:

- `configured`
- `missing`
- `placeholder`
- `not_validated`

The CI job `playwright-env-readiness` is included in `ci-gate`, but it only injects hosted Playwright secrets when `scripts/ci/select-browser-checks.mjs` marks auth/session Playwright coverage as required. When no auth/session browser surface changed, it writes a non-secret `not_validated` readiness artifact and exits successfully. When readiness is required, a failed artifact result means one or more required smoke inputs are missing, placeholder, or only syntactically present but not validated.

## Durable persona contract

The readiness report treats these as required for the critical browser environment:

- `PW_THERAPIST_EMAIL` / `PW_THERAPIST_PASSWORD`
- `PW_SCHEDULE_EMAIL` / `PW_SCHEDULE_PASSWORD`, or explicit admin fallback through `PW_ADMIN_EMAIL` / `PW_ADMIN_PASSWORD`
- `PW_FOREIGN_CLIENT_ID` / `PW_FOREIGN_THERAPIST_ID`
- `PW_ASSESSMENT_CLIENT_ID` / `PW_ASSESSMENT_SAMPLE_FILE`
- Supabase runtime URL, anon/publishable key, and service-role key

The dynamic `PW_SUPERADMIN_*` lifecycle account remains owned by `scripts/provision-ci-smoke-admin.ts`; readiness only reports whether a super-admin pair is already configured.

Dedicated `PW_CLINICAL_QA_*` credentials are optional in the readiness report but preferred for recurring staff upload/output parity. If they are absent, the report makes that visible without blocking normal CI. Browser artifact capture for clinical QA also requires `PW_CLINICAL_QA_TARGET_MARKER` with one of `redacted`, `synthetic`, `smoke`, or `test`.

## Optional hosted smoke suite

`npm run ci:playwright:optional-smoke` runs these high-cost or fixture-heavy scripts through the attributed Playwright runner:

- `playwright:authorizations-read-scope`
- `playwright:assessment-upload-promote-smoke`
- `playwright:assessment-pdf-smoke`
- `playwright:clinical-data-parity-agent`

The GitHub Actions job `optional-playwright-smoke` is deliberately separate from the fast required gates:

- it is `continue-on-error: true`
- it runs only when `PW_OPTIONAL_PLAYWRIGHT_SMOKE` is the literal string `true`
- it fails fast when the explicit secret gate is incomplete
- clinical QA artifact capture additionally requires `PW_CLINICAL_QA_TARGET_MARKER` to assert the target is redacted/synthetic/smoke/test-only
- it uploads `artifacts/latest` even on failure

Use this job for human-reviewed readiness evidence before staff upload/output testing or assessment-generation signoff.
