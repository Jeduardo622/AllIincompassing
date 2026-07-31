# WIN-269 Supabase Validate IPC

## Route Task

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `.github/workflows/**`
- Allowed files:
  - `.github/workflows/supabase-validate.yml`
  - `tests/workflows/ci-test-memory.test.ts`
  - `docs/ai/handoffs/WIN-269-supabase-validate-ipc.md`
- Non-goals:
  - no migration, app, auth, or Supabase function changes
  - no worker-cap changes
  - no `scripts/ci/**` or policy-exception edits
  - no broader Vitest refactor
- Stop conditions:
  - any required edit outside the allowed files
  - any need to change workflow behavior beyond the `Run unit tests` heap contract
  - any evidence that the failure is not addressed by matching the existing heap contract

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
  - `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vitest\vitest.mjs run tests/workflows/ci-test-memory.test.ts --reporter=verbose` before edit (fail: expected missing heap contract in `supabase-validate.yml`)
  - `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vitest\vitest.mjs run tests/workflows/ci-test-memory.test.ts --reporter=verbose` after edit (pass)
  - hosted `Supabase Validate` run `30583683750`, attempt `3`, on unchanged `main` (fail: `ERR_IPC_CHANNEL_CLOSED` reproduced in `Run unit tests`, proving the failure is not transient)
  - rebased cleanly onto current `origin/main` commit `d5861d5c` after PR #879 and the unrelated invite CORS follow-up merged
  - `npx vitest run tests/workflows/ci-test-memory.test.ts` after rebase (pass)
  - `npm run ci:check-focused` after the final main sync (pass)
  - exact workflow-equivalent `NODE_OPTIONS=--max-old-space-size=6144 npm test -- --run --reporter=verbose --exclude=src/lib/__tests__/DatabaseIntegration.test.ts --exclude=src/integrations/supabase/__tests__/appointment-status-sync.test.ts` (pass: `437` files / `3621` tests; no IPC shutdown)
  - `NODE_OPTIONS=--max-old-space-size=6144 npm run verify:local` (pass: policy, lint, typecheck, all `437` unit-test files / `3621` tests, coverage, build, and all `220` Tier-0 route tests)
- Blocked checks:
  - hosted GitHub Actions proof after this workflow change requires the protected workflow change to be reviewed and merged
- Result:
  - `pass-with-hosted-proof-pending`
- Residual risk:
  - local verification no longer reproduces the IPC shutdown with the mirrored heap contract; hosted post-merge `Supabase Validate` proof remains required
- Verification card:
  - classification: `high-risk human-reviewed`
  - lane: `critical`
  - change type: CI/workflow/policy
  - required checks: direct workflow validation, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`, `npm run verify:local`
  - executed checks: targeted workflow contract red/green, post-rebase focused contract pass, `ci:check-focused` pass, full `verify:local` pass, and unchanged hosted attempt 3 reproduced the original `ERR_IPC_CHANNEL_CLOSED`
  - blocked checks: post-change hosted `Supabase Validate` proof until review and merge
  - result: `pass-with-hosted-proof-pending`
  - residual risk: the workflow change is locally proved and narrowly scoped, but the GitHub-hosted runner remains the authoritative environment for closing the IPC incident

## Required agents and review

- `specification-engineer`: confirmed that replaying hosted migrations is out of scope because parity already passes, and constrained the remediation to the workflow/test slice.
- `software-architect`: approved the no-replay decision and the critical-lane bounded workflow remediation.
- `implementation-engineer`: added the missing heap env and the focused workflow-memory assertion.
- `test-engineer`: traced the remaining failure to Vitest IPC shutdown after parity passed and recommended mirroring the existing heap contract before considering worker limits.
- `code-review-engineer`: final post-rebase review approved; no correctness, regression, or policy defect found.
- `test-engineer`: final post-rebase review approved; targeted, exact workflow-equivalent, and full local verification cover the bounded change; hosted post-merge proof remains required.
- `security-engineer`: final post-rebase review approved; no permission, trigger, secret, tenant, or supply-chain drift found.
- `devops-engineer`: confirmed the heap-only edit is the narrowest first remediation and the unchanged hosted attempt 3 reproduced the original failure.

## PR handoff

- Linear: `WIN-269`
- PR hygiene verdict:
  - `pr-ready`: `yes`
  - rationale: the diff is isolated, rebased onto current main, fully verified locally, and the normal policy hook is green
- Current disposition:
  - commit through the normal hook, push, open a PR, and wait boundedly for required checks and human review
- Merge policy:
  - human review is mandatory because `.github/workflows/**` is a critical protected path; this slice must stop at review-ready unless live branch protection later permits merge with the required approvals and checks.
