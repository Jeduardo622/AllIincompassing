# WIN-224 Task 1B Report

- Status: DONE_WITH_CONCERNS
- Issue: WIN-224
- Branch: codex/return-bt-correction
- Date: July 18, 2026

## Route Task

- classification: high-risk human-reviewed
- lane: critical
- why: bounded protected-path work in `supabase/migrations/**` that changes RLS, grants, RPC exposure, tenant scoping, and correction/completion workflow state.
- triggering paths:
  - `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`
  - `tests/supervisionCorrectionWorkflowMigration.test.ts`
  - `tests/sql/bt_aba_session_note_closeout_smoke.sql`
- linear required: yes via `WIN-224`

## Owned Scope

- Implemented only:
  - `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`
  - `tests/supervisionCorrectionWorkflowMigration.test.ts`
  - `tests/sql/bt_aba_session_note_closeout_smoke.sql`
- Did not edit app code, docs, workflows, or apply hosted migrations.

## RED Evidence

- Expanded `tests/supervisionCorrectionWorkflowMigration.test.ts` first with executable-RPC assertions for:
  - assigned-BCBA-only return
  - original-BT-only correction inbox
  - amendment-aware resubmission validation and monotonic versioning
  - correction-aware packet/completion rewrites
  - role-safe action-count RPC
- Command:
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`
- Result before implementation:
  - FAIL, `7` tests failed on July 18, 2026 because the migration still had staged `0A000` RPC bodies and no packet/completion/count rewrite.

## Implementation Summary

- Replaced the staged migration shells with real `security definer` RPC bodies using `set search_path = ''` and fully qualified object references.
- Implemented:
  - `public.return_supervision_session_note_request_to_bt`
  - `public.get_bt_supervision_correction_tasks`
  - `public.resubmit_bt_supervision_correction`
  - correction-aware `public.get_pending_supervision_review_packets`
  - correction-aware `public.complete_supervision_session_note_request`
  - new `public.get_supervision_session_note_action_count`
- Preserved append-only behavior:
  - original BT note and attestation remain immutable version 1
  - amendments append monotonic version 2/3+
  - correction rows resolve atomically to their amendment
  - request assignment/session/original note are not rewritten during correction rounds
- Extended the transactional SQL smoke fixture with:
  - assigned/foreign BCBA denial
  - original/foreign BT visibility and resubmission checks
  - correction round 1 and round 2 to version 2 and version 3
  - original version immutability checks
  - assignment stability checks
  - latest-version BCBA completion

## GREEN Evidence

- Command:
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`
- Result:
  - PASS, `13` tests passed on July 18, 2026.

- Command:
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts tests/bcbaSupervisionReviewWorkflowMigration.test.ts tests/supervisionRequestLifecycleMigration.test.ts tests/supervisionSessionNoteWorkflowMigration.test.ts tests/btAbaSessionNoteMigration.test.ts`
- Result:
  - PASS, `5` files and `49` tests passed on July 18, 2026.

- Command:
  - `npm run ci:check-focused`
- Result:
  - PASS on July 18, 2026 from the normal pre-commit hook path.
  - Expected skips remained limited to missing local DB-backed or CI-only inputs:
    - privileged function DB grant check without `SUPABASE_DB_URL`
    - Supabase function auth parity when disabled locally
    - sensitive-table RLS overlap without a database connection string
    - Supabase preview drift without `SUPABASE_DB_URL`

## Live SQL Smoke Limitation

- Attempted command:
  - `npx supabase status`
- Result:
  - FAIL on the first pass because the local `supabase_db_AllIincompassing` container was not running.

- Command:
  - `npx supabase db reset`
- Result:
  - PASS on July 18, 2026 after the migration fixes landed.
  - The local reset now applies `20260718155154_return_bt_supervision_correction.sql` cleanly through seed and container restart.

## July 18, 2026 Follow-up

- Added a targeted contract guard for the packet RPC replacement sequence:
  - revoke old execute grants
  - `drop function if exists public.get_pending_supervision_review_packets()`
  - recreate with the corrected `returns table` shape
  - regrant authenticated execute
- Kept the approved admin-family packet read fallback intact.
  - Admin-family users still retain operational read visibility through `get_pending_supervision_review_packets()`.
  - `can_return` and `can_complete` remain false unless the caller is the assigned exact BCBA.
- Extended the synthetic SQL smoke with a same-org pure admin user to prove:
  - packet read visibility is allowed
  - admin return is denied
  - admin completion is denied
- Follow-up command:
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`
- Follow-up result:
  - PASS, `13` tests passed on July 18, 2026.

- Added a targeted regression fix for the completion RPC replacement:
  - preserved the original named parameters on `public.complete_supervision_session_note_request`
  - removed the incompatible `$1/$2/$3` alias declarations that break live reset with `42P13 cannot change name of input parameter p_request_id`
  - tightened the migration contract test to require the named signature and reject alias-based parameter shims
- Follow-up command:
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`
- Follow-up result:
  - PASS, `13` tests passed on July 18, 2026.

- Upgraded the synthetic BT ABA smoke template fixture to the canonical finalize contract shape:
  - added field `type` metadata for multi-select, textarea, radio, boolean, text, and signature inputs
  - added canonical option sets and conditional companion fields required by finalize/resubmit validation
- Added DB-backed correction-path negatives inside the transactional smoke:
  - blank correction reason rejected
  - oversized correction reason rejected
  - malformed amendment response option rejected
  - malformed amendment response type rejected
  - invalid correction signature rejected
- Adjusted the transactional fixture to coexist with the legacy WIN-221/WIN-223 replay tail without weakening those assertions:
  - reused the auto-created correction request for session `00000000-0000-4000-8000-00000000b044` instead of inserting a duplicate request row
  - seeded a rollback-scoped synthetic supervision template for org `00000000-0000-4000-8000-00000000b001` so correction completion exercises the real supervision RPC contract
  - added a late synthetic active BCBA therapist/link (`00000000-0000-4000-8000-00000000b018`) so peer-BCBA denial/count checks stay intact earlier in the smoke while the legacy schedule-authority replay path still resolves one linked BCBA near the tail
- Live verification commands after patch:
  - `npx supabase db reset`
  - `Get-Content tests/sql/bt_aba_session_note_closeout_smoke.sql -Raw | docker exec -i supabase_db_AllIincompassing psql -U postgres -d postgres -v ON_ERROR_STOP=1`
- Live verification results:
  - PASS, local reset completed on July 18, 2026.
  - PASS, the transactional SQL smoke executed through `ROLLBACK` on July 18, 2026.

## Self-Review

- Checked that every new authenticated RPC:
  - derives org scope from `auth.uid()`
  - uses exact-role checks instead of broader role helpers where the design requires exact BT/BCBA authority
  - keeps `PUBLIC`/`anon` revoked
  - grants authenticated execute only after real bodies exist
- Checked that the SQL smoke additions stay synthetic and rollback-scoped.
- Checked that the migration does not touch app/docs/workflow files outside the assigned scope.

## Concerns

- The static migration and SQL-contract suite is green, but the live local reset/smoke path is not re-run after the composite-index ordering fix.
- The migration diff is large because Task 1B owns the full protected RPC/body/smoke slice inside one file.
- The correction-aware packet RPC now returns additional columns; the app-layer consumer changes still belong to later WIN-224 tasks.

## Suggested Next Commands

1. Reuse the same local reset + smoke sequence if later WIN-224 tasks change request lifecycle or correction review behavior.
2. Keep the correction-path DB negatives in sync if the BT ABA or supervision template contracts change again.
3. `npm run ci:check-focused`
4. `npm run test:ci`
5. `npm run validate:tenant`
6. `npm run build`
