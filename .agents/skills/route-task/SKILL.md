---
name: route-task
description: Classify a requested task before implementation as low-risk autonomous, high-risk human-reviewed, or blocked pending clarification for this repository.
---
# Route Task

## Purpose

Use this skill before implementation to choose exactly one routing class for the task.

Sources of truth:
- `AGENTS.md`
- `docs/ai/verification-matrix.md`
- `docs/ai/high-risk-paths.md`

## Classes

Choose exactly one:

1. `low-risk autonomous`
2. `high-risk human-reviewed`
3. `blocked pending clarification`

## Decision Rules

### `low-risk autonomous`

Use when the task is confined to low-risk UI, page, docs, tests, or non-sensitive utility work and does not touch high-risk paths from `AGENTS.md`.

For docs-only work, `reviewer` and `verify-change` are not required.
For non-trivial code or config work that still stays low risk, `reviewer` and `verify-change` are still required by repo policy.

Required output:
- why it is low risk in this repo
- which files or paths triggered the decision
- `reviewer required`: yes for non-trivial code or config work; no for docs-only work
- `verify-change required`: yes for non-trivial code or config work; no for docs-only work
- minimum verification expected from `docs/ai/verification-matrix.md`
  - include `npm run verify:local` whenever the required checks do not need secrets or protected external systems

### `high-risk human-reviewed`

Use when the task touches any high-risk path or changes auth, runtime config, server/API boundaries, tenant isolation, secrets, CI policy, deploy routing, or other blast-radius-heavy behavior.

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
- why it is high risk in this repo
- which files or paths triggered the decision
- `reviewer required`: yes
- `verify-change required`: yes
- minimum verification expected from `docs/ai/verification-matrix.md`
  - include `npm run verify:local` whenever the required checks do not need secrets or protected external systems, then add any extra required checks

### `blocked pending clarification`

Use when the task cannot be routed safely because scope, target files, expected behavior, or environment assumptions are unclear enough that implementation would be unsafe.

Examples:
- the request implies risky auth, migration, workflow, or deploy changes but does not say which files or intended behavior
- the request conflicts with existing repo guardrails
- the request refers to a path or system that cannot be found or identified confidently

Required output:
- why the task is blocked
- which files, paths, or missing details triggered the block
- `reviewer required`: not yet; required once the task is unblocked if it resolves to high-risk work
- `verify-change required`: not yet
- minimum verification expected: none until scope is clarified

## Output Format

- `classification`: exactly one of the three classes above
- `why`: short repo-specific reason
- `triggering paths`: explicit files or globs
- `reviewer required`: yes or no
- `verify-change required`: yes or no
- `minimum verification`: exact commands or `none until clarified`

## Examples

### `src/components/**` UI tweak

- classification: `low-risk autonomous`
- why: limited to UI behavior and does not cross auth, server, CI, or deploy boundaries
- triggering paths: `src/components/**`
- reviewer required: yes
- verify-change required: yes
- minimum verification:
  - `npm run verify:local`
  - `npm run lint`
  - `npm run typecheck`
  - targeted tests or `npm test`
  - `npm run build`

### `src/lib/auth*` change

- classification: `high-risk human-reviewed`
- why: auth and role logic directly control access boundaries
- triggering paths: `src/lib/auth*`
- reviewer required: yes
- verify-change required: yes
- minimum verification:
  - `npm run verify:local`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run build`
  - `npm run ci:playwright` when secrets are available or in CI

### `supabase/migrations/**` change

- classification: `high-risk human-reviewed`
- why: migrations can change schema, RLS, grants, RPCs, and tenant boundaries
- triggering paths: `supabase/migrations/**`
- reviewer required: yes
- verify-change required: yes
- minimum verification:
  - `npm run verify:local`
  - `npm run ci:check-focused`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`

### `.github/workflows/**` change

- classification: `high-risk human-reviewed`
- why: workflows define actual CI gates, required checks, and secret-backed behavior
- triggering paths: `.github/workflows/**`
- reviewer required: yes
- verify-change required: yes
- minimum verification:
  - `npm run verify:local`
  - validate the affected workflow directly
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - add `npm run test:ci` and `npm run build` if the workflow affects app verification behavior

### docs-only change

- classification: `low-risk autonomous`
- why: docs-only work does not change runtime behavior or policy enforcement by itself
- triggering paths: `docs/**`
- reviewer required: no
- verify-change required: no
- minimum verification:
  - verify links, commands, and file paths manually

## Notes

- If multiple files are involved, route by the highest-risk touched path.
- If the task starts low risk and later touches a high-risk path, reclassify it immediately.
- When required checks do not need secrets or protected external systems, include `npm run verify:local` as part of the expected verification baseline.
