# WIN-264 Windows Blob Test CI Unblocker

## Scope

- Fix the Windows-local `blob.text is not a function` failure in `src/lib/__tests__/supabase.edge.test.ts`.
- Confirm the synthetic-BCBA publishable-key and BT/ABA `codex/return-bt-correction` contracts remain green after WIN-262 / PR #872.
- Do not change migrations, hosted Supabase state, workflows, CI scripts, or program/goal editing implementation.

## Route

- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering paths:
  - `src/lib/__tests__/supabase.edge.test.ts`
  - `docs/ai/WIN-261-live-program-goal-editing-handoff.md`
  - `docs/ai/handoffs/WIN-264-windows-blob-test.md`
- Required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- Reviewer required: yes
- Verify-change required: yes
- Linear: WIN-264

## Implementation

- Replaced the unsupported jsdom `Blob.text()` test call with `FileReader.readAsText`.
- Preserved the assertion that the downloaded payload equals `pdf-binary`.
- Left `downloadSessionNotesPdfExport`, workflow sources, CI scripts, migrations, and program/goal editing code unchanged.

## Verification Card

- Classification: `low-risk autonomous`
- Lane: `standard`
- Change type: test harness and documentation
- Required checks:
  - `npx vitest run src/lib/__tests__/supabase.edge.test.ts tests/ci/check-e2e-reliability-gates.test.ts tests/workflows/bt-aba-disposable-browser-proof.test.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - `npx vitest run src/lib/__tests__/supabase.edge.test.ts tests/ci/check-e2e-reliability-gates.test.ts tests/workflows/bt-aba-disposable-browser-proof.test.ts`: pass, 3 files and 26 tests
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: fail after 433 files and 3,573 tests passed
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local`: fail at its `test:ci` sub-gate after policy, lint, and typecheck passed
- Blocked checks:
  - `npm run test:ci`: blocked by the unchanged CRLF-sensitive assertion in `tests/authorizations/authorization-bcba-readonly.test.ts`
  - `npm run verify:local`: blocked by the same out-of-scope `test:ci` assertion before coverage, build, and Tier-0 sub-gates
- Result: `pass-with-blocked-checks`
- Residual risk: low code risk; the requested three failures are green, while one separately documented Windows CRLF baseline remains outside WIN-264.

## Review And PR Handoff

- Specification: completed; scope remains test-only plus tracking artifacts.
- Implementation: completed.
- Code review: no code-level defect found; handoff-card request addressed by this artifact.
- Test review: pending final verification assessment.
- PR hygiene: pending.
- PR handoff: pending commit, push, and PR creation.
