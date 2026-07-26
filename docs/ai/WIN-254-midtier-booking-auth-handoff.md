# WIN-254 Mid Tier Booking Authorization Handoff

- `classification`: high-risk human-reviewed
- `lane`: critical
- `issue`: WIN-254
- `intent`: Allow an active, unexpired exact `midtier` scheduling staff user to book an in-organization therapist through the legacy Node `/api/book` path while preserving therapist self-only and cross-tenant boundaries.
- `files touched`:
  - `src/server/api/book.ts`
  - `src/server/api/shared.ts`
  - `src/server/__tests__/bookHandler.test.ts`
  - `src/server/__tests__/orgRoleRpcEquivalence.contract.test.ts`
- `non-goals`:
  - No migrations, RLS, grants, RPC, Edge Function, UI, runtime-config, or deployment changes.
  - No expansion to generic organization members or the broader schedule capability that includes therapists.
- `stop conditions`: Stop and re-route if the fix requires schema/RPC changes, service-role authorization decisions, Edge Function changes, or a broader employee-role refactor.
- `required agents`: specification-engineer, software-architect, implementation-engineer, code-review-engineer, test-engineer, security-engineer
- `required checks`:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - targeted booking and role-RPC tests
  - `npm run test:ci`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
- `executed checks`:
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - focused Vitest (`bookHandler.test.ts` and `orgRoleRpcEquivalence.contract.test.ts`) -> pass, 47/47
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass, 220/220 after the required build
  - `npm run test:ci` -> fail, 5/3,394 tests; every failing file is unchanged from `origin/main`
  - `npm run ci:playwright` -> blocked locally because the required Playwright account secrets are unavailable
  - `npm run verify:local` -> fail at the same five unchanged `test:ci` cases; later coverage/build/route steps did not execute in the aggregate command
- `blocked checks`:
  - `npm run ci:playwright` -> requires protected Playwright account credentials not available in this worktree
- `local baseline failures`:
  - `tests/authorizations/authorization-bcba-readonly.test.ts` -> Windows checkout text assertion
  - `tests/ci/check-e2e-reliability-gates.test.ts` -> synthetic BCBA workflow contract assertion
  - `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts` -> generated super-admin/cleanup workflow contract assertion
  - `tests/workflows/bt-aba-disposable-browser-proof.test.ts` -> managed proof branch workflow contract assertion
  - `src/lib/__tests__/supabase.edge.test.ts` -> Node 24 `Blob.text` environment mismatch
- `reviewer`: code review approved; final security review approved after repo and hosted RPC contract verification
- `residual risk`: The local Node 24/Windows environment has unrelated baseline test failures; required GitHub Node 20/Linux CI and post-merge production reproof must pass before the live defect is considered closed.
- `pr handoff`: Ready after the final fresh verification pass and PR-hygiene inspection.

## Root Cause

The production UI posts to the legacy Node `/api/book` fallback. Its authorization logic recognized administrator, therapist self-booking, organization-member aliases, and exact BCBA, but omitted the already-established narrow scheduling staff roles `admin_schedule` and `midtier`. The Edge authorization path had already been updated, leaving a parity gap in the Node fallback.

## Bounded Fix

The server now checks the existing public `user_has_role_for_org` RPC, using the caller's bearer token, for the exact schedule-staff set `admin_schedule`, `midtier`, then `bcba`. Transport and server failures remain fail-closed. Existing organization/entity validation and therapist self-only behavior remain in place.

## TDD Evidence

The new Mid Tier cross-therapist booking regression failed with HTTP 403 before the implementation and passes with HTTP 200 after the bounded fix. A separate regression proves an upstream exact-role verification failure returns HTTP 502 without invoking the booking write.

## Live Closure Gate

After human merge and production deployment, repeat the synthetic Mid Tier client-to-first-session workflow through the real UI, capture redacted screenshot proof, verify the session rows through hosted Supabase, and remove all marker-owned synthetic rows transactionally.
