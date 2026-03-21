# Week-1 Low-Risk Autonomy Runbook

## Purpose

Operate a narrow 1-week low-risk autonomy lane without changing auth, tenant isolation, CI policy, runtime config, deploy routing, or other protected surfaces.

## Allowed Scope

Week-1 candidates are limited to:

- docs and process updates
- evidence and report summaries
- safe `src/components/**` work
- safe frontend test-isolation work in non-sensitive test files
- tightly bounded render-only page work when explicitly scoped and kept out of routing, guards, data loading, auth, and tenant-sensitive behavior

Every candidate task must be classified with `route-task` before execution. If scope expands, re-run `route-task` immediately.

## Protected Paths And Excluded Work

Do not run low-risk autonomy in:

- `supabase/migrations/**`
- `supabase/functions/**`
- `src/server/**`
- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

Also exclude any task affecting billing, impersonation, guardian flows, RLS, grants, RPC exposure, tenant isolation, secrets, CI policy, deploy state, Supabase state, or real `.env*` files.

If a task touches any protected path or excluded area, remove it from this lane and reclassify it.

## Required Workflow

Use this sequence for every week-1 candidate:

1. `route-task`
2. implement only if the task remains `low-risk autonomous`
3. `verify-change` for non-trivial code or config work
4. `reviewer` before finalizing any non-trivial code or config work

Docs-only tasks stay in the lane only if they remain docs-only and do not rewrite repo policy. Any protected-path touch or scope expansion exits the lane immediately.

## Verification Rule

- Docs and process-only tasks: manually verify links, commands, file paths, and references.
- Non-doc low-risk code or config tasks: run `npm run verify:local` when the required checks are secret-free and locally runnable.
- `npm run verify:local` is the default baseline for non-trivial low-risk code or config work in safe paths. It is not required for docs-only work.

## Parallel Limits

- Maximum `2` mutating tasks in flight at once.
- Maximum `1` `npm run verify:local` run at a time.
- Parallel tasks must have single-purpose diffs and non-overlapping write sets.
- Do not edit shared docs or shared evidence files in parallel.

## Queue Structure

Maintain a `3 active + 2 backup` candidate queue for week 1:

- `3 active`: the next three low-risk candidates ready for `route-task`
- `2 backup`: reserve candidates to pull in if an active item is blocked or reclassified

Queue slots are candidate placeholders, not standing authorization. Every task still requires fresh `route-task` classification before execution.

## Graduation Checklist

Do not expand this lane until week 1 meets all of the following:

- `5` low-risk tasks completed with zero protected-path incursions
- all non-doc tasks used the correct verification path, including `npm run verify:local` where required
- zero major `reviewer` findings in auth, tenant isolation, CI policy, runtime config, or deployment safety
- zero automation or autonomous-task drift into CI changes, deploy changes, Supabase state changes, or `.env*` handling
- diffs remained small, single-purpose, and reviewable

## Advisory Boundary

Week-1 autonomy is advisory and narrow by design. It does not authorize CI edits, deploy actions, Supabase changes, automation setup, or access to real environment secrets.

If this runbook conflicts with `AGENTS.md`, `docs/ai/verification-matrix.md`, or `docs/ai/high-risk-paths.md`, those source-of-truth files take precedence.
