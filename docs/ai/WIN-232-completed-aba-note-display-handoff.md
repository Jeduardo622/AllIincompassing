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
- Add a protected hosted-proof follow-up that validates the exact approved PR head, binds to the matching managed Supabase preview branch, provisions only marker-owned synthetic BT fixtures, and captures a deterministic read-only ABA completed-note screenshot artifact.
- Preserve the older WIN-224 managed preview proof path only for its exact approved branch while adding the WIN-232 completed-note proof path behind exact branch validation.

## Non-goals

- No changes to session-note writes, finalization RPC behavior, RLS policies, roles, or table grants.
- No changes to scheduled or in-progress capture behavior.
- No application-code production deployment from this task; merge and deployment remain human-reviewed.
- No production Supabase proof, paid preview-branch creation, or widening of artifact uploads beyond redacted public evidence.

## Verification

- PASS: targeted component, cache-invalidation, migration-contract, and correction-workflow suites, 159 tests.
- PASS: `npm run ci:check-focused`.
- PASS: `npm run lint`.
- PASS: `npm run typecheck`.
- PASS: `npm run validate:tenant`.
- PASS: `npm run test:routes:tier0`, 220 Cypress checks.
- PASS: `completed_aba_note.cy.ts`, 1 synthetic browser check with screenshot evidence of populated read-only responses.
- PASS: `npm run build`.
- PASS: authorized hosted migration application to Supabase project `wnnjeqheqxxyrgsjmygy`; the ledger records version `20260721172928` with logical name `bt_aba_completed_note_latest_amendment`.
- PASS: hosted RPC contract verification confirmed the function exists, `anon` execute is denied, `authenticated` and `service_role` execute are allowed, and the latest-amendment query remains scoped to the original BT note.
- PASS: hosted Supabase security/performance advisors completed. The RPC warning reflects its intentional authenticated `security definer` API surface protected by exact-BT and organization checks; amendment-table index advisories pre-date and are outside this bounded function replacement.
- FAIL, unrelated baseline: `npm run test:ci` completed with 3,101 passing and 3 failing tests in the PDF Blob test, CI workflow contract fixture, and IEHP Supabase config newline assertion. None of those files are changed by WIN-232.
- PASS: hosted privileged-function existence and execute-grant checks via the Supabase plugin; local preview-drift checks still require `SUPABASE_DB_URL`.
- BLOCKED: hosted `npm run ci:playwright` preflight passed, but auth stopped on invalid configured smoke credentials.
- PASS: `node .\\node_modules\\vitest\\vitest.mjs run tests/scripts/playwright-bt-aba-response.test.ts tests/scripts/bt-aba-disposable-branch.test.ts tests/workflows/bt-aba-disposable-browser-proof.test.ts tests/scripts/provision-ci-smoke-bt-aba.test.ts` completed with 59 passing tests after fixing managed-preview discovery and restoring the exact WIN-224 conditional proof path.
- PASS: `npm run ci:check-focused`.
- PASS: `npm run lint`.
- PASS: `npm run typecheck`.
- PASS: `npm run validate:tenant`.
- PASS: `npm run build`.
- FAIL, unrelated/local baseline: `npm run test:ci` still fails outside WIN-232 scope in `src/lib/__tests__/supabase.edge.test.ts` (`blob.text is not a function`) and `tests/ci/check-e2e-reliability-gates.test.ts` (BCBA provisioning contract fixture drift), then terminates with an additional local coverage write error `EPERM: operation not permitted, open 'coverage/.tmp/coverage-56.json'`.
- BLOCKED, local harness: `npm run test:routes:tier0` first failed on a stale `scripts/run-cypress.ts` listener holding `127.0.0.1:4173`; after terminating the orphaned Node preview process, a clean rerun still exited non-zero without preserved Cypress failure detail in this shell.
- BLOCKED, hosted credentials: `npm run ci:playwright` on Tuesday, July 21, 2026 passed `playwright:preflight` and then failed `playwright:auth` with `Invalid email or password. Please check your credentials and try again.` Screenshot: `artifacts/latest/playwright-auth-smoke-failure-1784680377451.png`.

## Residual Risk

- Hosted end-to-end proof of the application-code follow-up remains blocked until the critical PR is reviewed, merged, and deployed; the current screenshot uses synthetic, redacted browser fixtures.
- The hosted RPC and grants are verified, but a real assigned-BT completed-session visual check is still required after deployment without exposing PHI.
- The new hosted-proof workflow is still unexecuted on GitHub until the follow-up branch is pushed and a managed Supabase preview branch for that exact PR head is available.
- Local Tier-0 and local hosted-auth smoke remain non-authoritative because one is blocked by the local preview harness and the other by invalid configured smoke credentials.

## Route Task

- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Triggering paths: `supabase/migrations/**` replacement of the `security definer` assigned-BT read RPC, plus session finalization cache and read-only clinical display behavior.
- Protected path: `supabase/migrations/20260721165120_bt_aba_completed_note_latest_amendment.sql`.
- Tenant boundary: unchanged exact-BT and organization authorization; request lookup is scoped by session, organization, client, and BT therapist; amendment lookup is scoped by request, organization, and original note.
- Required agents: software architect, security engineer, Supabase reviewer, test engineer, and code reviewer. Security and Supabase review approved the implemented diff with no findings; human Supabase/security review remains mandatory before merge.
- Linear: WIN-232 is linked to PR #826.

### Hosted-proof follow-up route

- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Triggering paths: `.github/workflows/bt-aba-disposable-browser-proof.yml`, `scripts/lib/bt-aba-disposable-branch.ts`, `scripts/playwright-bt-aba-session-note.ts`, and synthetic proof provisioner/contract tests.
- Protected paths: `.github/workflows/**` and secret-bearing preview orchestration scripts.
- Allowed surfaces: exact PR-head validation, managed-preview discovery, synthetic BT fixture provisioning/cleanup, redacted artifact capture, and bounded tests for those flows.
- Non-goals: no production deploy, no production Supabase access, no new secrets, no widening of branch allowlists beyond the two explicitly approved PR branches.

## Verification Card

- Classification: `high-risk human-reviewed`.
- Lane: `critical`.
- Change type: privileged RPC read resolution, UI cache/read-only behavior, component tests, migration contract, and SQL smoke contract.
- Required checks: focused tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run build`, `npm run test:routes:tier0`, `npm run ci:playwright`, and `npm run verify:local` when locally meaningful.
- Executed checks: original WIN-232 focused tests PASS (159); hosted-proof focused workflow/script tests PASS (59); policy PASS; lint PASS; typecheck PASS; tenant validation PASS; build PASS.
- Blocked checks: `npm run test:ci` still fails in unrelated baseline areas and local coverage write cleanup; `npm run test:routes:tier0` remains blocked by local preview-harness instability around `127.0.0.1:4173`; `npm run ci:playwright` is blocked by invalid hosted smoke credentials; local preview-drift checks require `SUPABASE_DB_URL`; `npm run verify:local` cannot complete while `test:ci` and `test:routes:tier0` are not green.
- Result: `pass-with-blocked-checks`.
- Residual risk: human review, follow-up branch CI, and one executed hosted managed-preview proof run are still required before the new screenshot workflow can be treated as complete evidence.

## PR Hygiene

- PR-ready: yes for a follow-up critical review PR after this evidence update is pushed; merge remains human-blocked.
- Branch-ready: yes, `codex/win-232-hosted-visual-proof`.
- Linear-ready: yes, WIN-232.
- Single-purpose: yes.
- Unrelated changes: none in the tracked diff; pre-existing untracked workspace files are excluded.
- Generated artifact drift: none.
- Protected-path scope: protected GitHub workflow orchestration plus synthetic preview helpers only; no new migrations, RLS changes, or table-grant changes in this follow-up.
- Reviewers: software architecture, devops, security, Supabase, test, and code review are required; human review remains mandatory because `.github/workflows/**` changed.
