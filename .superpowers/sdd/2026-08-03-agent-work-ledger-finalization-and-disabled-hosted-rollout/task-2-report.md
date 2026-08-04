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
