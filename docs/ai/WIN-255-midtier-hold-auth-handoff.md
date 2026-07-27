# WIN-255 Midtier Hold Auth Handoff

- classification: `high-risk human-reviewed`
- lane: `critical`
- branch: `codex/win-255-midtier-hold-auth`
- scope:
  - `tests/integration/acquire-session-hold-bcba-migration.test.ts`
  - `supabase/migrations/20260727004500_acquire_session_hold_schedule_staff_authorization.sql`
  - `docs/ai/WIN-255-midtier-hold-auth-handoff.md`

## Change summary

- Added a focused migration contract that now requires exact `admin_schedule` and `midtier` authorization branches in the privileged seven-argument `public.acquire_session_hold` RPC.
- Added one forward-only migration that copies the current active-status `acquire_session_hold` body and changes only the authorization predicate to admit exact `admin_schedule` and `midtier` alongside the existing `therapist`, `admin`, `super_admin`, and `bcba` checks.
- Preserved the active therapist/client boundary, optional session organization boundary, fail-closed denial behavior, and service-role-only execute grants.

## TDD evidence

- RED:
  - focused migration contract failed because the current SQL did not contain exact `midtier` or `admin_schedule` role checks.
- GREEN:
  - the same focused migration contract passed after the forward migration was added and the test was pointed at the new reviewed migration file.

## Verification

- `npx vitest run tests/integration/acquire-session-hold-bcba-migration.test.ts tests/edge/scheduling-authorization.bcba.test.ts` -> pass, 10/10.
- `npm run ci:check-focused` -> pass; database-backed checks explicitly skipped because no local database URL is configured.
- `npm run lint` -> pass.
- `npm run typecheck` -> pass.
- `npm run validate:tenant` -> pass.
- `npm run build` -> pass.
- `npm run test:routes:tier0` -> pass, 220/220.
- `npm run ci:playwright` -> blocked at credential preflight because neither the super-admin nor admin Playwright credential pair is available locally.
- `npm run test:ci` -> failed on the five pre-existing baseline failures outside this slice:
  - Windows newline assertion in `tests/authorizations/authorization-bcba-readonly.test.ts`
  - synthetic BCBA workflow contract in `tests/ci/check-e2e-reliability-gates.test.ts`
  - generated super-admin/cleanup workflow contract in `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
  - managed proof branch workflow contract in `tests/workflows/bt-aba-disposable-browser-proof.test.ts`
  - Node 24 `blob.text` incompatibility in `src/lib/__tests__/supabase.edge.test.ts`
- `npm run verify:local` -> reached the same five pre-existing `test:ci` failures after policy, lint, and typecheck passed; later aggregate stages did not run. Build and Tier-0 route verification were run separately and passed.

## Verification card

- lane: `critical`
- required checks: focused migration/authorization contracts, policy checks, lint, typecheck, tenant validation, test suite, build, Tier-0 routes, auth/session browser gate, independent security/Supabase/code review, hosted migration application, and live production reproof
- executed checks: focused contracts, policy checks, lint, typecheck, tenant validation, test suite, build, Tier-0 routes, and three independent reviews
- blocked checks: local auth/session browser gate lacks the required protected Playwright credentials
- result: `review-ready with known unrelated baseline failures`; all executable checks specific to this migration passed
- independent review:
  - security review: approved
  - Supabase review: approved
  - code review: approved
- residual verification: CI, human review, hosted migration application, and live Mid Tier booking reproof

## Residual risk

- This is a protected migration/auth change. Human review and hosted migration application are still required before merge.
- Production behavior remains unchanged until the migration is merged and applied through the reviewed deployment path.
