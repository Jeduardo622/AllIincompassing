# CTO Lane Contract

This document defines the hard-gate workflow contract for non-trivial work in this repository.
Use it as the source of truth for:

- task routing (`route-task`)
- verification (`verify-change`)
- PR readiness (`pr-hygiene`)

When guidance conflicts, this file, `AGENTS.md`, and `docs/ai/verification-matrix.md` win.

## Lane Definitions

Choose exactly one lane before implementation:

1. `fast`
2. `standard`
3. `critical`
4. `blocked` (no implementation until clarified)

## Lane Entry Criteria

### Agent Sequence: `fast`

Use when work is docs/process only, or a small low-risk UI/content adjustment that:

- does not touch high-risk paths from `AGENTS.md`
- does not change auth, routing, runtime config, server/API boundaries, tenant isolation, CI policy, or deploy routing

### Agent Sequence: `standard`

Use for non-trivial code or config work that is still outside high-risk paths.

Examples:

- component/page logic updates
- low-risk utility refactors
- non-sensitive test harness updates

### Agent Sequence: `critical`

Use immediately when any touched path or behavior is high-risk:

- `supabase/migrations/**`
- `supabase/functions/**`
- `src/server/**`
- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

Also treat any change affecting authz, org/tenant isolation, RLS, grants, RPC exposure, secrets, billing, or impersonation as `critical`.

### `blocked`

Use when scope is too unclear to route safely. No implementation may start in this state.

## Mandatory Agent Sequence

### Verification: `fast`

- `specification-engineer` (lightweight scope confirmation)
- `implementation-engineer`
- `code-review-engineer`

### Verification: `standard`

- `specification-engineer`
- `implementation-engineer`
- `code-review-engineer`
- `test-engineer`

Add on demand:

- `security-engineer` for auth/input/secrets/external integration risk
- `performance-engineer` for latency/throughput or query-path impact

### Verification: `critical`

- `specification-engineer`
- `software-architect`
- `implementation-engineer`
- `code-review-engineer`
- `test-engineer`
- `security-engineer`

Add `performance-engineer` when query or runtime performance is part of the change.

## Mandatory Verification Commands

Run the union required by `docs/ai/verification-matrix.md`.

### `fast`

- `npm run lint`
- `npm run typecheck`
- targeted tests when available, otherwise `npm test`
- `npm run build`

### `standard`

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run build`

Add route/auth browser checks when flows are affected:

- `npm run test:routes:tier0`
- `npm run ci:playwright`

### `critical`

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run build`

Add required domain gates:

- `npm run validate:tenant` for migrations/RLS/grants/RPC/tenant-scope changes
- `npm run test:routes:tier0` for route/auth/session-protected flow impact
- `npm run ci:playwright` for auth/session browser coverage

When required checks do not depend on protected systems/secrets, also run:

- `npm run verify:local`

## Hard Blockers

A task is blocked from completion when any item below is true:

- lane is missing or ambiguous
- touched paths are `critical` but task was not escalated
- required verification checks are missing without explicit blocked reason
- required reviewer pass is missing for non-trivial work
- `critical` work is not linked to a Linear issue
- PR hygiene output is missing or `pr-ready: no`

## PR Wait Policy (No Indefinite Hangs)

After opening a PR for autonomous work:

- move the Linear issue to `In Review` and post a "waiting on checks" note
- poll required checks every 3 minutes
- use a hard timeout of 45 minutes per PR

Outcomes:

- all required checks pass within timeout:
  - merge or mark ready to merge
  - move issue to `Done`
- any required check fails:
  - move issue to `In Progress`
  - post failing checks and next fix action
- checks still pending at timeout:
  - move issue to `Blocked`
  - label as waiting on checks/human approval
  - post exact next action and continue the queue

Never block the whole autonomous batch on one pending PR.

## Required Handoff Card

All non-trivial tasks must include this artifact:

- `classification`: `low-risk autonomous` | `high-risk human-reviewed` | `blocked pending clarification`
- `lane`: `fast` | `standard` | `critical` | `blocked`
- `files touched`: explicit files/globs
- `required agents`: exact sequence used
- `required checks`: exact command list
- `executed checks`: command -> pass/fail
- `blocked checks`: command -> reason (or `none`)
- `reviewer`: completed or blocked
- `residual risk`: short statement
- `pr handoff`: ready or missing prerequisites

Copy/paste template: `docs/ai/lane-handoff-template.md`

## Escalation Rules

- If scope expands into a `critical` path at any point, re-route immediately to `critical`.
- If classification cannot be justified with explicit files/behaviors, mark `blocked`.
- If checks fail, loop implementation -> review -> testing until blockers are closed.
