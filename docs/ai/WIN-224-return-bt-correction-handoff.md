# WIN-224 Return-to-BT Correction Workflow Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the bounded workflow changes a clinical record lifecycle, database schema, RLS/grants/RPC authorization, exact-role routing, and a secret-bearing hosted proof workflow.
- triggering paths:
  - `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`
  - `src/lib/authStubSession.ts`
  - `.github/workflows/bt-aba-disposable-browser-proof.yml`
  - tenant-sensitive supervision adapters and dashboard surfaces

## Scope

- task intent: allow the assigned BCBA to return a signed BT note with a required reason, preserve immutable prior versions, let only the original exact BT amend/re-attest/resubmit, and let the same assigned BCBA complete review.
- files touched:
  - `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`
  - `src/lib/supervision-session-notes.ts`
  - `src/lib/authStubSession.ts`
  - `src/App.tsx`
  - `src/pages/Dashboard.tsx`
  - `src/components/Sidebar.tsx`
  - focused unit, migration, SQL smoke, route, workflow, and browser-proof tests
  - `.github/workflows/bt-aba-disposable-browser-proof.yml`
  - `scripts/playwright-supervision-correction.ts`
  - `scripts/ci/select-browser-checks.mjs`
  - `package.json`
  - design, plan, and task reports for WIN-224
- non-goals: notifications, analytics, PDF export changes, staffing/reassignment, and general dashboard redesign.
- single-purpose diff: yes

## Required Agents

- required sequence: specification-engineer, software-architect, implementation-engineer, code-review-engineer, test-engineer, security-engineer
- agents used: specification, architecture, implementation, test planning, code review, Supabase review, security review, and CI/workflow review
- reviewer: completed; final exact-role review approved with no required fixes

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - focused unit/migration/workflow tests
  - `npm run test:ci`
  - `npm run ci:verify-coverage`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
  - `npx supabase db reset`
  - transactional SQL smoke through `ROLLBACK`
  - hosted BT -> BCBA -> BT -> BCBA correction proof on the managed PR preview
- executed checks:
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`: pass, 13/13
  - related supervision/BT migration suite: pass, 49/49
  - focused correction feature suite: pass, 123/123
  - correction workflow/selector/proof contract suite: pass, 21/21
  - exact-role auth/navigation suite: pass, 65/65
  - `npm test -- tests/btAbaSessionNoteMigration.test.ts`: pass, 11/11
  - `npx supabase db reset`: pass
  - transactional `tests/sql/bt_aba_session_note_closeout_smoke.sql`: pass through `ROLLBACK`
  - `npm run ci:check-focused`: pass; DB-backed checks skipped without a local DB URL
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run ci:verify-coverage`: pass; line coverage 92.69% against 86% floor
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:routes:tier0`: pass, 220/220
  - `npm run test:ci`: fail locally after correction tests passed; remaining failures are the Windows workflow-step parser and Blob `.text()` environment behavior
  - `npm run verify:local`: fail at the same local `test:ci` stage; later steps were separately executed and passed
  - `npm run ci:playwright`: fail at hosted auth login because the configured super-admin credential was rejected
  - hosted managed-preview proof provisioning and exact cleanup: pass; marker-owned BT and BCBA fixtures were removed after every attempt and the managed preview remained healthy
  - hosted direct BCBA packet preflight: pass; the assigned packet was returned to the synthetic BCBA before browser navigation
  - hosted browser RPC trace: pass for `get_supervision_session_note_action_count` (`200`, count `1`); the dashboard packet RPC was not issued
- blocked checks:
  - hosted correction proof: blocked in the dashboard query lifecycle before `get_pending_supervision_review_packets`; exact-head run `29659442930` timed out waiting for `Pending Review` even though the same canonical Supabase client returned action count `1` and direct packet preflight found the assigned request
  - generic hosted Playwright completion: configured hosted super-admin credential is currently invalid
- result: `blocked` for merge; the draft PR is not review-ready until the hosted dashboard query-lifecycle blocker is resolved and the full BT -> BCBA -> BT -> BCBA proof passes
- residual risk: the clinical workflow is locally verified, but the hosted dashboard has not yet rendered the assigned packet or exercised the correction/resubmission/completion UI path; critical-lane human review remains mandatory before merge.

## PR Hygiene

- branch-ready: yes (`codex/return-bt-correction`)
- linear-ready: yes (`WIN-224`)
- protected-path drift: none beyond the routed migration, auth role gate, and hosted-proof workflow
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: no; keep draft while the hosted dashboard query-lifecycle blocker remains
- required follow-up:
  - diagnose why the Dashboard packet query is not issued while the Sidebar count query succeeds on the same authenticated canonical client; do not add another hydration-gate patch without addressing the broader query lifecycle
  - rerun and retain the hosted BT -> BCBA -> BT -> BCBA proof after that root cause is fixed
  - inspect live required checks and obtain human approval before merge

## Handoff Summary

WIN-224 adds an append-only correction lifecycle to supervision review: the assigned BCBA can return a signed BT packet with a reason, the original exact BT creates a newly attested amendment, and the same BCBA reviews the full version chain and completes the request. Tenant, actor, assignment, role, and immutable-version boundaries are enforced in server-side RPCs and mirrored fail-closed in the dashboard. Local schema, SQL smoke, focused tests, policy, coverage, tenant, build, and Tier-0 route gates pass. The managed preview, exact synthetic provisioning, direct BCBA packet preflight, cleanup, and post-proof health checks also pass, but the browser dashboard does not issue the packet RPC and therefore cannot yet prove the full lifecycle. Keep PR #819 draft and unmerged until that query-lifecycle blocker is fixed, the hosted proof is green, live checks are clean, and human review is complete.
