# WIN-232 Completed ABA Note Display Handoff

## Scope

- Load the existing authorized BT ABA note state when an assigned BT opens a completed Schedule session.
- Render persisted finalized responses in the ABA note form as read-only.
- Validate completed responses against the finalization schema before rendering.
- Render goal labels from the persisted finalized note snapshot rather than the mutable goal catalog.
- Fail closed when completed-note data is missing, inconsistent, or unavailable.

## Non-goals

- No session-note write, finalization RPC, schema, migration, RLS, role, or tenant-boundary changes.
- No changes to scheduled or in-progress capture behavior.

## Verification

- PASS: targeted `SessionModal` and `BtAbaSessionNoteForm` suite, 110 tests.
- PASS: `npm run ci:check-focused`.
- PASS: `npm run lint`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:routes:tier0`, 220 Cypress checks.
- PASS: `completed_aba_note.cy.ts`, 1 synthetic browser check with screenshot evidence of populated read-only responses.
- PASS: `npm run build`.
- FAIL, unrelated baseline: `npm run test:ci` reported failures in the PDF Blob test, CI workflow contract fixture, and IEHP Supabase config newline assertion. None of those files are changed by WIN-232.

## Residual Risk

- Hosted end-to-end visual proof remains blocked until this branch is merged and deployed; the current screenshot uses synthetic, redacted browser fixtures.
- The read path remains constrained by the existing `get_bt_aba_session_note` assigned-BT authorization RPC.

## Route Task

- Classification: `low-risk autonomous`.
- Lane: `standard`.
- Triggering paths: `src/components/SessionModal.tsx`, `src/components/__tests__/SessionModal.test.tsx`.
- Protected-path drift: none.
- Required agents: specification/implementation completed in the primary task; `code-review-engineer` completed with no findings; `test-engineer` required.
- Linear: WIN-232 is linked to PR #826.

## Verification Card

- Classification: `low-risk autonomous`.
- Lane: `standard`.
- Change type: UI/component behavior and tests.
- Required checks: focused tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`, focused browser proof, and `npm run verify:local` when locally meaningful.
- Executed checks: focused tests PASS (110); policy PASS; lint PASS; typecheck PASS; build PASS; synthetic completed-note Cypress proof PASS (1).
- Blocked checks: `npm run test:ci` and `npm run verify:local` remain blocked by the previously recorded unrelated Node 24 baseline failures; Node 20 branch CI is authoritative.
- Result: `pass-with-blocked-checks` pending refreshed branch CI.
- Residual risk: hosted production proof remains pending merge/deployment; missing persisted goal snapshot labels intentionally render empty rather than drift to current catalog names.

## PR Hygiene

- PR-ready: yes after the review-fix commit is pushed and refreshed branch CI passes.
- Branch-ready: yes, `codex/win-232-completed-aba-note-display`.
- Linear-ready: yes, WIN-232.
- Single-purpose: yes.
- Unrelated changes: none in the tracked diff; pre-existing untracked workspace files are excluded.
- Generated artifact drift: none.
- Protected-path drift: none.
- Reviewer: completed with no findings.
