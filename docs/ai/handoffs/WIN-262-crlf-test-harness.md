# WIN-262 CRLF Test Harness Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: test-only portability cleanup with no production, workflow, configuration, schema, or runtime changes
- triggering paths:
  - `tests/ci/check-e2e-reliability-gates.test.ts`
  - `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
  - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`

## Scope

- task intent: make three workflow and configuration contract tests insensitive to Windows CRLF checkouts while preserving their existing assertions
- files touched:
  - `tests/ci/check-e2e-reliability-gates.test.ts`
  - `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
  - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`
  - `docs/ai/handoffs/WIN-262-crlf-test-harness.md`
- non-goals:
  - changing workflow or configuration files
  - weakening contract assertions
  - fixing unrelated repository-wide test failures
- stop condition: re-route before touching production code, protected paths, shared helpers, or tests outside the three named files
- single-purpose diff: yes

## Required Agents

- required sequence: `specification-engineer` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer`
- agents used: all required agents completed
- reviewer: completed with approval and no required fixes

## Verification Card

- required checks:
  - targeted three-file Vitest run
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - targeted three-file Vitest run before changes: expected RED, 3 failed and 56 passed
  - targeted three-file Vitest run after changes: pass, 59 passed
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run test:ci`: blocked by 2 unchanged Windows baseline failures; 3,526 passed and 5 skipped
  - `npm run verify:local`: stopped at the same `test:ci` failures after policy, lint, and typecheck passed
- blocked checks:
  - `tests/authorizations/authorization-bcba-readonly.test.ts`: unchanged LF-only assertion fails against a CRLF migration checkout
  - `src/lib/__tests__/supabase.edge.test.ts`: unchanged jsdom Blob implementation does not provide `blob.text()`
  - later `verify:local` stages did not run because the command is fail-fast
- result: pass-with-blocked-checks
- residual risk: low for WIN-262; Linux CI must confirm the complete repository suite, while the two unrelated Windows harness baselines need separate cleanup

## PR Hygiene

- branch-ready: yes
- linear-ready: yes, `WIN-262`
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes
- required follow-up: confirm live CI and address only failures attributable to this diff

## Handoff Summary

WIN-262 normalizes CRLF to LF only at the three raw file-read boundaries whose exact multiline assertions failed on Windows. The focused tests moved from 3 failures to 59 passing assertions, policy/lint/typecheck/build passed, and independent review approved the unchanged assertion strength. Full local verification remains blocked by two reproducible failures in unchanged files, so live Linux CI is the authoritative full-suite gate for this PR.
