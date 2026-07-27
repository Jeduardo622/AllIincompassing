# WIN-259 Codex Review Follow-ups

## Scope

Resolve both findings left open on merged PR #868:

1. Let a user explicitly promote a selected lower-control goal to the primary `goal_id`.
2. Hydrate persisted `cancellation_attribution` before displaying an existing cancellation, preserving missing legacy attribution as unknown.

## Route

- classification: `low-risk autonomous`
- lane: `standard`
- triggering paths:
  - `src/components/SessionModal.tsx`
  - `src/components/__tests__/SessionModal.test.tsx`
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- protected paths: none

## Non-goals

- No migrations, RPC changes, RLS, grants, auth, server, CI, or deploy changes.
- No broader Program/Goals redesign.
- No schedule authorization or cancellation-write contract changes.

## Stop Conditions

- Re-route to `critical` if resolving attribution requires a migration, RPC, server, or tenant-policy change.
- Stop if primary-goal promotion requires changing the persisted session-write contract outside the existing modal payload.

## TDD Evidence

The focused regression run was executed before production implementation:

```text
npx vitest run src/components/__tests__/SessionModal.test.tsx \
  -t "lets the lower goal controls replace|hydrates a persisted client cancellation|preserves an unknown persisted cancellation" \
  --reporter=dot
```

Result: 3 tests failed for the expected missing behaviors:

- no accessible lower-control primary-goal action
- persisted client attribution displayed as staff
- unknown persisted attribution displayed as staff

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: UI/component state and tenant-scoped detail hydration
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - focused SessionModal and scheduling tests
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - hosted auth/session browser gate
- executed checks:
  - focused red run: 3 expected failures before implementation
  - focused green run: 3 passed
  - SessionModal and scheduling regression run: 196 passed
  - `npm run ci:check-focused`: passed; secret-backed database checks and CI-only branch-protection checks skipped by the command as expected
  - `npm run lint`: passed
  - `npm run typecheck`: passed
  - `npm run build`: passed
  - `npm run test:ci`: reached 3,446 passing tests and 5 failures on unchanged baseline surfaces
  - `npm run verify:local`: policy, lint, and typecheck passed; stopped at the same 5 unchanged `test:ci` baseline failures
- blocked checks:
  - local full-suite green status is blocked by 5 failures reproduced on surfaces unchanged from `origin/main`
  - hosted auth/session browser confidence is pending the follow-up PR checks
- result: `pass-with-blocked-checks`
- residual risk: low; focused behavior and neighboring scheduling coverage pass, while hosted CI remains the authoritative check for the unchanged local baseline failures

## PR Handoff

- Linear: WIN-259
- branch: `codex/win-258-review-followups`
- PR: https://github.com/Jeduardo622/AllIincompassing/pull/869
- reviewer: approved with no required changes
