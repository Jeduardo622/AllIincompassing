# WIN-224 Task 1A Report

- Status: DONE_WITH_CONCERNS
- Issue: WIN-224
- Branch: codex/return-bt-correction

## Route Task

- classification: high-risk human-reviewed
- lane: critical
- why: bounded schema work under `supabase/migrations/**` changes request status constraints, tenant-scoped tables, RLS, grants, and staged RPC exposure.
- triggering paths:
  - `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`
  - `tests/supervisionCorrectionWorkflowMigration.test.ts`
- required agents:
  - `implementation-engineer`
  - `code-review-engineer`
- reviewer required: yes
- verify-change required: yes
- linear required: yes via `WIN-224`

## Scope

- Owned only the schema/state/RLS/grants/index portion of `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`.
- Adjusted `tests/supervisionCorrectionWorkflowMigration.test.ts` only to match the bounded recovery scope.
- Did not implement the new RPC bodies beyond staged fail-closed declarations.
- Did not edit SQL smoke files or app files.

## Implementation Summary

- Recreated the missing migration at the exact required path.
- Expanded `supervision_session_note_requests.status` to include `correction_required` and `resubmitted`.
- Added `public.supervision_session_note_corrections` and `public.bt_session_note_amendments` with:
  - monotonic round/version constraints
  - one-active-correction partial unique index
  - composite tenant/request/correction linkage FKs
  - all-or-none correction resolution metadata contract
  - service-role-only table access
- Added mutation guards:
  - amendments are immutable
  - corrections allow only the future resolution metadata transition
- Added staged `security definer` RPC declarations with `set search_path = ''` and no authenticated execute grants yet.

## Verification Card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type:
  - database/RLS/migrations/tenant isolation
- Required checks:
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`
  - `npm run ci:check-focused`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts` -> PASS
- Blocked checks:
  - `npm run ci:check-focused` -> not run in this bounded subtask; parent task still needs full critical-lane verification
  - `npm run test:ci` -> not run in this bounded subtask; parent task still needs full critical-lane verification
  - `npm run validate:tenant` -> not run in this bounded subtask; parent task still needs full critical-lane verification
  - `npm run build` -> not run in this bounded subtask; parent task still needs full critical-lane verification
  - `npm run verify:local` -> not run in this bounded subtask; parent task still needs full critical-lane verification
- Result: pass-with-blocked-checks
- Residual risk: RPC bodies, SQL smoke coverage, and full tenant verification remain for later tasks; this slice only establishes the protected schema contract and staged function shells.

## Review

- `code-review-engineer` re-review: no findings

## Files Changed

- `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`
- `tests/supervisionCorrectionWorkflowMigration.test.ts`

## Next Commands

1. `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`
2. `npm run ci:check-focused`
3. `npm run test:ci`
4. `npm run validate:tenant`
5. `npm run build`
6. `npm run verify:local`

## Follow-up Fix

- Review-requested lineage fix completed on July 18, 2026.
- `bt_session_note_amendments` now enforces one composite correction-lineage foreign key across `correction_id`, `request_id`, `organization_id`, and `correction_round`, removing the weaker separable request/round-only path.
- `supervision_session_note_corrections.resulting_amendment_id` now binds to the exact correction row via composite `(resulting_amendment_id, id) -> bt_session_note_amendments(id, correction_id)` identity, so it cannot reference an amendment from another correction.
- The contract test now asserts both wrong-round and wrong-correction cross-link rejection statically.

## Follow-up Commands And Output

- `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`
  - PASS: `1` file, `7` tests passed on July 18, 2026.
- `npm run ci:check-focused`
  - PASS: policy checks, API boundary checks, auth invariants, RLS policy coverage, migration governance, and repo hygiene all passed on July 18, 2026.
  - Expected skips: branch protection outside CI, privileged function DB grant check without `SUPABASE_DB_URL`, sensitive-table RLS overlap without DB connection string, Supabase preview drift without `SUPABASE_DB_URL`, Supabase function auth parity disabled locally.
