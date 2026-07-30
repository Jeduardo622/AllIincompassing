# WIN-267 auth CRLF handoff

## Route

- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering rationale: non-trivial test-only portability correction with a required PR; no production or protected-path behavior changes.
- Stop conditions:
  - any required migration, auth/runtime, workflow, or product implementation change
  - any failure attributable to production behavior rather than line endings in the test fixture

## Scope

- Owned files only:
  - `tests/authorizations/authorization-bcba-readonly.test.ts`
  - `docs/ai/handoffs/WIN-267-auth-crlf.md`
- Non-goals:
  - migrations
  - auth/runtime logic
  - workflows/CI
  - program/goal code

## Verification

- Required checks:
  - targeted authorization contract test
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- Pre-edit repro:
  - `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vitest\vitest.mjs run tests/authorizations/authorization-bcba-readonly.test.ts`
  - Expected failure on Windows CRLF-sensitive `toContain` assertion in `removes BCBA while preserving the established authorization managers`
- Post-edit rerun:
  - `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vitest\vitest.mjs run tests/authorizations/authorization-bcba-readonly.test.ts`
  - Passed on July 30, 2026: `1` file, `5` tests
- Aggregate verification:
  - `npm run verify:local`: policy checks, lint, typecheck, and all `434` files / `3575` tests passed, but Vitest returned nonzero after a worker timed out while reporting `onTaskUpdate`; later aggregate stages did not execute.
  - standalone `npm run build`: passed.
  - standalone `npm run test:ci`: not clean in the shared Windows environment; it reported unrelated UI timing failures and the same worker timeout while concurrent verification was running.
- Blocked checks:
  - a clean local aggregate `npm run test:ci` / `npm run verify:local` exit is blocked by the shared Windows Vitest worker/timing instability; hosted CI is the authoritative aggregate rerun.
- Verification card:
  - classification: `low-risk autonomous`
  - lane: `standard`
  - change type: test contract portability
  - required checks: targeted test, focused policy, lint, typecheck, `test:ci`, build, `verify:local`
  - executed checks: targeted test (red then green), focused policy (pass), lint (pass), typecheck (pass), build (pass), aggregate test suites (all tests passed in the first run before the worker reporting timeout)
  - blocked checks: clean aggregate exit, for the environment reason above
  - result: `pass-with-blocked-checks`
  - residual risk: low; the code change only normalizes CRLF to LF before existing assertions.

## Required agents and review

- `specification-engineer`: scope, acceptance criteria, non-goals, and stop conditions confirmed.
- `implementation-engineer`: implemented the bounded test-only normalization.
- `test-engineer`: confirmed the targeted red/green evidence and classified the worker timeout as infrastructure noise unless reproducible cleanly.
- `code-review-engineer`: found no code defect or protected-path drift; the remaining requested change was completion of PR-hygiene evidence.

## PR handoff

- Linear: `WIN-267`
- PR hygiene:
  - `pr-ready`: yes
  - `lane`: standard
  - `branch-ready`: yes (`codex/win-267-auth-crlf`)
  - `linear-ready`: yes (`WIN-267`)
  - `single-purpose`: yes
  - `unrelated changes`: none
  - `generated artifact drift`: none
  - `protected-path drift`: none
  - `change summary`: present
  - `verification summary`: present, with aggregate checks explicitly blocked by local worker/timing instability
  - `pr handoff`: ready
  - `reviewer`: completed
  - `required follow-up`: use hosted required checks as the clean aggregate rerun
- Merge policy: may merge only if live required checks and branch protection allow it.
