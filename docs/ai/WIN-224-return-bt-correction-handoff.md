# WIN-224 Return-to-BT Correction Workflow Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the bounded workflow changes a clinical record lifecycle, database schema, RLS/grants/RPC authorization, exact-role routing, and a secret-bearing hosted proof workflow.
- triggering paths:
  - `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`
  - `supabase/migrations/20260719000630_align_bt_correction_signature_limits.sql`
  - `supabase/migrations/20260718204735_allow_exact_bt_proof_history_cleanup.sql`
  - `supabase/migrations/20260718210522_grant_service_role_app_schema_usage.sql`
  - `supabase/migrations/20260718210937_preserve_service_role_cleanup_context.sql`
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
  - `src/components/session-notes/BtCorrectionSnapshotFields.tsx`
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
- reviewer: completed; second-pass code, security, and Supabase reviews approved the Codex review fixes with no required fixes

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
  - Codex review regression suite (`Dashboard.noFallback` plus migration contract): pass, 41/41
  - malformed immutable snapshot fail-closed and undeclared-key stripping coverage: pass
  - inactive conditional snapshot omission coverage: pass; optional fields omitted by the signed packet remain absent, while missing active conditional fields still fail closed
  - alternate hosted constraint-name transactional proof: pass; catalog discovery removed the renamed legacy cap inside `ROLLBACK`
  - local forward migration execution: pass and idempotent
  - Supabase plugin migration `align_bt_correction_signature_limits`: applied successfully to the linked production project
  - hosted SQL verification: pass for method-aware constraint, typed/drawn RPC bounds, empty `search_path`, and execute grants
  - `npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts`: pass, 13/13
  - related supervision/BT migration suite: pass, 49/49
  - focused correction feature suite: pass, 161/161 across 13 files
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
  - `npm run test:ci`: 3028/3035 passed; fail locally on the known Windows CRLF-sensitive workflow-step parser and bundled jsdom Blob `.text()` behavior; the unrelated Programs/Goals order-sensitive failure passed 98/98 in isolation
  - `npm run verify:local`: fail at the same local `test:ci` stage; later steps were separately executed and passed
  - `npm run ci:playwright`: fail at hosted auth login because the configured super-admin credential was rejected
  - hosted managed-preview proof run `29661369019`: pass on exact commit `7f95b7c5fb05d4c5ec928df0b7d4c66919e3cecd`
  - hosted BT -> BCBA -> BT -> BCBA browser lifecycle: pass, including return reason, correction task, immutable version history, re-attestation, resubmission, and final completion
  - hosted exact cleanup and post-proof preview health: pass; marker-owned BT/BCBA fixtures were removed and the managed preview remained healthy
  - exact-head hosted proof run `29667036513`: browser lifecycle failed before resubmission because the editor rejected a legitimately omitted inactive conditional snapshot field; cleanup and preview health passed
  - exact-head hosted proof runs `29667271826` and `29667416184`: the corrected BT form rendered successfully, but the proof retained a canonical display-label locator that is incompatible with immutable organization-specific snapshot labels; cleanup and preview health passed
  - local regression fixes for those proof failures: correction suite 41/41 and combined review/proof suite 47/47, lint, typecheck, and build pass; proof now targets the stable snapshot field key and replacement exact-head hosted proof is pending
- blocked checks:
  - generic hosted Playwright completion: configured hosted super-admin credential is currently invalid
- result: `pending-hosted-reproof`; the review fixes and hosted migration boundary checks pass, but the exact-head lifecycle must be rerun after the inactive-conditional-field regression fix
- residual risk: schema/RPC authorization and clinical versioning remain critical-path changes; human review is mandatory before merge.

## PR Hygiene

- branch-ready: yes (`codex/return-bt-correction`)
- linear-ready: yes (`WIN-224`)
- protected-path drift: none beyond the routed migration, auth role gate, and hosted-proof workflow
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: pending replacement exact-head hosted proof and CI; keep draft and unmerged until those checks and the mandatory critical-lane approval are complete
- required follow-up:
  - push the Codex review fixes, rerun exact-head hosted proof and required checks, resolve both review threads, and obtain human approval before merge

## Handoff Summary

WIN-224 adds an append-only correction lifecycle to supervision review: the assigned BCBA can return a signed BT packet with a reason, the original exact BT creates a newly attested amendment, and the same BCBA reviews the full version chain and completes the request. The Codex review follow-up preserves immutable template snapshots, fails closed on malformed history, strips undeclared keys before resubmission, and aligns drawn-signature storage with the existing 20,000-character closeout contract through a forward-only migration. The hosted migration and SQL boundary checks pass; rerun the browser proof and required CI checks on the new PR head before human merge review.
