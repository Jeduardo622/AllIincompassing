# WIN-268 Node 24 Actions

## Route Task

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `.github/workflows/**`
- Allowed files:
  - `.github/workflows/auth-verification.yml`
  - `.github/workflows/bcba-smoke-janitor.yml`
  - `.github/workflows/bt-aba-disposable-browser-proof.yml`
  - `.github/workflows/ci.yml`
  - `.github/workflows/database-first-ci.yml`
  - `.github/workflows/iehp-pdf-mini-matrix-proof.yml`
  - `.github/workflows/lighthouse.yml`
  - `.github/workflows/rollback-drill.yml`
  - `.github/workflows/supabase-preview.yml`
  - `.github/workflows/supabase-validate.yml`
  - `.github/workflows/tenant-safety.yml`
  - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`
  - `tests/workflows/github-actions-node24-runtime.test.ts`
  - `docs/ai/handoffs/WIN-268-node24-actions.md`
- Non-goals:
  - no `node-version` changes
  - no workflow trigger, permission, secret, artifact, or job-logic changes
  - no `scripts/ci/**`, app, migration, auth, or deploy-config edits
- Stop conditions:
  - any required edit outside the allowed files
  - any need to change workflow behavior beyond action refs

## Verification

- Required checks:
  - direct workflow validation via parser-based workflow tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - `node .\node_modules\vitest\vitest.mjs run tests/workflows/github-actions-node24-runtime.test.ts tests/workflows/bt-aba-disposable-browser-proof.test.ts tests/workflows/iehp-pdf-mini-matrix-proof.test.ts tests/workflows/ci-test-memory.test.ts` (pass: `4` files, `10` tests)
  - workflow diff invariant check (pass: workflow changes are action-ref/comment lines only)
  - old-ref search (pass: no old action tags or SHAs remain)
  - `npm run ci:check-focused` (pass)
  - `npm run lint` (pass)
  - `npm run typecheck` (pass)
  - `npm run build` (pass)
  - `npm run test:ci` (fail: repo-wide Vitest run exhausted the Node heap after unrelated `ai-documentation` test stderr)
- Blocked checks:
  - `npm run verify:local` (blocked after `npm run test:ci` failed; aggregate run would also include unrelated `test:routes:tier0`)
- Result:
  - `pass-with-blocked-checks`
- Residual risk:
  - local targeted workflow coverage is green, but repo-wide `test:ci` is not clean in this environment and GitHub Actions remains the authoritative runtime proof for the workflow execution path
- Verification card:
  - classification: `high-risk human-reviewed`
  - lane: `critical`
  - change type: CI/workflow/policy
  - required checks: direct workflow validation, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`, `npm run verify:local`
  - executed checks: direct workflow validation (pass), focused policy (pass), lint (pass), typecheck (pass), build (pass), `test:ci` (environment failure)
  - blocked checks: clean local `test:ci` and `verify:local` exit due shared Windows Node/Vitest heap instability
  - result: `pass-with-blocked-checks`
  - residual risk: upstream action runtime behavior and runner compatibility require hosted GitHub Actions proof

## Required agents and review

- `specification-engineer`: confirmed the critical-lane scope, acceptance criteria, non-goals, and stop conditions.
- `software-architect`: approved the ref-only design for GitHub-hosted runners, with the upstream runner-version and GHES caveats recorded.
- `implementation-engineer`: implemented the bounded action-ref and workflow-contract test changes.
- `code-review-engineer`: approved the current diff; confirmed refs/comments-only workflow changes with no trigger, permission, secret, environment, or job-logic drift.
- `test-engineer`: selected the focused workflow-contract suite; the final four-file suite passed `10/10`.
- `security-engineer`: approved the current diff and confirmed no trigger, permission, condition, secret, artifact-path, deploy-logic, or project Node-version drift.
- `devops-engineer`: approved for PR, not merge; hosted Actions must prove runner/runtime and artifact compatibility.

## PR handoff

- Linear: `WIN-268`
- PR hygiene:
  - `pr-ready`: yes
  - `lane`: critical
  - `branch-ready`: yes (`codex/win-268-node24-actions`)
  - `linear-ready`: yes (`WIN-268`)
  - `single-purpose`: yes
  - `unrelated changes`: none
  - `generated artifact drift`: none
  - `protected-path drift`: intended `.github/workflows/**` action-ref updates only
  - `change summary`: present
  - `verification summary`: present, with local aggregate failures explicitly blocked
  - `pr handoff`: ready
  - `reviewer`: completed
  - `required follow-up`: inspect hosted Actions logs for Node 20 runtime warnings and action/runtime regressions; obtain mandatory human review before merge
- Merge policy: human review is mandatory because `.github/workflows/**` is a critical protected path; this slice must stop at review-ready.
