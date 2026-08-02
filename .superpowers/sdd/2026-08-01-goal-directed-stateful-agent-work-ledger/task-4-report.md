# Task 4 Report

## Status

- completed

## Scope

- implemented only:
  - `supabase/functions/_shared/agent-work/policy.ts`
  - `supabase/functions/_shared/agent-work/policy.test.ts`
  - `supabase/functions/_shared/agent-work/events.ts`
  - `supabase/functions/_shared/agent-work/events.test.ts`
  - `supabase/functions/_shared/agent-work/repository.ts`
- no migrations, state-machine files, `deno.lock`, API, runner, UI, `.env*`, hosted systems, or clinical-domain files were changed

## RED Evidence

Tests were created before the implementation files existed and the first focused run failed closed on missing modules:

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/policy.test.ts
deno test --no-lock supabase/functions/_shared/agent-work/events.test.ts
```

Observed RED:

```text
TS2307 [ERROR]: Cannot find module 'file:///C:/Users/test/.config/superpowers/worktrees/AllIincompassing/agent-work-ledger-foundation/supabase/functions/_shared/agent-work/policy.ts'.
TS2307 [ERROR]: Cannot find module 'file:///C:/Users/test/.config/superpowers/worktrees/AllIincompassing/agent-work-ledger-foundation/supabase/functions/_shared/agent-work/events.ts'.
```

## Implementation Summary

- added explicit request-scoped actor and scope contracts in `policy.ts`
  - actor requires stable id, explicit kind, and current org role bindings
  - scope requires exact organization/client/work-item/step identifiers plus an authoritative validation verdict
- implemented fail-closed `authorizeWorkAction`
  - denies null runtime mode, kill switch, missing actor, bad scope, unknown workflow/action, forbidden tool, inactive membership, insufficient role, stale approval, and stale evidence hash
  - preserves `disabled | shadow | advisory | active` semantics
  - keeps `active` limited to workflow-owned action/tool pairs and still blocks clinical effects in this slice
- added a strict PHI-free event sanitizer in `events.ts`
  - explicit key allowlist
  - exact type/value validators for UUID identifiers, SHA-256 hashes, machine codes, runtime/status enums, and bounded counts/durations/tokens
  - rejects unknown keys, nested values, free-text/narrative strings, auth/secret material, and URL-shaped values
- added a narrow injected repository boundary in `repository.ts`
  - mutation methods require actor + scope
  - mutations call policy before RPC
  - only parameterized RPC calls are available for writes
  - no direct table writes or generic Supabase mutation escape hatch
  - read events are re-sanitized before returning

## GREEN Evidence

Focused policy suite:

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/policy.test.ts
```

```text
ok | 6 passed | 0 failed
```

Focused event sanitizer suite:

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/events.test.ts
```

```text
ok | 3 passed | 0 failed
```

Repo typecheck:

```powershell
$env:PATH='C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
npm run typecheck
```

```text
> allincompassing@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit
```

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: shared Edge Function policy/repository boundary plus PHI-free event sanitation
- required focused checks for this task instruction:
  - `deno test --no-lock supabase/functions/_shared/agent-work/policy.test.ts`
  - `deno test --no-lock supabase/functions/_shared/agent-work/events.test.ts`
  - `npm run typecheck`
- executed checks:
  - `deno test --no-lock supabase/functions/_shared/agent-work/policy.test.ts` -> pass
  - `deno test --no-lock supabase/functions/_shared/agent-work/events.test.ts` -> pass
  - `npm run typecheck` -> pass
- blocked/unrun broader critical-lane checks:
  - `npm run ci:check-focused` -> intentionally not changed or rerun in this slice because the owner already recorded the unrelated July 31, 2026 inventory drift as out of scope for this task
  - `npm run lint`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- result: `pass-with-blocked-checks`
- residual risk: repository coverage is intentionally narrow and local-only. The actual runner/active-mode integration still requires later critical-lane work to thread real workflow definitions, runtime-mode sourcing, and repository usage through human review.

## Self-Review

- the repository boundary does not let model-controlled data choose workflow, tool, scope, approvals, roles, execution mode, or completion
- service-role callers are still forced through the same explicit actor/scope policy path as human callers
- the sanitizer rejects both sensitive keys and suspicious values, even when a caller tries to smuggle them through otherwise machine-safe fields
- claim/transition writes remain RPC-only and therefore preserve the Task 2 atomic transition + event transaction model
- `deno.lock` was left untouched by using local assertion helpers and `--no-lock`

## Concerns

- this task intentionally stops at the shared boundary layer. No runner, queue, API, or clinical side effects were enabled or validated here.
- the repository now requires an injected server-owned authority loader; later runner/API work must implement that dependency without reintroducing caller- or model-controlled authority fields.

## Fix Round 1

### Review Inputs

- read and adjudicated all Task 4 review reports:
  - `task-4-code-review.md`
  - `task-4-security-review.md`
  - `task-4-supabase-review.md`
- verified the findings against the Task 2 claim/transition RPC metadata and stored event shapes before changing code

### RED Evidence

Tests were changed before production code. The first focused runs failed against the old caller-owned repository and single-sanitizer contract.

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/events.test.ts
```

```text
TS2724: events.ts has no exported member named sanitizeTransitionEventMetadata
TS2305: events.ts has no exported member validateStoredEventMetadata
```

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/policy.test.ts
```

```text
TS2305: repository.ts has no exported AgentWorkAuthorityContext or AgentWorkAuthorityLoader
TS2554: AgentWorkRepository expected one constructor argument, but the authority loader and clock were supplied
TS2739: mutation inputs still required caller runtimeMode, workflow, workerId, killSwitchEnabled, and approval
TS2353: actor/scope/event row contracts did not support actor.id/kind, loader-owned scope validation, or SQL-shaped rows
```

### Implementation

- moved mutation authority behind the constructor-injected `AgentWorkAuthorityLoader`
  - method inputs no longer accept runtime mode, workflow, action, approval, tool, allowed machine sets, clock, worker ID, or scope verdicts
  - lookup exceptions, null context, malformed context, and exact organization/client/work-item/step binding mismatches fail before RPC
  - runtime, workflow, action, tool, approval, reason, result, status, worker ID, and workflow-version checks use loader-owned closed sets
- changed the explicit actor contract to stable `id`, `kind`, and current organization role bindings
  - claims require `kind = 'worker'`
  - `p_worker_id` is derived only from validated `actor.id`
  - claim scope is an exact work-item binding with `stepId = null`
- split event handling into two contracts
  - outgoing transition sanitation accepts only Task 2 RPC keys: `worker_id`, `attempt_id`, `result_code`, `evidence_hash`, `duration_ms`, and `retry_count`
  - stored validation accepts the Task 2 system-emitted creation, claim, and transition keys without cloning or rewriting rows
  - unknown keys, sensitive keys, nested values, narratives, URLs, malformed IDs/hashes, and out-of-range numbers remain rejected
- retained a narrow RPC/read client with no table mutation API or generic write escape hatch

### GREEN Evidence

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/policy.test.ts
```

```text
ok | 13 passed | 0 failed
```

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/events.test.ts
```

```text
ok | 4 passed | 0 failed
```

```powershell
$env:PATH='C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
npm run typecheck
```

```text
> tsc -p tsconfig.json --noEmit
```

Additional local checks:

```text
deno fmt --check <five Task 4 files> -> pass
git diff --check -> pass (line-ending warnings only)
```

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: shared Edge Function authorization, tenant binding, RPC boundary, and audit metadata validation
- required fix-round checks:
  - focused Deno policy/repository suite
  - focused Deno event suite
  - `npm run typecheck`
- executed checks:
  - `deno test --no-lock supabase/functions/_shared/agent-work/policy.test.ts` -> pass, 13 tests
  - `deno test --no-lock supabase/functions/_shared/agent-work/events.test.ts` -> pass, 4 tests
  - `npm run typecheck` -> pass
  - `deno fmt --check` for all five owned files -> pass
  - `git diff --check` -> pass
- blocked/unrun broader critical-lane checks: unchanged from the original report; the known unrelated `ci:check-focused` inventory expiry remains owner-waived and no migration, hosted, API, runner, or integration boundary changed in this round
- result: `pass-with-blocked-checks`
- reviewer: all three supplied Task 4 reports were addressed; custom reviewer/tester agents were unavailable in this session, so human review remains mandatory before merge
- residual risk: this slice defines but does not wire the trusted server-owned authority loader. Runner/API integration must implement that dependency without accepting model/upstream authority fields and must undergo a separate critical-lane review.

### PR Hygiene

- branch-ready: yes, dedicated `codex/agent-work-ledger-foundation` branch
- linear-ready: route artifact links `WIN-271`
- single-purpose: yes
- unrelated changes: none
- protected-path drift: none beyond the five explicitly authorized shared Function files
- pr-ready: no; this fix round was requested through local commit only, and critical-lane human review is still required before merge
