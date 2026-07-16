# WIN-218 BCBA Trial Prompt Buttons Handoff

- classification: `high-risk human-reviewed`
- lane: `critical`
- issue: [WIN-218](https://linear.app/winningedgeai/issue/WIN-218/add-bcba-prompt-specific-trial-capture-controls)
- branch: `codex/bcba-prompt-buttons-all-trials`
- scope: complete seven prompt controls and per-target correctness selection for configured response targets and legacy plan targets without a `goal_targets` UUID
- files touched:
  - `src/components/SessionModal.tsx`
  - `src/components/__tests__/SessionModal.test.tsx`
  - `src/lib/goal-measurements.ts`
  - `src/lib/__tests__/goal-measurements.test.ts`
  - `src/server/__tests__/sessionNotesUpsertHandler.test.ts`
  - `src/types/index.ts`
  - `docs/superpowers/specs/2026-07-16-bcba-trial-prompt-buttons-design.md`
  - `docs/superpowers/plans/2026-07-16-bcba-trial-prompt-buttons.md`
  - `docs/ai/WIN-218-bcba-trial-prompt-buttons-handoff.md`
- protected boundary: shared server/API goal-measurement normalization; no protected-path production file, schema, RLS, or role edit
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `software-architect`
  - `security-engineer`

## Change Summary

- Added exact prompt controls for Full verbal, Partial verbal, Gesture, Model, Visual, Full physical, and Partial physical.
- Added a checked-by-default `Prompted response was correct` checkbox with state keyed by configured target ID.
- Prompt clicks use the existing raw-trial path and persist canonical `response`, `prompt_type`, and `prompt_level` values.
- Prompt controls render for configured response-based targets and legacy plan/ad-hoc trial targets; numeric/value targets remain unchanged.
- Accessible checkbox, group, and button names include the configured target name to prevent duplicate target-index-only names across goals.
- No migration, server-handler, RLS, or role change was required. The follow-up extends the shared goal-measurement normalizer used by the server/API boundary for legacy JSON aggregates; configured targets continue using hosted `public.trial_events`.

## TDD Evidence

- RED: prompt-specific regression failed because the checkbox and seven prompt buttons were absent.
- RED: target-isolation helper regression failed because `setPromptCorrectnessForTarget` was absent.
- GREEN: direct target-isolation regression passed `1/1`.
- GREEN: direct prompt and duration regressions passed `2/2` during implementation.
- GREEN: complete `SessionModal` file passed `72/72` during implementation.
- implementation commit: `67db3041252e724beb01df009ff3ec85fa77949c`

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `UI/component/page`, `server/API shared normalization boundary`
- required checks:
  - direct focused `SessionModal` Vitest regression
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
  - authenticated browser proof when a test BCBA session is available
- executed checks:
  - `npx vitest run --config vitest.config.ts src/components/__tests__/SessionModal.test.tsx -t "keeps prompt correctness isolated by configured target|records prompt-specific trials as raw trial events|submits configured duration target values as raw trial values with units"` -> PASS (`3` passed, `69` skipped)
  - complete `SessionModal` file, implementation-engineer run -> PASS (`72/72`)
  - `npm run ci:check-focused` -> PASS
  - `npm run lint` -> PASS
  - `npm run typecheck` -> PASS
  - `npm run build` -> PASS (`2165` modules transformed)
  - follow-up focused suite -> PASS (`132/132`)
  - `npm run test:ci` -> FAIL outside changed files (`2763` passed, `3` skipped, `2` failed)
  - `npm run test:routes:tier0` -> BLOCKED locally: first attempt found the existing preview on port 4173; isolated retry on 4174 exceeded the local 120-second command budget and ended with Cypress `EPIPE`
  - Chrome Beta local branch navigation -> BLOCKED at login because no authenticated localhost BCBA session or `PW_*`/`CI_SMOKE_BCBA_*` credentials are available to the process
- blocked/failed checks:
  - `src/lib/__tests__/supabase.edge.test.ts` `downloads blob from async download endpoint` -> local Windows test Blob lacks `.text()`; this test and implementation match `origin/main`
  - `tests/ci/check-e2e-reliability-gates.test.ts` synthetic BCBA provision step assertion -> local CRLF checkout prevents the LF-specific regex from matching; the test, workflow, and expected provision step match `origin/main`
  - authenticated browser mutation/readback -> requires a protected test credential or an existing authenticated localhost session; none was exposed or copied
  - `npm run ci:playwright` -> protected hosted credentials are unavailable locally; rely on PR CI
  - `npm run verify:local` -> blocked from a meaningful pass by the same two unchanged `test:ci` baseline failures above
- result: `pass-with-blocked-checks`; fresh PR CI must prove the two unchanged Linux gates and required hosted browser checks
- residual risk: component behavior, legacy/configured persistence, canonical server merge, prompt undo, and target-removal state are directly proven; authenticated browser proof and unchanged Linux-only gates remain dependent on PR CI. No hosted data was mutated during local verification.

## Reviews

- specification-engineer: confirmed the legacy target requires bounded aggregate persistence without synthetic target UUIDs or raw trial events.
- test-engineer: confirmed seven mappings, checked/unchecked payloads and counters, saved-history numbering, progression version, numeric-target absence, and direct focused Vitest evidence; authenticated browser proof remains pending.
- code-review-engineer: initial review found prompt undo and target-removal state issues; both were fixed and the follow-up verdict found no blocking code issues.
- software-architect: conditionally approved the bounded legacy JSON aggregate design and required critical-lane handling.
- security-engineer: PASS; canonicalization strips authority-like keys and no tenant/authz or raw-trial validation bypass was found.

## PR Readiness

- single purpose: yes
- unrelated changes: untracked `.tmp/` remains excluded
- generated artifact drift: none
- Linear: WIN-218 is `In Progress`; move to `In Review` after PR creation
- current merge blocker: fresh PR CI and required human review must pass before merge

## Review Follow-up: Session Reset

- finding: prompt correctness could remain unchecked when the mounted modal changed session or client while reusing the same target ID.
- fix: the existing `[session?.id, clientId]` capture reset now also clears `promptCorrectByTargetId`.
- regression proof: the prompt trial test unchecks the control, rerenders the mounted modal with a new session ID, and requires the checkbox to return to checked before recording the next session's trials.

## Review Follow-up: Legacy Plan Targets

- trigger: authenticated Edit Session screenshot showed a legacy plan target with only aggregate `+` / `-` controls and no prompt buttons.
- root cause: prompt controls were nested behind an exact configured `goal_targets` name match; legacy plan targets have no target UUID and therefore never entered that branch.
- bounded fix:
  - keep configured response targets on raw `trial_events` with their real target UUID;
  - store legacy prompt aggregates in the existing session-note JSON target row as canonical `prompt_counts`;
  - allow only the seven supported prompt type/level pairs, deduplicate them in UI order, reject unknown buckets, and require nonnegative safe-integer counts;
  - increment exactly one correct/incorrect aggregate and one prompt bucket per legacy prompt click;
  - when an aggregate decrement crosses a prompted total, remove the matching prompted aggregate as well so accidental prompt clicks remain undoable;
  - remap index-keyed legacy checkbox state when an earlier ad-hoc target is removed;
  - retain the checked-by-default, session/client-reset correctness behavior with collision-resistant legacy keys.
- protected-boundary rationale: `src/lib/goal-measurements.ts` is shared by `src/server/api/session-notes-upsert.ts`, so the follow-up is routed `critical` even though no server implementation, schema, RLS, role, or tenant query changed.
- focused proof:
  - shared normalizer + adversarial canonicalization tests: PASS (`11/11` complete file)
  - `SessionModal` legacy/configured/numeric, prompt undo, and target-removal state regressions: PASS (`74/74` complete file)
  - server `captureMergeGoalIds` preservation/canonicalization: PASS (`47/47` complete file)
  - combined focused suite after review follow-up: PASS (`132/132`)
  - lint: PASS
  - typecheck: PASS
- BT authorization: unchanged. Existing BT edit mode remains schedule-metadata locked and clinical-capture capable; changing that protected role behavior requires a separate explicit product decision.
