# WIN-257 Client Onboarding Conflict Handoff

- Date: 2026-07-27
- Route classification: standard
- Lane rationale: low-risk autonomous UI and client-side mutation handling limited to onboarding conflict mapping; no schema, RPC, or deploy changes

## Scope

- `src/lib/clients/mutations.ts`
- `src/lib/clients/__tests__/mutations.test.ts`
- `src/components/ClientOnboarding.tsx`
- `src/components/__tests__/ClientOnboarding.test.tsx`

## Non-goals

- No Supabase migrations, RPC edits, or preflight uniqueness queries beyond the existing email check
- No onboarding flow redesign outside duplicate-conflict handling
- No changes to unrelated onboarding validation, auth, routing, or storage behavior

## Implementation Summary

- Added client-layer mapping for `23505` / `409` unique conflicts during client creation.
- Mapped `clients_org_client_id_idx` to an actionable client-ID conflict error.
- Kept global `clients_email_key` conflicts generic so onboarding does not reveal
  whether an email exists in another organization.
- Mapped unknown unique conflicts to a generic duplicate-record error.
- Updated onboarding submit error handling so client-ID conflicts return the user to Basic Info, preserve form state, and surface the field error inline.

## Evidence

- RED command attempted first:
  - `npx vitest run src/lib/clients/__tests__/mutations.test.ts src/components/__tests__/ClientOnboarding.test.tsx`
  - Result: blocked locally because `node.exe` was not available on PATH in the shell
- Reviewer follow-up RED command:
  - `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vitest\vitest.mjs run src/lib/clients/__tests__/mutations.test.ts`
  - Result: failed as expected before the mapper fix because `{ status: 409, code: '23503' }` was incorrectly rewritten as a duplicate-record conflict
- GREEN command:
  - `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vitest\vitest.mjs run src/lib/clients/__tests__/mutations.test.ts src/components/__tests__/ClientOnboarding.test.tsx`
  - Result: passed with `2` files / `23` tests
- Security follow-up RED command:
  - `npm run test -- src/lib/clients/__tests__/mutations.test.ts`
  - Result: failed as expected because the initial mapper exposed an email-specific
    message for the globally unique `clients_email_key`.
- Final GREEN command:
  - `npm run test -- src/lib/clients/__tests__/mutations.test.ts src/components/__tests__/ClientOnboarding.test.tsx`
  - Result: passed with `2` files / `24` tests

## Verification Card

- Lane: `standard`
- Required checks:
  - focused mutation and onboarding tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run validate:tenant`
  - `npm run build`
- Executed checks:
  - focused tests: passed, `2` files / `24` tests
  - `npm run ci:check-focused`: passed; protected-service checks without a
    configured database URL were explicitly skipped by the policy runner
  - `npm run lint`: passed
  - `npm run typecheck`: passed
  - `npm run validate:tenant`: passed
  - `npm run build`: passed
  - `npm run test:routes:tier0`: passed, `7` specs / `220` tests
  - `npm run test:ci`: failed in `5` unrelated baseline tests outside the changed
    onboarding surfaces, including authorization migration text drift, disposable
    browser-proof workflow drift, synthetic BCBA provisioning workflow drift, and
    the async PDF blob test (`blob.text is not a function`)
- Blocked checks:
  - `npm run ci:playwright`: preflight stopped because neither supported
    admin credential pair is available in this local environment
- Result: focused onboarding verification passed; repository-wide closure remains
  blocked by the unrelated `test:ci` failures and unavailable Playwright credentials.

## Residual Risk

- Hosted `create_client` responses that report unique conflicts without SQLSTATE `23505` will only map when the code is absent and the payload still clearly states `duplicate key value violates unique constraint`.
- No migration, function deploy, RLS, grant, or production-data change is part of
  this fix.
