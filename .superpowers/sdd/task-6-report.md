# Task 6 Report: Current-target-aware session capture

## Result

Implemented after the parent reclassified and authorized the narrow missing-contract extension. The database remains the progression/version authority.

## RED evidence

- Initial focused run exposed five failures: four legacy target fixtures were hidden by the current-target predicate and the structured conflict response used the wrong response-helper argument.
- Updated focused assertions require the modal to attach `expected_progression_version: 7` and the server to forward `{ target_id, progression_version: 7 }` to the finalization RPC.

## Implementation

- New capture groups only current active targets; targets referenced by hydrated/pending historical trials remain visible.
- The modal reads the caller-scoped database billing policy RPC and defaults fail-closed while loading/erroring; Schedule no longer reads the Vite billing flag.
- Trial submissions carry target progression versions. The existing unshipped finalization RPC locks and compares target/version before new finalization writes, while locked-note replay skips the stale check.
- Server/client/Schedule preserve typed progression results and structured 409 context. The modal retains form state, refreshes targets, and renders phase, target, goal, criteria, or conflict notices.
- Completed Schedule submissions finalize the clinical note after the session transition and return progression results to the modal.

## Files changed

- `src/components/SessionModal.tsx`
- `src/components/__tests__/SessionModal.test.tsx`
- `src/pages/Schedule.tsx`
- `src/lib/session-notes.ts`
- `src/lib/__tests__/session-notes.test.ts`
- `src/server/api/session-notes-upsert.ts`
- `src/server/__tests__/sessionNotesUpsertHandler.test.ts`
- `src/types/index.ts`
- `supabase/migrations/20260710210551_goal_target_automatic_progression.sql`
- `tests/goal-target-automatic-progression-migration.test.ts`

## Verification

- `npx vitest run src/components/__tests__/SessionModal.test.tsx src/server/__tests__/sessionNotesUpsertHandler.test.ts src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/lib/__tests__/session-notes.test.ts tests/goal-target-automatic-progression-migration.test.ts --reporter=dot` - PASS, 151 tests.
- `npm run typecheck` - PASS.
- `npm run lint` - PASS.
- `npm run ci:check-focused` - PASS; live DB grant/preview checks skipped without `SUPABASE_DB_URL`, auth parity disabled outside CI.
- `npm run validate:tenant` - PASS.
- `npm run build` - PASS.
- `git diff --check` - PASS.

## Residual risk

- The migration/RPC concurrency behavior still requires Task 7 live database proof.
- Browser proof of stale retry, historical hydration, and completion notices remains required.
- Session completion and note finalization are sequential application calls because the existing session-completion API is outside this bounded migration RPC; a finalization conflict preserves the completed session and editable note for explicit retry.

## Reviewer remediation

- Captured RED with seven focused failures for the missing expected-version validator and SQL set contract.
- First finalization now requires one finite, integer, nonnegative version per distinct trial target. Partial, conflicting, invalid, duplicate-version-entry, and extra/missing target sets fail before mutation; already-locked replay bypasses the new-token requirement.
- Structured conflicts preserve server capitalization and identify both the stale target and authoritative current target/phase.
- A visible `Discard stale trials and retry` action explains that the completed session is preserved, drops only the named stale target's unsaved trials, retains other form/note input, and retries without silently retargeting.
- Schedule records completion success so retry finalizes the note without completing the session twice.
- Duplicate incomplete-criteria notices are collapsed.
- Remediation focused suite: 158/158 tests PASS. Typecheck, lint, policy checks, tenant validation, build, and diff check PASS.
