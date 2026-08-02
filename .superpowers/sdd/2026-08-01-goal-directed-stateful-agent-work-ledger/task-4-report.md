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
- the repository currently assumes the caller supplies authoritative workflow and approval context; later tasks must keep those sources server-owned and fail closed on unavailable runtime policy data.
