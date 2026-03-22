---
name: supabase-tenant-safety
description: Protect tenant isolation and privileged Supabase changes in this repository. Use when work touches `supabase/migrations/**`, `supabase/functions/**`, RLS, grants, RPC exposure, org-scoped reads or writes, tenant scoping, or any data-path change that could widen access across organizations.
---

# Supabase Tenant Safety

## Overview

Use this skill after `route-task` for database, edge-function, and org-scope work that can affect schema, access policy, or tenant boundaries. Treat matching tasks as high-risk and human-reviewed by default.

Sources of truth:
- `AGENTS.md`
- `docs/ai/verification-matrix.md`
- `docs/ai/high-risk-paths.md`
- `.agents/skills/route-task/SKILL.md`
- `.agents/skills/verify-change/SKILL.md`

## Trigger Conditions

Use this skill when any of the following are true:
- files include `supabase/migrations/**` or `supabase/functions/**`
- the task changes RLS, grants, RPC exposure, org or tenant scoping, or privileged data access
- the task changes how data is filtered, joined, inserted, updated, or deleted across tenant boundaries

## Workflow

1. Confirm the task classification from `route-task`. Matching work should resolve to `high-risk human-reviewed`.
2. Identify the risk surface:
   - schema change
   - migration or backfill
   - RLS or grants
   - RPC exposure
   - edge-function auth or org scope
   - tenant-scoped read or write path
3. State the intended tenant boundary before making changes:
   - which org or tenant can read
   - which org or tenant can write
   - whether cross-tenant access must remain impossible
4. Inspect the current schema, policies, and function behavior before editing. Reuse the existing authority and scoping patterns.
5. Check for high-risk mistakes:
   - missing tenant filters
   - broadened joins or fallback queries
   - overly broad service-role or admin behavior
   - RPCs callable outside the intended org scope
   - migrations that change policy without an obvious rollback story
6. For non-trivial work, use:
   - `tester` for validation planning and targeted reproduction
   - `reviewer` for authz, tenant isolation, and API-boundary review
7. Before finalizing, run `verify-change` and include the required database or tenant-isolation verification set.

## Minimum Verification Expectations

Database, RLS, migration, function, and tenant-isolation changes require:
- `npm run ci:check-focused`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`

Add these when user-facing access or session flows are affected:
- `npm run test:routes:tier0`
- `npm run ci:playwright`

## Output Requirements

Report:
- the tenant or org boundary involved
- what guarantees must remain true after the change
- the specific high-risk surface touched
- required verification and any blocked checks
- whether `reviewer` completed a tenant-isolation review
