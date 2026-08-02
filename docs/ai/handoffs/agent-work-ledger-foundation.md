# Agent Work Ledger Foundation Handoff

- Date: 2026-08-01
- Linear issue: `WIN-271`
- Plan: `C:\Users\test\Desktop\AllIincompassing\docs\superpowers\plans\2026-08-01-goal-directed-stateful-agent-work-ledger.md`
- Branch: `codex/agent-work-ledger-foundation`
- Rollout mode: local-only, `disabled` / `shadow` / `advisory` only

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the exact first implementation slice changes `supabase/migrations/**` and `supabase/functions/**` and introduces tenant-sensitive clinical workflow state that must remain local-only, read-only against assessment-domain truth, and fail closed.
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

This first slice is limited to plan Tasks 2-5. It does not include endpoint transport, UI, queue/runner/Cron work, shadow-parity scripting, or the fully containerized harness.

This slice must not perform hosted access, clinical mutations, autonomous approval, promotion, publication, billing, or signature behavior.

## Allowed Files And Surfaces

- `supabase/migrations/20260801090000_agent_work_ledger_core.sql`
- `supabase/functions/_shared/agent-work/contracts.ts`
- `supabase/functions/_shared/agent-work/state-machine.ts`
- `supabase/functions/_shared/agent-work/state-machine.test.ts`
- `supabase/functions/_shared/agent-work/policy.ts`
- `supabase/functions/_shared/agent-work/policy.test.ts`
- `supabase/functions/_shared/agent-work/events.ts`
- `supabase/functions/_shared/agent-work/events.test.ts`
- `supabase/functions/_shared/agent-work/repository.ts`
- `supabase/functions/_shared/agent-work/assessment-prep.ts`
- `supabase/functions/_shared/agent-work/assessment-prep.test.ts`
- `scripts/agent-work-ledger-security-contract.mjs`
- `package.json`
- `src/lib/generated/database.types.ts`
- `docs/ai/handoffs/agent-work-ledger-foundation.md`

For this slice, `agent_execution_traces` nullable foreign-key additions are in scope because they are part of the core schema task in the approved plan. Queue, runner, sweeper, API endpoint, UI, Docker harness, and shadow-parity files are out of scope until a fresh follow-on slice is routed.

## Explicit Non-Goals

- hosted Supabase, Netlify, production, GitHub push, or PR activity
- reading or modifying existing `.env*` files
- autonomous clinical approval, promotion, publication, billing, signature, or final clinical record creation
- migrating `ai-agent-optimized` to Responses / Agents SDK
- replacing authoritative assessment-domain tables with ledger payloads
- any endpoint, runner, sweeper, queue, Cron, UI, monitoring, retention, or container-harness work

## Stop Conditions

Stop immediately and re-scope if any task would:

- target a non-local Supabase URL, anon key, service-role key, or project ref
- widen into auth, billing, production deploy, Netlify routing, GitHub workflow changes, or local harness/container work not required for the exact first slice
- store PHI or raw clinical text in queue payloads, traces, events, logs, screenshots, or test artifacts
- permit duplicate effects, stale approvals, false completion, tenant leakage, or unverified mutation effects
- enable any objective beyond `needs_review`

Stop and re-route if the implementation needs:

- any `supabase/functions/agent-work-*` endpoint, runner, or sweeper file
- any UI file under `src/components/**` or `src/pages/**`
- any Docker-compose or local runtime bootstrap file
- any write into `assessment_documents`, `assessment_checklist_items`, or `assessment_structured_sections`

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

- Task 2, schema + RLS
  - `node scripts/agent-work-ledger-security-contract.mjs`
  - `npm run validate:tenant`
  - `npm run ci:check-focused`
  - `npm run typecheck`
  - `npm run lint`
- Task 3, state machine
  - `deno test supabase/functions/_shared/agent-work/state-machine.test.ts`
  - `npm run typecheck`
- Task 4, policy + events
  - `deno test supabase/functions/_shared/agent-work/policy.test.ts`
  - `deno test supabase/functions/_shared/agent-work/events.test.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
- Task 5, IEHP shadow adapter
  - `deno test supabase/functions/_shared/agent-work/assessment-prep.test.ts`
  - `npm run test:ci`
- Final integration boundary
  - `npm run build`

Additional local checks will be added at the point they become meaningful:

- `deno test supabase/functions/_shared/agent-work/*.test.ts`
- focused security-contract assertions against the local schema/RLS contract
- `npm run verify:local` as an optional umbrella proof once the local environment supports it cleanly

Checks currently not meaningful for this slice:

- `npm run test:routes:tier0`
- `npm run ci:playwright`

## Domain Authority Assumptions

- Authoritative assessment read model for the IEHP shadow adapter:
  - `assessment_documents`
  - `assessment_checklist_items`
  - `assessment_structured_sections`
  - the current IEHP review layout/query shape consumed by `src/components/ClientDetails/IehpFbaLayoutReview.tsx`
- Review ownership and approval role checks must use `user_roles` / `get_user_roles`, with the current bounded owner role set:
  - `admin`
  - `bcba`
  - `super_admin`
- Runtime policy authority for slice 1 must default fail closed:
  - local default mode: `disabled`
  - read-only observation allowed only in `shadow` or `advisory`
  - no mutating path may proceed when policy lookup is missing, unreadable, or returns an unsupported mode
- Test fixtures must remain synthetic or redacted and tenant-separated.

## Reviewer Notes

The first implementation checkpoint ends with:

- a local-only execution preflight
- critical-lane foundation handoff committed
- specialist guidance captured below
- no hosted access and no domain mutations enabled

## Specialist Findings

- specification-engineer:
  - narrowed the first slice to plan Tasks 2-5 only
  - required explicit owner-role source-of-truth via `user_roles` / `get_user_roles`
  - required the IEHP adapter to mirror the current review read model instead of inventing a second divergent checklist contract
- software-architect: pending
- security-engineer: pending
- supabase-reviewer: pending
- test-engineer: pending
- test-engineer:
  - task-level verification should follow the plan's Task 2-5 commands instead of the broad `verify:local` bundle
  - browser and route gates are not meaningful until the work expands into API transport or UI
- code-review-engineer: pending until implementation diff exists

## Rollback

- Keep ledger runtime mode `disabled`.
- Remove the local worktree or reset the branch locally if the local-only safety envelope cannot be maintained.
- Do not deploy or push any branch state without explicit authorization.
