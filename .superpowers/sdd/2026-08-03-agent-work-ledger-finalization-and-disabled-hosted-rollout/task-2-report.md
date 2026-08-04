Status: DONE_WITH_CONCERNS

Files changed:
- `src/lib/ai.ts`
- `src/lib/__tests__/ai-auth-fetch.test.ts`
- `supabase/functions/generate-program-goals/index.ts`
- `supabase/functions/generate-program-goals/index.test.ts`

RED commands and expected failures:
- `npx vitest run src/lib/__tests__/ai-auth-fetch.test.ts`
  - Failed as expected before production changes.
  - Legacy compatibility test hit `Ledger-bound generation requires assessment, client, and organization scope`.
  - Missing-scope test also failed because the code still emitted the ledger-bound error instead of the legacy-specific fail-closed error.
- `deno test --allow-env supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts`
  - Failed as expected before production changes.
  - `resolveGenerationRequest` was absent.
  - `createGenerateProgramGoalsHandler` was absent.
  - Legacy handler seam tests failed because the Edge function still required ledger correlation and had no legacy request path.

GREEN commands/results:
- `npx vitest run src/lib/__tests__/ai-auth-fetch.test.ts`
  - Passed: `10 passed`.
- `deno test --allow-env supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts`
  - Passed: `29 passed`.
- `git commit -m "fix(agent-work): preserve legacy goal generation"`
  - Passed.
  - Pre-commit hook ran `npm run ci:check-focused` and it passed.
- `npm run agent-work:db:reset`
  - Blocked by local environment.
  - Failed with `failed to inspect container health: Error response from daemon: No such container: supabase_db_AllIincompassing`.
- `npm run agent-work:edge-smoke`
  - Blocked by the same local environment dependency.
  - Failed while entering `agent-work:security-contract` through `scripts/agent-work-ledger-local-env.ts` with `failed to inspect container health: Error response from daemon: No such container: supabase_db_AllIincompassing`.

Commit SHA: `6e97c3f5`

Self-review:
- Restored client-side legacy request selection only when `ledgerWorkItemId` is absent and kept the strict ledger envelope unchanged.
- Added explicit legacy scope validation on the Edge function and required exact same-tenant `assessment_documents` visibility before any completion call.
- Kept the ledger path authoritative: stable request identity, advisory runtime gate, replay handling, and attempt recording still execute only for ledger-bound requests.
- Added a narrow dependency-injected handler factory for deterministic tests without introducing a new server abstraction.
- Left unrelated dirty files (`deno.lock`, `reports/test-reliability-latest.json`) untouched.

Concerns:
- The task-specific local reset and edge smoke commands are currently blocked by the missing local Supabase container `supabase_db_AllIincompassing`, so hosted finalization still needs that environment restored before those commands can be proven green.

## Review-Fix Round 1

Status: DONE_WITH_CONCERNS

Commit SHA: `4d794692`

Files changed:
- `src/lib/ai.ts`
- `src/lib/__tests__/ai-auth-fetch.test.ts`
- `supabase/functions/generate-program-goals/index.ts`
- `supabase/functions/generate-program-goals/index.test.ts`
- `.superpowers/sdd/2026-08-03-agent-work-ledger-finalization-and-disabled-hosted-rollout/task-2-report.md`

RED commands and expected failures:
- `npx vitest run src/lib/__tests__/ai-auth-fetch.test.ts`
  - Failed as expected: 1 failed, 9 passed.
  - The legacy request forwarded empty/default payload fragments instead of deriving the full contract through the authoritative builder.
- `deno test --allow-env supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts`
  - Failed as expected: 2 failed, 29 passed.
  - Exhausted non-timeout legacy generation returned generic `500` instead of structured `502`.
  - A ledger organization mismatch returned the legacy-bound denial message instead of the ledger-bound denial message.

GREEN commands/results:
- `npx vitest run src/lib/__tests__/ai-auth-fetch.test.ts`
  - Passed: 10/10.
- `deno test --allow-env supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts`
  - Passed: 31/31.
- Pre-commit hook `npm run ci:check-focused`
  - Passed. Database/CI-only checks reported their environment-based skips.

Self-review:
- `src/lib/ai.ts` now calls `buildGenerateProgramGoalsPayload`; its only transitive local dependency is the browser-safe pure assessment text composer, and the API-boundary hook passed.
- Legacy scope remains fail-closed through exact authenticated request-client assessment visibility checks and does not invoke ledger RPCs.
- Ledger parsing remains first; attempt, replay, authoritative evidence, and settlement paths are unchanged.
- Exhausted legacy validation failures restore the prior structured `502` response without changing timeout fallback behavior.
- Ledger and legacy organization mismatches retain their respective sanitized denial surfaces.
- Unrelated `deno.lock` and `reports/test-reliability-latest.json` drift was neither edited nor staged.

Concerns:
- No external model calls, hosted actions, or provider-backed smoke were performed, per round constraints.
- Broader local Docker verification was intentionally not repeated in this bounded review-fix round.

## Review-Fix Round 2

Status: DONE_WITH_CONCERNS

Commit SHA: `85cb5ad0`

Files changed:
- `supabase/functions/generate-program-goals/index.ts`
- `supabase/functions/generate-program-goals/index.test.ts`
- `.superpowers/sdd/2026-08-03-agent-work-ledger-finalization-and-disabled-hosted-rollout/task-2-report.md`

RED command and expected failure:
- `deno test --allow-env supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts`
  - Failed as expected: 1 failed, 31 passed.
  - The regression modeled an invalid completion reporting 17 input and 9 output tokens followed by a provider exception.
  - Ledger fallback settlement recorded `p_input_token_count: 0` instead of `17`, proving accumulated usage was lost before catch settlement.

GREEN commands/results:
- `npx vitest run src/lib/__tests__/ai-auth-fetch.test.ts`
  - Passed: 10/10.
- `deno test --allow-env supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts`
  - Passed: 32/32.
- Pre-commit hook `npm run ci:check-focused`
  - Passed. Database/CI-only checks reported their environment-based skips.

Self-review:
- The retry helper reports cumulative nonnegative usage after each completion response, before output validation can trigger another attempt.
- The handler installs the observer only for ledger-bound generation, so legacy invocation, retries, structured `502`, timeout fallback, and no-ledger semantics are unchanged.
- A later provider exception now settles the ledger fallback with the usage accumulated from earlier invalid completions.
- Ledger parsing, advisory gating, authoritative evidence loading, replay, and attempt ordering are unchanged.
- Tenant scope and fail-closed behavior are unchanged.
- Unrelated `deno.lock` and `reports/test-reliability-latest.json` drift was neither edited nor staged.

Concerns:
- No Docker, hosted, provider-backed, external-model, or external-network verification was performed, per round constraints.
