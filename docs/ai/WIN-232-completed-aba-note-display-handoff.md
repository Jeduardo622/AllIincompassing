# WIN-232 Completed ABA Note Display Handoff

## Scope

- Load the existing authorized BT ABA note state when an assigned BT opens a completed Schedule session.
- Render persisted finalized responses in the ABA note form as read-only.
- Fail closed when completed-note data is missing, inconsistent, or unavailable.

## Non-goals

- No session-note write, finalization RPC, schema, migration, RLS, role, or tenant-boundary changes.
- No changes to scheduled or in-progress capture behavior.

## Verification

- PASS: targeted `SessionModal` and `BtAbaSessionNoteForm` suite, 108 tests.
- PASS: `npm run ci:check-focused`.
- PASS: `npm run lint`.
- PASS: `npm run typecheck`.
- PASS: `npm run test:routes:tier0`, 220 Cypress checks.
- PASS: `npm run build`.
- FAIL, unrelated baseline: `npm run test:ci` reported failures in the PDF Blob test, CI workflow contract fixture, and IEHP Supabase config newline assertion. None of those files are changed by WIN-232.

## Residual Risk

- Hosted visual proof requires deployment of this branch and a clearly synthetic completed BT ABA session.
- The read path remains constrained by the existing `get_bt_aba_session_note` assigned-BT authorization RPC.
