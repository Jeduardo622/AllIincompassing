# WIN-272 Session Close Autosave Handoff

## Route
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Issue: `WIN-272`
- Scope: save a non-BT in-progress session note draft before readiness/completion, then finalize the same note without replaying persisted trial events

## Scope
- Production files:
  - `src/pages/Schedule.tsx`
  - `src/lib/session-notes.ts`
  - `src/server/api/session-notes-upsert.ts`
- Test files:
  - `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
  - `src/lib/__tests__/session-notes.test.ts`
  - `src/server/__tests__/sessionNotesUpsertHandler.test.ts`
- Non-goals:
  - schema, migration, auth, CI, or deploy changes
  - BT closeout behavior changes
  - live per-goal completion indicators
  - deployment

## Verification Card
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Required checks:
  - focused schedule orchestration and session-note helper tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - `npm run verify:local` -> pass on `origin/main` commit `1f039082`
  - `npm run ci:check-focused` -> pass after syncing to `origin/main` with merged PR #879
  - focused schedule and client-helper Vitest suite with one worker and 8 GB Node heap -> pass, 70 tests
  - session-note API handler suite -> pass, 69 tests
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run test:ci` -> pass, 437 files and 3,627 tests; 2 files and 5 tests skipped
  - `npm run ci:verify-coverage` -> pass, 92.88% line coverage
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass, 220 Cypress tests
  - `npm run validate:tenant` -> pass
- Blocked checks:
  - `npm run ci:playwright` -> preflight passes, then auth smoke fails because the configured hosted test credential is rejected
- Result: `pass-with-blocked-checks`
- Residual risk:
  - hosted authenticated session-close smoke was not reached because the prerequisite auth smoke failed

## Review State
- `specification-engineer`: acceptance criteria and non-goals confirmed
- `software-architect`: required returned-note-ID handoff and trial replay prevention
- `implementation-engineer`: implemented test-first bounded slice
- `code-review-engineer`: approved after incremental trial retry fix
- `test-engineer`: focused coverage approved; required repository and browser checks identified
- `security-engineer`: approved after same-org cross-session `noteId` retargeting was made fail-closed

## PR Hygiene
- `pr-ready`: yes, pending human review and hosted checks
- `branch-ready`: yes
- `linear-ready`: yes
- `single-purpose`: yes
- `unrelated changes`: pre-existing worktree changes excluded from this slice
- `protected-path drift`: contained to `src/server/api/session-notes-upsert.ts`; no migration, auth, CI, or deploy files changed
- `baseline sync`: current `origin/main` includes merged PR #879 and passes the required policy hook
- `required follow-up`: commit, push, and open the WIN-272 PR for human review; rerun the authenticated hosted smoke after its credential is repaired
