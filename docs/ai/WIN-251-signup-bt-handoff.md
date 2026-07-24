# WIN-251 BT Signup Role Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: signup role resolution is an authentication boundary implemented by a Supabase migration.
- triggering paths: `supabase/migrations/**`

## Scope

- task intent: resolve public BT signup metadata to exact `bt` while keeping guardian/client mappings and fail-closed unknown roles.
- non-goal: no backfill or repair of existing user-role rows; this is forward-only signup normalization.
- files touched: one forward migration, one contract test, this handoff.
- single-purpose diff: yes

## Required Agents

- agents used: implementation engineer, code review engineer, security engineer.
- security review: completed; approved.

## Verification Card

- executed checks:
  - focused signup-role contract test: pass.
  - `npm run ci:check-focused`: pass.
  - `npm run validate:tenant`: pass.
  - `npm run build`: pass.
- blocked checks:
  - full `npm run test:ci`: not rerun in this worktree after the guardian-safe parse correction; the shared suite is already failing in unrelated baseline tests on sibling WIN-251 branches.
  - DB-backed migration checks: `SUPABASE_DB_URL` is unavailable locally.
- result: pass-with-blocked-checks
- residual risk: legacy callers sending `therapist` metadata will intentionally receive the lower-privilege `bt` role; execution-level Postgres proof and human DB review remain required.

## PR Hygiene

- branch-ready: yes
- linear-ready: blocked by expired Linear OAuth grant; issue `WIN-251` exists.
- protected-path drift: none beyond the declared migration.
- unrelated changes: none.
- generated artifact drift: none.
- verification summary: present.
- pr-ready: yes, human review required.

## Handoff Summary

The resolver now maps both current `bt` and legacy `therapist` public signup metadata to exact `bt`, preserves guardian/client behavior even when guardian signup metadata is sent without an explicit role, safely parses malformed `guardian_signup` values without raising, and rejects unknown or privileged metadata. Policy, tenant-safety, focused contract, security review, and build checks passed.
