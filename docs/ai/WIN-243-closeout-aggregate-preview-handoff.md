# WIN-243 Closeout Aggregate Preview Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: the fix is limited to frontend closeout preview derivation and targeted component tests
- triggering paths: `src/components/SessionModal.tsx`, `src/components/__tests__/SessionModal.test.tsx`
- branch: `codex/win-243-closeout-aggregate-preview-final`
- PR: `#839` (replacement for `#838`, whose synchronized head stopped emitting required GitHub Actions checks)
- Linear: `WIN-243`

## Scope

- task intent: show stored quantitative legacy goal measurements in the BT ABA Daily Summary when no raw trial-event rows exist
- allowed files: `src/components/SessionModal.tsx`, `src/components/__tests__/SessionModal.test.tsx`, this handoff
- representation rule: preserve each aggregate measurement as an aggregate preview row; do not invent individual raw trials
- precedence rule: raw trial events remain one-for-one and suppress duplicate aggregate preview rows for the same goal/target
- non-goals: no server, Supabase, RPC, RLS, grant, capture-persistence, finalization, or session-status changes
- stop condition: re-route before touching `src/server/**`, `supabase/**`, auth, runtime config, CI, or deploy surfaces

## Evidence

- synthetic session: `862ded50-9b5c-4411-bdf6-3e3439c7c79d`
- live symptom: Daily Summary displayed `0 collected data points`
- hosted note evidence: `goal_measurements` stored `metric_value: 2` with verbal/full prompt counts
- hosted trial evidence: the session had zero `trial_events` rows
- root cause: `closeoutDataPoints` currently derives only from raw trial events
- screenshot: `.tmp/live-audit-evidence-2026-07-23/04-session-capture-saved-closeout-data-missing.png`

## Corrected Audit Finding

The earlier suspected scheduling/finalization assignment mismatch was not a product defect. `app.current_user_has_assigned_client` intentionally accepts the session's assigned therapist in addition to `client_therapist_links`, and adding a synthetic link did not resolve the observed 403. The missing BT template binding was the actual finalization failure and was fixed by WIN-242.

## Required Agents

- required sequence: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- agents used: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- reviewer: completed; the first review found overly broad same-goal aggregate suppression and stale restored-draft input risk
- PR review: found that normalized preview state could replace historical persisted measurements and that completed aggregate-only sessions did not hydrate the preview
- follow-up PR review: found that aggregate rows containing only `incorrect_trials` or `opportunities` were still omitted when `metric_value` was null
- final-head PR review: found that completed sessions still used current-target-filtered form measurements and that archived targetless goals could display a raw UUID instead of the finalized snapshot label
- subsequent PR review: found zero-correct prompt aggregates hid incorrect outcomes, metadata-only target rows suppressed valid top-level values, and archived raw targets could duplicate a human-labeled aggregate
- latest PR review: found mixed correct/incorrect aggregates hid the incorrect count and label-based deduplication was unsafe for renamed or same-named targets
- final-head PR review: found an indexed raw event could duplicate a top-level fallback and older unindexed raw events could duplicate a renamed single-target snapshot
- subsequent PR review: found completed legacy measurements were marked unlinked when the finalized `goal_ids` column was null
- exact-head PR review: found the sole-label fallback could mislabel an identifiable unindexed raw target and suppress a distinct aggregate
- replacement-PR review: found that an unlabeled later aggregate inherited target zero and that non-count aggregates lost units or used count-specific wording
- re-review: approved after preserving unlabeled aggregate identity, formatting non-count units, and retaining unit context for zero-valued mixed outcomes

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: UI/component session-closeout derivation and targeted component tests
- required checks:
  - targeted `SessionModal` tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - targeted `SessionModal` tests: pass, 125/125
  - `npm run ci:check-focused`: pass via bundled Node runtime
  - `npm run lint`: pass via bundled Node runtime
  - `npm run typecheck`: pass via bundled Node runtime
  - `npm run test:ci`: fail on four pre-existing baseline tests; all WIN-243 `SessionModal` tests pass within the full run
  - focused baseline rerun: three deterministic unrelated failures remain in the async PDF blob test and two CI/workflow source-contract tests; the order-sensitive schedule-readiness test passes in isolation
  - `npm run test:routes:tier0`: pass, 220/220; one concurrent build/Cypress attempt returned transient 404s while `dist` was being rewritten, then the isolated rerun passed
  - `npm run ci:playwright`: preflight passed; auth smoke failed because the configured `superadmin@test.com` credential was rejected, so the fail-fast runner did not execute the remaining children
  - `npm run build`: pass
  - PR #839 CI on commit `495ce07a`: all required checks passed, including Linux unit tests, policy, lint/typecheck, build, and the lane-scoped browser gates
- blocked checks:
  - `npm run verify:local`: blocked by the same unrelated `test:ci` baseline failures
  - remaining `npm run ci:playwright` children: blocked after the credential failure stopped the fail-fast runner
- result: `pending-final-head-ci`
- residual risk: the latest unit/identity correction requires final-head PR CI and credential-backed browser proof; aggregate values remain aggregate preview rows rather than fabricated raw trials

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- single-purpose: yes
- protected-path drift: none
- unrelated changes: pre-existing untracked `.superpowers/brainstorm/`, `.tmp/`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` are excluded
- generated artifact drift: none
- change summary: present
- verification summary: present
- reviewer: completed and approved with no findings for the unit-aware and identity-safe aggregate fallback
- pr-ready: yes
- required follow-up: commit and push the isolated correction, resolve the two current review threads, rerun final-head PR checks, and capture credential-backed closeout proof
