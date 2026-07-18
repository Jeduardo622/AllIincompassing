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
- blocked checks:
  - hosted correction proof: requires the open PR's managed Supabase preview identifiers before dispatch
  - generic hosted Playwright completion: configured hosted super-admin credential is currently invalid
- result: `pass-with-blocked-checks` for PR submission; not merge-ready until hosted proof and live required checks pass
- residual risk: the migration and browser proof still require hosted preview execution, and critical-lane human review remains mandatory before merge.

## PR Hygiene

- branch-ready: yes (`codex/return-bt-correction`)
- linear-ready: yes (`WIN-224`)
- protected-path drift: none beyond the routed migration, auth role gate, and hosted-proof workflow
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes for human review; no for merge until hosted proof and live checks pass
- required follow-up:
  - push the branch and open the PR
  - bind the exact managed Supabase preview identifiers to the protected workflow variables
  - dispatch and retain the hosted BT -> BCBA -> BT -> BCBA proof
  - inspect live required checks and obtain human approval before merge

## Handoff Summary

WIN-224 adds an append-only correction lifecycle to supervision review: the assigned BCBA can return a signed BT packet with a reason, the original exact BT creates a newly attested amendment, and the same BCBA reviews the full version chain and completes the request. Tenant, actor, assignment, role, and immutable-version boundaries are enforced in server-side RPCs and mirrored fail-closed in the dashboard. Local schema, SQL smoke, focused tests, policy, coverage, tenant, build, and Tier-0 route gates pass; the remaining closure work is the managed-preview browser proof, live CI, and mandatory human review.
