# Clinical Data Parity Agent Handoff

## Scope

- Added a repo-local `clinical-data-parity-auditor` agent skill for browser-only redacted IEHP/FBA QA.
- Added `npm run playwright:clinical-data-parity-agent` to prove browser reachability and credential validity without hosted writes.
- Added explicit `PW_CLINICAL_QA_*` env placeholders for dedicated test-account credentials and redacted fixtures.

## Route Classification

- classification: low-risk autonomous
- lane: standard
- triggering paths: `.agents/skills/**`, `scripts/**`, `tests/**`, `package.json`, `.env.example`, `docs/ai/**`
- protected paths touched: none

## Credential Contract

Preferred:

- `PW_CLINICAL_QA_EMAIL`
- `PW_CLINICAL_QA_PASSWORD`

Fallback:

- `PW_ADMIN_EMAIL`
- `PW_ADMIN_PASSWORD`

Optional:

- `PW_BASE_URL`
- `PW_CLINICAL_QA_CLIENT_ID`
- `PW_CLINICAL_QA_ROUTE`
- `PW_CLINICAL_QA_SOURCE_FILE`
- `PW_CLINICAL_QA_OUTPUT_FILE`

The runner rejects placeholder passwords, API routes, admin-only routes, and fixture paths that are not clearly redacted, synthetic, smoke, or test fixtures.

## Non-Goals

- No production account access.
- No Supabase writes.
- No upload, publish, approval, or promotion action.
- No service-role key usage.
- No clinical approval claim.

## Verification Plan

- `npm test -- tests/scripts/clinical-data-parity-agent.test.ts`
- `npm run playwright:clinical-data-parity-agent` when dedicated test credentials are configured
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Residual Risk

- Browser evidence proves access and visible surface checks only; source-to-output clinical parity still requires redacted fixture selection and human review of findings.
- The agent can reduce reviewer workload but cannot replace BCBA sign-off.
