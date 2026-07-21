# WIN-232 Completed ABA Note Display Handoff

## Scope

- Load the existing authorized BT ABA note state when an assigned BT opens a completed Schedule session.
- Render persisted finalized responses in the ABA note form as read-only.
- Validate completed responses against the finalization schema before rendering.
- Render goal labels from the persisted finalized note snapshot rather than the mutable goal catalog.
- Fail closed when completed-note data is missing, inconsistent, or unavailable.
- Refresh the completed-note query cache immediately after successful finalization.
- Preserve the persisted unlinked-data choice when rendering a finalized note read-only.
- Resolve completed-note responses from the latest tenant-scoped correction amendment while preserving the original note ID and RPC contract.
- Invalidate the completed-note cache after BT correction resubmission and rehydrate an already-mounted read-only form when the amended response arrives.

## Non-goals

- No changes to session-note writes, finalization RPC behavior, RLS policies, roles, or table grants.
- No changes to scheduled or in-progress capture behavior.
- No production migration application from this task; deployment remains human-reviewed.

## Verification

- PASS: targeted component, cache-invalidation, migration-contract, and correction-workflow suites, 159 tests.
- PASS: `npm run ci:check-focused`.
- PASS: `npm run lint`.
- PASS: `npm run typecheck`.
- PASS: `npm run validate:tenant`.
- PASS: `npm run test:routes:tier0`, 220 Cypress checks.
- PASS: `completed_aba_note.cy.ts`, 1 synthetic browser check with screenshot evidence of populated read-only responses.
- PASS: `npm run build`.
- FAIL, unrelated baseline: `npm run test:ci` completed with 3,101 passing and 3 failing tests in the PDF Blob test, CI workflow contract fixture, and IEHP Supabase config newline assertion. None of those files are changed by WIN-232.
- BLOCKED: database-backed privileged-function grant and preview-drift checks require `SUPABASE_DB_URL`; static grant, RLS, migration-governance, and tenant checks passed.
- BLOCKED: hosted `npm run ci:playwright` preflight passed, but auth stopped on invalid configured smoke credentials.

## Residual Risk

- Hosted end-to-end proof of this follow-up remains blocked until the critical migration is reviewed, merged, and deployed; the current screenshot uses synthetic, redacted browser fixtures.
- Database execution of the SQL smoke was not available locally without a configured database URL; static migration and smoke contracts passed.

## Route Task

- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Triggering paths: `supabase/migrations/**` replacement of the `security definer` assigned-BT read RPC, plus session finalization cache and read-only clinical display behavior.
- Protected path: `supabase/migrations/20260721165120_bt_aba_completed_note_latest_amendment.sql`.
- Tenant boundary: unchanged exact-BT and organization authorization; request lookup is scoped by session, organization, client, and BT therapist; amendment lookup is scoped by request, organization, and original note.
- Required agents: software architect, security engineer, Supabase reviewer, test engineer, and code reviewer. Security and Supabase review approved the implemented diff with no findings; human Supabase/security review remains mandatory before merge.
- Linear: WIN-232 is linked to PR #826.

## Verification Card

- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Change type: privileged RPC read resolution, UI cache/read-only behavior, component tests, migration contract, and SQL smoke contract.
- Required checks: focused tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run build`, `npm run test:routes:tier0`, `npm run ci:playwright`, and `npm run verify:local` when locally meaningful.
- Executed checks: focused tests PASS (159); policy PASS; lint PASS; typecheck PASS; tenant validation PASS; build PASS; Tier-0 routes PASS (220); synthetic completed-note Cypress proof PASS (1).
- Blocked checks: `npm run test:ci` has 3 unrelated local baseline failures; `npm run ci:playwright` is blocked by invalid hosted smoke credentials; DB-backed grant/drift checks require `SUPABASE_DB_URL`; `npm run verify:local` cannot complete while `test:ci` is red.
- Result: `pass-with-blocked-checks` pending refreshed branch CI.
- Residual risk: human review and hosted deployment are required before the latest-amendment read can be visually proven in production.

## PR Hygiene

- PR-ready: yes after the critical review-fix commit is pushed and refreshed branch CI passes; merge remains human-blocked.
- Branch-ready: yes, `codex/win-232-completed-aba-note-display`.
- Linear-ready: yes, WIN-232.
- Single-purpose: yes.
- Unrelated changes: none in the tracked diff; pre-existing untracked workspace files are excluded.
- Generated artifact drift: none.
- Protected-path scope: one forward migration replacing only `get_bt_aba_session_note(uuid)`; no RLS/table-grant changes.
- Reviewers: security and Supabase approved with no findings; code review findings were limited to updating this critical-lane evidence and committing the migration with its tests.
