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

## Live SQL Smoke Limitation

- Attempted command:
  - `npx supabase status`
- Result:
  - FAIL, the local `supabase_db_AllIincompassing` container was not running.

- Attempted command:
  - `npx supabase db reset`
- Result:
  - FAIL during migration application on July 18, 2026.
  - First live blocker observed:
    - `ERROR: there is no unique constraint matching given keys for referenced table "supervision_session_note_requests" (SQLSTATE 42830)`
- Follow-up applied after the failed reset:
  - moved the `(id, organization_id)` unique indexes for `supervision_session_note_requests` and `client_session_notes` before the new correction/amendment tables so the composite foreign keys can resolve during migration creation.
- Not rerun live after that fix because the parent handoff requested conclusion after the current focused hook.

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

1. `npx supabase db reset`
2. Run the transactional SQL smoke against the reset local database.
3. `npm run ci:check-focused`
4. `npm run test:ci`
5. `npm run validate:tenant`
6. `npm run build`
