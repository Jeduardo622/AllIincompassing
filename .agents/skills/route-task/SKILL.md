---
name: route-task
description: Route a task before implementation into a deterministic lane (`fast`, `standard`, `critical`, or `blocked`) and emit required hard-gate outputs for this repository.
---
# Route Task

## Purpose

Use this skill before implementation to choose exactly one lane and one classification for the task.
This is a hard gate for non-trivial work.

Sources of truth:

- `AGENTS.md`
- `docs/ai/cto-lane-contract.md`
- `docs/ai/verification-matrix.md`
- `docs/ai/high-risk-paths.md`

## Required Outputs

Always emit both:

- `classification`: `low-risk autonomous` | `high-risk human-reviewed` | `blocked pending clarification`
- `lane`: `fast` | `standard` | `critical` | `blocked`

## Lane And Classification Mapping

Choose exactly one:

1. `fast` + `low-risk autonomous`
2. `standard` + `low-risk autonomous`
3. `critical` + `high-risk human-reviewed`
4. `blocked` + `blocked pending clarification`

## Decision Rules

### `fast` (`low-risk autonomous`)

Use when the task is docs/process only or a small low-risk UI/content change and does not touch high-risk paths or protected behaviors.

For docs-only work, `reviewer` and `verify-change` are not required.
For small code/config updates in this lane, still require both `reviewer` and `verify-change`.

Required output:

- why it is `fast` in this repo
- which files or paths triggered the decision
- `required agents`:
  - docs/process only: none
  - otherwise: `specification-engineer` -> `implementation-engineer` -> `code-review-engineer`
- `reviewer required`: yes for any non-doc code/config work; no for docs/process only
- `verify-change required`: yes for any non-doc code/config work; no for docs/process only
- `mandatory checks` from `docs/ai/verification-matrix.md`

### `standard` (`low-risk autonomous`)

Use for non-trivial code/config work outside protected paths.
This lane is never docs-only.

Required output:

- why it is `standard` in this repo
- which files or paths triggered the decision
- `required agents`:
  - `specification-engineer` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer`
  - add `security-engineer` when auth/input/secrets/integration risk exists
  - add `performance-engineer` when query/runtime performance risk exists
- `reviewer required`: yes
- `verify-change required`: yes
- `mandatory checks` from `docs/ai/verification-matrix.md`

### `critical` (`high-risk human-reviewed`)

Use when any high-risk path is touched or behavior affects auth, runtime config, server/API boundaries, tenant isolation, RLS, grants, RPC exposure, secrets, CI policy, or deploy routing.

Trigger paths include:

- `supabase/migrations/**`
- `supabase/functions/**`
- `src/server/**`
- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

Required output:

- why it is `critical` in this repo
- which files or paths triggered the decision
- `required agents`:
  - `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer`
  - add `performance-engineer` for query/runtime performance risk
- `reviewer required`: yes
- `verify-change required`: yes
- `mandatory checks` from `docs/ai/verification-matrix.md`
- `linear required`: yes (must be linked before PR-ready state)

### `blocked` (`blocked pending clarification`)

Use when the task cannot be routed safely because scope, target files, expected behavior, or environment assumptions are unclear enough that implementation would be unsafe.

Examples:

- the request implies risky auth, migration, workflow, or deploy changes but does not say which files or intended behavior
- the request conflicts with existing repo guardrails
- the request refers to a path or system that cannot be found or identified confidently

Required output:

- why the task is blocked
- which files, paths, or missing details triggered the block
- `lane`: `blocked`
- `classification`: `blocked pending clarification`
- `reviewer required`: not yet; required once the task is unblocked if it resolves to high-risk work
- `verify-change required`: not yet
- `mandatory checks`: none until clarified

## Output Format

- `classification`: exactly one supported value
- `lane`: exactly one supported value
- `why`: short repo-specific reason
- `triggering paths`: explicit files or globs
- `required agents`: ordered list
- `reviewer required`: yes or no
- `verify-change required`: yes or no
- `mandatory checks`: exact commands or `none until clarified`
- `blocking conditions`: list of what must be true before implementation or handoff can proceed
- `linear required`: yes or no

## Examples

### `src/components/**` UI tweak

- classification: `low-risk autonomous`
- lane: `standard`
- why: limited to UI behavior and does not cross auth, server, CI, or deploy boundaries
- triggering paths: `src/components/**`
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- reviewer required: yes
- verify-change required: yes
- mandatory checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - add `npm run test:routes:tier0` and `npm run ci:playwright` when route/auth/session flows are affected
- blocking conditions:
  - missing required verification output from `verify-change`
  - missing `reviewer` completion

### `src/lib/auth*` change

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: auth and role logic directly control access boundaries
- triggering paths: `src/lib/auth*`
- required agents:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- reviewer required: yes
- verify-change required: yes
- mandatory checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run build`
  - `npm run ci:playwright` when secrets are available or in CI
  - `npm run verify:local` when local environment supports required checks
- linear required: yes
- blocking conditions:
  - no human reviewer sign-off
  - no Linear issue linkage
  - missing required check evidence

### `supabase/migrations/**` change

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: migrations can change schema, RLS, grants, RPCs, and tenant boundaries
- triggering paths: `supabase/migrations/**`
- required agents:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- reviewer required: yes
- verify-change required: yes
- mandatory checks:
  - `npm run ci:check-focused`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local` when local environment supports required checks
- linear required: yes

### `.github/workflows/**` change

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: workflows define actual CI gates, required checks, and secret-backed behavior
- triggering paths: `.github/workflows/**`
- required agents:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- reviewer required: yes
- verify-change required: yes
- mandatory checks:
  - validate the affected workflow directly
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - add `npm run test:ci` and `npm run build` if the workflow affects app verification behavior
  - `npm run verify:local` when local environment supports required checks
- linear required: yes

### docs-only change

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs-only work does not change runtime behavior or policy enforcement by itself
- triggering paths: `docs/**`
- required agents: none
- reviewer required: no
- verify-change required: no
- mandatory checks:
  - verify links, commands, and file paths manually
- blocking conditions:
  - none if scope remains docs/process only

## Notes

- If multiple files are involved, route by the highest-risk touched path.
- If the task starts as `fast` or `standard` and later touches a high-risk path, re-route to `critical` immediately.
- Never begin implementation while lane is `blocked`.
- Use `docs/ai/cto-lane-contract.md` as the lane source of truth.
