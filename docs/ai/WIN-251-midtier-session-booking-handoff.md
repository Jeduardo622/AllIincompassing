# WIN-251 Mid Tier session booking authorization

## Scope

- classification: high-risk human-reviewed
- lane: critical
- issue: WIN-251
- intent: allow exact in-organization `midtier` and `admin_schedule` schedule staff to use the existing session hold-and-confirm booking path
- non-goals: no schema, RLS, grant, migration, generic organization-member, route, session-note, or cancellation changes

## Root-cause evidence

The live Mid Tier Schedule form returned `Forbidden` after `Create Session`.
Hosted Supabase Edge logs recorded paired `403` responses from
`sessions-hold` and `sessions-confirm`. Both handlers call
`evaluateTherapistAuthorization`, whose exact target-scoped role list omitted
`midtier` and `admin_schedule` even though the shared schedule-staff contract
recognizes both roles.

## Files

- `supabase/functions/_shared/authorization.ts`
- `tests/edge/scheduling-authorization.bcba.test.ts`
- `docs/ai/WIN-251-midtier-session-booking-handoff.md`

## Verification card

- classification: high-risk human-reviewed
- lane: critical
- change type: authz; server/API/edge integration; tenant-scoped scheduling
- required checks:
  - `npm ci`
  - focused booking authorization tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
- executed checks:
  - `npm ci` -> pass
  - focused booking authorization tests -> pass, 11/11
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run validate:tenant` -> pass
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass, 220/220
- blocked checks:
  - `npm run test:ci` -> local Node 24/Windows run reaches the suite but fails
    five tests that pass on the exact base commit in GitHub's Node 20/Linux
    `unit-tests` job; PR CI is required as the authoritative result
  - `npm run verify:local` -> blocked by the same local `test:ci` runtime
    mismatch after policy, lint, and typecheck pass
  - `npm run ci:playwright` -> local preflight lacks
    `PW_SUPERADMIN_EMAIL`/`PW_SUPERADMIN_PASSWORD` or
    `PW_ADMIN_EMAIL`/`PW_ADMIN_PASSWORD`; PR CI and live Computer proof are
    required
- result: pass-with-blocked-checks pending authoritative PR CI
- residual risk: the code diff is narrow and independently approved, but the
  live Mid Tier hold-and-confirm workflow must be re-run after merge/deploy

## Reviews

- specification-engineer: completed
- software-architect: completed; hosted logs superseded an alternate
  session-note hypothesis
- code-review-engineer: approved with no blocking findings
- test-engineer: focused coverage accepted; direct live hold/confirm proof
  remains required
- security-engineer: approved; target-therapist scoping and fail-closed
  behavior preserved

## PR hygiene

- dedicated branch: `codex/win-251-midtier-session-booking`
- single purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none outside the routed shared Edge authorization
  helper
- Linear linkage: WIN-251
- human review: required before merge

