# Agent Work Ledger Foundation Handoff

- Date: 2026-08-01
- Linear issue: `WIN-271`
- Plan: `C:\Users\test\Desktop\AllIincompassing\docs\superpowers\plans\2026-08-01-goal-directed-stateful-agent-work-ledger.md`
- Branch: `codex/agent-work-ledger-foundation`
- Rollout mode: local-only, `disabled` / `shadow` / `advisory` only

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the first implementation slice changes `supabase/migrations/**` and `supabase/functions/**` and introduces tenant-sensitive clinical workflow state that must remain local-only and fail closed.
- triggering paths:
  - `supabase/migrations/**`
  - `supabase/functions/**`
  - `scripts/agent-work-ledger-security-contract.mjs`
  - `package.json`
  - `src/lib/generated/database.types.ts`
  - `docs/ai/handoffs/agent-work-ledger-foundation.md`

## Task Intent

Implement the bounded local-first foundation for the Agent Work Ledger:

- tenant-safe ledger schema and RLS
- shared state machine, policy, and sanitized event utilities
- IEHP assessment shadow adapter that stops at `needs_review`
- local Docker Supabase plus host-run verification against local URLs only

This slice must not perform hosted access, clinical mutations, autonomous approval, promotion, publication, billing, or signature behavior.

## Allowed Files And Surfaces

- `supabase/migrations/20260801090000_agent_work_ledger_core.sql`
- `supabase/functions/_shared/agent-work/**`
- `scripts/agent-work-ledger-security-contract.mjs`
- `scripts/agent-work-ledger-shadow-parity.mjs`
- `package.json`
- `src/lib/generated/database.types.ts`
- `docs/ops/agent-work-ledger.md`
- `docs/ai/handoffs/agent-work-ledger-foundation.md`
- local-only Docker / Supabase configuration and harness files required to keep all execution on localhost

## Explicit Non-Goals

- hosted Supabase, Netlify, production, GitHub push, or PR activity
- reading or modifying existing `.env*` files
- autonomous clinical approval, promotion, publication, billing, signature, or final clinical record creation
- migrating `ai-agent-optimized` to Responses / Agents SDK
- replacing authoritative assessment-domain tables with ledger payloads
- broad UI surface expansion beyond what is necessary to inspect the shadow workflow locally

## Stop Conditions

Stop immediately and re-scope if any task would:

- target a non-local Supabase URL, anon key, service-role key, or project ref
- widen into auth, billing, production deploy, Netlify routing, or GitHub workflow changes not required for the local harness
- store PHI or raw clinical text in queue payloads, traces, events, logs, screenshots, or test artifacts
- permit duplicate effects, stale approvals, false completion, tenant leakage, or unverified mutation effects
- enable any objective beyond `needs_review`

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
  - `supabase-reviewer`
- reviewer required: yes
- verify-change required: yes
- linear required: yes

## Mandatory Checks For This Slice

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- `npm run verify:local`
- `node scripts/agent-work-ledger-security-contract.mjs`
- `node scripts/agent-work-ledger-shadow-parity.mjs`

Additional local checks will be added at the point they become meaningful:

- `deno test supabase/functions/_shared/agent-work/*.test.ts`
- focused Vitest coverage for new UI or client helpers
- local Docker harness checks and repeated clean-run proof

## Local Architecture Guardrails

- Dockerized Supabase is the only allowed database / Edge authority target.
- All Supabase URLs and credentials used by local commands must resolve to localhost.
- Integration commands must fail closed before execution if any Supabase URL, key, or ref is non-local or missing.
- Migrations and resets may run only against local Postgres.
- Edge functions may run only through the local Supabase stack.
- Test fixtures must remain synthetic or redacted and tenant-separated.

## Reviewer Notes

The first implementation checkpoint ends with:

- a local-only execution preflight
- critical-lane foundation handoff committed
- specialist guidance captured below
- no hosted access and no domain mutations enabled

## Specialist Findings

- specification-engineer: pending
- software-architect: pending
- security-engineer: pending
- supabase-reviewer: pending
- test-engineer: pending
- code-review-engineer: pending until implementation diff exists

## Rollback

- Keep ledger runtime mode `disabled`.
- Remove the local worktree or reset the branch locally if the local-only safety envelope cannot be maintained.
- Do not deploy or push any branch state without explicit authorization.
