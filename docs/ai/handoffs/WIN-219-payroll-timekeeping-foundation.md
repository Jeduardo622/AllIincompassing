# WIN-219 Payroll Timekeeping Foundation Handoff

- Date: 2026-08-11
- Linear issue: `WIN-219` (reused and updated per owner direction)
- Branch: `codex/payroll-timekeeping-design`
- Plan: `docs/superpowers/plans/2026-08-11-payroll-grade-timekeeping.md`

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: this slice adds tenant-scoped payroll tables, RLS, grants, security-definer RPCs, append-only source records, and generated database types.
- triggering paths: `supabase/migrations/**`, payroll RPC/RLS surfaces, and `src/lib/generated/database.types.ts`

## Scope

- task intent: establish the default-disabled, provider-neutral payroll timekeeping foundation with separate payroll and insurance/audit attendance clocks.
- allowed behavior: self payroll clocking; assigned session attendance by the employee or an explicitly capable scheduler/admin; self correction requests; manager review visibility; explicit payroll-admin compensation access.
- non-goals: UI, automatic payroll time from sessions, automatic clock-out, payroll calculation/export execution, hosted activation, deployment, or merge.
- single-purpose diff: yes

## Required Agents

- required sequence: specification, architecture, implementation, code review, test, security, and Supabase review
- agents used: all required roles, including scoped fix re-reviews
- reviewer: completed; final code, security, Supabase, and test verdicts have no open Critical or Important finding

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/migration/tenant isolation, RPC exposure, TypeScript contracts, generated database types, and local security harness
- required checks:
  - focused payroll contract tests
  - exact-loopback Postgres security contract
  - fresh local Supabase reset
  - `npm run ci:check-focused`
  - `npm run lint -- --quiet`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - focused payroll Vitest set: pass, 6 files / 37 tests
  - `PAYROLL_LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/payroll-timekeeping-security-contract.mjs`: pass
  - `npx supabase db reset --local`: pass; exact-loopback security contract also passed immediately after reset
  - `npm run ci:check-focused`: pass
  - `npm run lint -- --quiet`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `git diff --check`: pass; line-ending notices only
  - `npm run test:ci`: fail outside the payroll slice during AI transcription tests and aggregate coverage execution
  - `npm run verify:local`: fail because its `test:ci` phase hits the same unrelated failures
  - post-rebase focused payroll Vitest set, exact-loopback security contract, `npm run ci:check-focused`, `npm run validate:tenant`, and `npm run build`: pass on rebased head
- blocked checks:
  - `npm run test:ci`: unrelated AI documentation transcription attempts receive `ECONNREFUSED`; a coverage worker then exhausts a 4 GB heap and closes its IPC channel
  - `npm run verify:local`: blocked by the same `test:ci` failure before later umbrella steps run
- checks not applicable:
  - `npm run test:routes:tier0`: no UI, auth, routing, login, or user-facing route behavior changed
  - `npm run ci:playwright`: no browser/auth/session route behavior changed
  - responsive UI observer: no visible UI files changed
- result: `pass-with-blocked-checks`
- residual risk: repository-wide coverage remains unstable locally; critical-lane human review and required CI are still mandatory before merge.

## PR Hygiene

- branch-ready: yes; four focused commits are rebased onto current `origin/main`
- linear-ready: yes; `WIN-219` is In Progress with current scope, review, and verification comments
- protected-path drift: expected migration/RLS/RPC changes only
- unrelated changes: none identified
- generated artifact drift: none; database types were regenerated from the clean local schema
- verification summary: present
- pr-ready: yes, with the repository-wide `test:ci` / `verify:local` failure disclosed as a blocked unrelated check
- required follow-up: push and open a critical-lane PR, require human review and CI, and do not merge while required checks or approval are outstanding

## Handoff Summary

Task 1 establishes a default-disabled payroll timekeeping schema and stable RPC boundary while keeping payroll time separate from insurance/audit session attendance. It includes event-effective employment binding, pay-group-scoped locks, append-only corrections, tenant-safe RLS, explicit delegated-attendance authority, and compensation privacy. Focused tests, clean reset, executable local security proof, policy, lint, typecheck, tenant validation, and build pass; the unrelated repository-wide coverage failure remains explicitly blocked for CI/human review.
