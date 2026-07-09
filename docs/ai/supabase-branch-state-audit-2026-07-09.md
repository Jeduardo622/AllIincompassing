# Supabase Branch State Audit - 2026-07-09

Status: follow-up audit item recorded; no branch mutation performed.

## Source

Read-only Supabase plugin call:

- tool: `mcp__codex_apps__supabase._list_branches`
- project: `wnnjeqheqxxyrgsjmygy`
- date: 2026-07-09

## Finding

The branch listing still contains historical branch records whose `status` is `MIGRATIONS_FAILED`, including:

- `codex/create-rls-migration-and-update-assertions`
- `codex/store-session-times-in-utc`
- `drift-fix-20251204`
- `fix/console-vet-dashboard-alias`
- `main`

It also contains old `pr-17*` branch records whose status is `FUNCTIONS_DEPLOYED`.

## Interpretation

This is branch-state residue, not proof that the current production database is unhealthy. The records are old and some may be Supabase preview-branch history rather than active deploy blockers.

Do not rely on branch-list status alone as a current preview readiness signal until an operator performs a separate branch hygiene pass.

## Recommended next action

Create a small operator-owned Supabase branch hygiene task:

1. Confirm which listed branch records are still active or billable.
2. Confirm whether any `MIGRATIONS_FAILED` records correspond to open PRs or active preview environments.
3. Remove only stale preview branches through approved Supabase branch tooling.
4. Re-run a read-only branch listing and attach the before/after artifact.

Branch deletion or reset is intentionally out of scope for this CI/readiness implementation slice.
