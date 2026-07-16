# WIN-220 BT Clinical Capture Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the visible change is UI-only, but it defines a role-sensitive session-edit boundary and verifies persistence through the existing clinical session-note path
- triggering paths: `src/components/SessionModal.tsx`, `src/pages/Schedule.tsx`, and the existing session-note orchestration
- issue: [WIN-220](https://linear.app/winningedgeai/issue/WIN-220/make-bt-scheduled-session-clinical-capture-explicitly-editable-and)
- branch: `codex/bt-clinical-capture-update`

## Scope

- task intent: let a BT edit and save only clinical capture on an existing scheduled or in-progress session
- files touched:
  - `src/components/SessionModal.tsx`
  - `src/components/__tests__/SessionModal.test.tsx`
  - `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
  - `docs/ai/WIN-220-bt-clinical-capture-handoff.md`
- single-purpose diff: yes
- non-goals: no appointment metadata editing, role/API/RLS changes, database changes, billing-gate changes, or session-start permission changes
- stop condition: any required change outside the modal copy/action label or focused regressions must be re-routed

## Change Summary

- BT data-collection-only mode now says that appointment details are locked and clinical capture can be edited and saved.
- The BT-only submit action is labeled `Save clinical capture` for existing scheduled and in-progress sessions.
- The existing locked metadata overlay, authorization requirement, and session-note persistence path remain unchanged.
- Regression coverage now uses a real per-goal clinical edit on a scheduled session and proves `session_note_persist_requested: true`.
- Schedule orchestration coverage proves a scheduled BT capture invokes the session-note upsert and never invokes the appointment mutation.

## TDD Evidence

- RED: the scheduled BT component regression could not find a `Save clinical capture` action; the modal exposed `Update Session` instead.
- GREEN: the scheduled BT component regression submits the edited clinical note while retaining the original locked appointment values.
- GREEN: scheduled and in-progress Schedule orchestration regressions persist clinical capture without updating appointment metadata.

## Required Agents

- required sequence: specification/test review, implementation, code review, security/auth review
- agents used: specification/test review, implementation, code review, security/auth review
- reviewer: completed; no blocking or nonblocking code findings

## Verification Card

- required checks:
  - focused `SessionModal` and `Schedule` regressions
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npx vitest run --config vitest.config.ts src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx --reporter=dot`: pass (`92` passed)
  - focused scheduled/in-progress BT modal regressions: pass (`3` passed)
  - focused scheduled/in-progress/close BT Schedule orchestration regressions: pass (`3` passed)
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass (`2165` modules transformed)
  - `PREVIEW_PORT=4174 npm run test:routes:tier0`: pass (`220/220`)
  - `npm run test:ci`: fail outside changed files (`2761` passed, `3` skipped, `2` failed)
  - `npm run verify:local`: fail at its `test:ci` stage on the same two outside-scope tests; policy, lint, and typecheck stages passed
  - `npm run ci:playwright`: preflight pass, then hosted auth fail because the configured `superadmin@test.com` password was rejected; failure screenshot captured under ignored `artifacts/latest`
- blocked/failed checks:
  - `src/lib/__tests__/supabase.edge.test.ts` `downloads blob from async download endpoint`: local Windows test Blob lacks `.text()`; unchanged from `origin/main`
  - `tests/ci/check-e2e-reliability-gates.test.ts` synthetic BCBA provision assertion: local CRLF checkout prevents its LF-specific workflow regex from finding the step; unchanged from `origin/main`
  - authenticated Playwright suite: configured protected hosted credential is stale/invalid; fresh PR CI must run its managed credential path
- result: fail locally until fresh PR CI proves the unchanged Linux gates and hosted auth check
- residual risk: the focused BT capture behavior, payload, orchestration boundary, and route suite are proven; an authenticated hosted BT mutation/readback remains dependent on a valid protected test credential

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- protected-path drift: none
- unrelated changes: untracked `.tmp/` excluded
- generated artifact drift: none
- verification summary: present
- pr-ready: no, fresh PR CI pending
- required follow-up: push, open a draft PR, require fresh CI and human review, then update this verdict from live checks

## Handoff Summary

The bounded change makes the BT's allowed action explicit: appointment fields stay locked while clinical capture remains editable and saveable for scheduled and in-progress sessions. Component and orchestration tests prove clinical edits reach the session-note path without invoking appointment update or completion, and all 220 tier-0 routes pass. Two unchanged Windows-only full-suite failures and a stale hosted Playwright credential require fresh PR CI before this critical slice is review-ready.
