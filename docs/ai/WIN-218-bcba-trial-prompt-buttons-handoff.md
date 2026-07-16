# WIN-218 BCBA Trial Prompt Buttons Handoff

- classification: `low-risk autonomous`
- lane: `standard`
- issue: [WIN-218](https://linear.app/winningedgeai/issue/WIN-218/add-bcba-prompt-specific-trial-capture-controls)
- branch: `codex/bcba-trial-prompt-buttons`
- scope: add seven prompt controls and per-target correctness selection to configured response-based targets in `SessionModal`; extend focused component regressions
- files touched:
  - `src/components/SessionModal.tsx`
  - `src/components/__tests__/SessionModal.test.tsx`
  - `docs/superpowers/specs/2026-07-16-bcba-trial-prompt-buttons-design.md`
  - `docs/superpowers/plans/2026-07-16-bcba-trial-prompt-buttons.md`
  - `docs/ai/WIN-218-bcba-trial-prompt-buttons-handoff.md`
- protected paths: none
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`

## Change Summary

- Added exact prompt controls for Full verbal, Partial verbal, Gesture, Model, Visual, Full physical, and Partial physical.
- Added a checked-by-default `Prompted response was correct` checkbox with state keyed by configured target ID.
- Prompt clicks use the existing raw-trial path and persist canonical `response`, `prompt_type`, and `prompt_level` values.
- Prompt controls render only for configured response-based targets; numeric/value and legacy ad-hoc capture paths remain unchanged.
- Accessible checkbox, group, and button names include the configured target name to prevent duplicate target-index-only names across goals.
- No migration or server/API change was required. Supabase plugin readback confirmed hosted `public.trial_events` already has nullable `response`, `prompt_type`, and `prompt_level` columns with RLS enabled.

## TDD Evidence

- RED: prompt-specific regression failed because the checkbox and seven prompt buttons were absent.
- RED: target-isolation helper regression failed because `setPromptCorrectnessForTarget` was absent.
- GREEN: direct target-isolation regression passed `1/1`.
- GREEN: direct prompt and duration regressions passed `2/2` during implementation.
- GREEN: complete `SessionModal` file passed `72/72` during implementation.
- implementation commit: `67db3041252e724beb01df009ff3ec85fa77949c`

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: `UI/component/page`
- required checks:
  - direct focused `SessionModal` Vitest regression
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - synthetic browser proof when an authenticated test BCBA session is available
- executed checks:
  - `npx vitest run --config vitest.config.ts src/components/__tests__/SessionModal.test.tsx -t "keeps prompt correctness isolated by configured target|records prompt-specific trials as raw trial events|submits configured duration target values as raw trial values with units"` -> PASS (`3` passed, `69` skipped)
  - complete `SessionModal` file, implementation-engineer run -> PASS (`72/72`)
  - `npm run ci:check-focused` -> PASS
  - `npm run lint` -> PASS
  - `npm run typecheck` -> PASS
  - `npm run build` -> PASS (`2165` modules transformed)
  - `npm run test:ci` -> FAIL outside changed files (`2759` passed, `3` skipped, `2` failed)
  - `npm run verify:local` -> FAIL at its `test:ci` stage on the same two outside-scope tests; its policy, lint, and typecheck stages passed
  - Chrome Beta local branch navigation -> BLOCKED at login because no authenticated localhost BCBA session or `PW_*`/`CI_SMOKE_BCBA_*` credentials are available to the process
- blocked/failed checks:
  - `src/lib/__tests__/supabase.edge.test.ts` `downloads blob from async download endpoint` -> local Windows test Blob lacks `.text()`; this test and implementation match `origin/main`
  - `tests/ci/check-e2e-reliability-gates.test.ts` synthetic BCBA provision step assertion -> local CRLF checkout prevents the LF-specific regex from matching; the test, workflow, and expected provision step match `origin/main`
  - authenticated browser mutation/readback -> requires a protected test credential or an existing authenticated localhost session; none was exposed or copied
- result: `fail` locally until fresh PR CI proves the two unchanged Linux gates and required branch checks
- residual risk: component behavior and payload construction are directly proven, but visual authenticated BCBA proof remains dependent on trusted browser credentials or preview/CI. No hosted data was mutated during local verification.

## Reviews

- specification-engineer: confirmed the smallest scope is UI-only because existing types, server upsert, migration, and hosted schema already support prompt metadata.
- test-engineer: confirmed seven mappings, checked/unchecked payloads and counters, saved-history numbering, progression version, numeric-target absence, and direct focused Vitest evidence; authenticated browser proof remains pending.
- code-review-engineer: spec PASS, quality APPROVED, no Critical/Important/Minor findings, and no protected-path drift.

## PR Readiness

- single purpose: yes
- unrelated changes: untracked `.tmp/` remains excluded
- generated artifact drift: none
- Linear: WIN-218 is `In Progress`; move to `In Review` after PR creation
- current local verification blocker: fresh PR CI must pass the unchanged Linux-only gates before this handoff can be marked `pr-ready: yes`
