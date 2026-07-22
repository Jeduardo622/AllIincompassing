# WIN-240 Session Capture Authorization Fix Handoff

- Status: implemented and locally verified; critical-lane human review required before merge
- Classification: high-risk human-reviewed
- Lane: critical
- Branch: `codex/session-capture-authorization-fix`
- Linear: `WIN-240`
- Scope: resolve billing for an exact assigned BT's existing session without granting ambient authorization-table visibility
- Non-goals: no general authorization RLS widening, generic BT billing listing, Schedule redesign, billing-policy change, or unrelated cleanup

## Diagnosis

`SessionModal` directly queried `authorizations`. Exact BT users can capture data for assigned clients but intentionally cannot browse authorization rows, so the query returned no usable billing default and the modal exited before `/api/session-notes/upsert`. Hosted read-only evidence confirmed that the affected client has approved authorization rows.

## Implemented design

`public.resolve_assigned_bt_session_capture_billing(p_session_id uuid)` is an authenticated, fixed-search-path `SECURITY DEFINER` resolver. It verifies the current organization, exact BT role, active BT/RBT therapist assignment, actor/link ownership, and capture capability. It derives canonical authorization/service/strict-billing values and the persisted session client/therapist bindings. The modal uses it only for existing `dataCollectionOnly` sessions; the server uses it only for the assigned-BT legacy branch and rejects caller client/therapist mismatches before any write. BCBA and existing non-BT paths retain their prior authorization lookup behavior.

The migration revokes execution from `public` and `anon`, grants only `authenticated`, does not change table RLS, and reloads the PostgREST schema.

## Review evidence

- Code review: approved after adding the BCBA legacy-path regression and excluding BCBA from the assigned-BT branch.
- Security review: approved after binding assigned-BT writes to the resolver's canonical session client and therapist, including zero-trial-event mismatch tests.
- Supabase review: approved after adding the PostgREST schema reload; no tenant-boundary or grant finding remains.
- Test-engineer review: approved; the only mandatory unexecuted browser proof is credential-blocked.

## Verification card

- Lane: `critical`
- Required checks: focused resolver/modal/server regressions; policy; lint; typecheck; full test suite; coverage; tenant validation; build; Tier-0 routes; credentialed auth/session browser smoke; migration/PostgREST smoke when a database is available.
- Executed checks:
  - Focused seven-file Vitest union: PASS, 7 files / 231 tests.
  - `npm run ci:check-focused`: PASS. DB-backed grant/preview checks skipped because no database URL is configured; branch-protection check skipped outside CI.
  - `npm run lint`: PASS.
  - `npm run typecheck`: PASS.
  - `npm run validate:tenant`: PASS.
  - `npm run build`: PASS.
  - `npm run test:routes:tier0`: PASS, 7 specs / 220 tests.
  - `npm run ci:verify-coverage`: PASS, 92.71% line coverage against 86% threshold.
- Blocked or non-green checks:
  - `npm run test:ci`: NOT GREEN. It reproduced the clean-main workflow-contract failure in `tests/workflows/bt-aba-disposable-browser-proof.test.ts`, the Node 24 `blob.text is not a function` failure in `src/lib/__tests__/supabase.edge.test.ts`, and an unhandled coverage temporary-file `ENOENT`. The focused WIN-240 tests passed within the run.
  - `npm run ci:playwright`: BLOCKED at preflight because neither the super-admin nor admin Playwright credential pair is configured.
  - Local/dev migration apply plus immediate PostgREST RPC smoke: BLOCKED because no local/dev database URL or linked test project is configured. Static migration governance, grant checks, contract tests, and tenant validation passed.
  - `npm run verify:local`: not rerun as a wrapper because its `test:ci` constituent deterministically stops on the documented baseline failures; every reachable constituent was executed separately.
- Result: review-ready, not merge-ready. Human approval and hosted CI/migration smoke remain mandatory.
- Residual risk: hosted migration/schema-cache behavior and the credentialed assigned-BT end-to-end save require CI or a safe dev project; no production migration was applied in this task.

## PR hygiene verdict

- `pr-ready: yes` for critical-lane human review.
- Branch is isolated, exactly aligned with `origin/main` before the WIN-240 commit, and contains only the bounded client/server/migration/tests/plan/handoff surfaces.
- `git diff --check` passed; no generated coverage/build artifacts or unrelated worktree files are included.
- Merge remains blocked on human approval plus hosted CI and credentialed/migration smoke evidence.

## Baseline note

`npm ci` passed in the isolated worktree. The two product-test failures above were reproduced on clean `origin/main` before WIN-240 edits and are not introduced by this branch.
