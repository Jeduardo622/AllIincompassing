# Task 2E-B Report

- Date: 2026-08-12
- Worktree: `C:\Users\test\.codex\worktrees\payroll-timekeeping-capture`
- Branch: `codex/payroll-timekeeping-capture`
- Base: `941e5217`
- Issue: `WIN-219`
- Route classification: `low-risk autonomous`
- Lane: `standard`

## Scope

Implemented only the Task 2E-B durable lifecycle outbox slice:

- `src/features/payroll/outbox.ts`
- `src/features/payroll/__tests__/outbox.test.ts`
- `.superpowers/sdd/2026-08-11-payroll-grade-timekeeping/task-2e-b-report.md`
- `.superpowers/sdd/2026-08-11-payroll-grade-timekeeping/progress.md`

Non-goals preserved:

- no server, transport, migration, session orchestration, UI, or hosted changes
- no `ALREADY_TERMINAL` handling
- no clinical note or PHI persistence/passthrough
- no `.env` access
- no package or reliability artifact drift

## TDD Evidence

### RED

Command:

```powershell
npx vitest run src/features/payroll/__tests__/outbox.test.ts src/features/payroll/__tests__/usePayrollTime.test.tsx --reporter=verbose
```

Observed failures before implementation:

- retained attendance rows were deleted instead of being preserved as `confirmed_pending_clinical`
- retained rows were still replayed during normal drain
- scoped helpers for retained reconfirm/replay and clear did not exist

### GREEN

Command:

```powershell
npx vitest run src/features/payroll/__tests__/outbox.test.ts src/features/payroll/__tests__/usePayrollTime.test.tsx --reporter=verbose
```

Result:

- `2 passed` files
- `21 passed` tests

## Implementation Summary

- Added durable local retention metadata for session-attendance outbox rows with the new `confirmed_pending_clinical` state while keeping the clinical-retention flag local-only and never forwarding it to the payroll API.
- Changed normal drain so exact-key-confirmed retained attendance rows transition to `confirmed_pending_clinical` instead of being removed, while ordinary `/time` events and non-retained attendance rows keep the prior delete-on-confirm behavior.
- Kept normal drain and recovery non-poisoning by skipping retained confirmed rows, preserving original `idempotencyKey` and `occurredAt`, and continuing to reset only transient initial-drain `replaying` rows back to `pending`.
- Added scoped retained-attendance helpers to reconfirm one retained row with its original key before clinical retry and to clear exactly one retained row only after a matching caller-reported compatible success key.
- Hardened retained helper guards so replay/clear reject wrong scope, wrong key/state/action, mismatched server key, `needs_attention`, and cross-org/user same-key collisions without breaking the per-scope serialized operation chain.

## Verification Card

- Classification: `low-risk autonomous`
- Lane: `standard`
- Change type:
  - client utility/state persistence
  - focused browser-backed IndexedDB proof
- Required checks:
  - `npx vitest run src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/outbox.test.ts src/features/payroll/__tests__/usePayrollTime.test.tsx tests/scripts/playwright-payroll-time-capture.test.ts --reporter=verbose`
  - `npx tsx scripts/playwright-payroll-time-capture.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - `npx vitest run src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/outbox.test.ts src/features/payroll/__tests__/usePayrollTime.test.tsx tests/scripts/playwright-payroll-time-capture.test.ts --reporter=verbose` -> `pass` (`4` files, `34` tests)
  - `npx tsx scripts/playwright-payroll-time-capture.ts` -> `pass` with `{"ok":true,"queuedBeforeReconnect":2,"queuedAfterReconnect":0,"confirmedKeys":["time-proof-key-1","attendance-proof-key-1"]}`
  - `npm run ci:check-focused` -> `pass`
  - `npm run lint` -> `pass`
  - `npm run typecheck` -> `pass`
  - `npm run build` -> `pass`
  - `npm run verify:local` -> `fail outside slice`; `ci:check-focused`, `lint`, and `typecheck` passed inside that aggregate run before `test:ci` hit repo-wide `ai-documentation` network-path stderr and then a Vitest heap OOM
- Blocked checks:
  - `npm run verify:local` -> blocked by unrelated repository-wide `test:ci` instability (`ai-documentation` fetch failure stderr plus heap exhaustion), not by the payroll outbox slice
- Result: `pass-with-blocked-checks`
- Residual risk:
  - The owned outbox/browser slice is covered by focused unit and direct IndexedDB proof, but the repository-wide aggregate gate is not currently clean because of unrelated `test:ci` instability outside this scope.

## PR Hygiene

- `pr-ready`: no
- `lane`: `standard`
- `branch-ready`: yes
- `linear-ready`: yes (`WIN-219`)
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none
- `protected-path drift`: none
- `change summary`: present
- `verification summary`: present
- `pr handoff`: missing separate reviewer completion and push/PR creation in the parent workflow
- `reviewer`: blocked in this implementation-only slice; separate code-review-engineer pass still required by repo workflow
- `required follow-up`:
  - obtain focused code-review-engineer review on `outbox.ts` retained-state guards and serialization
  - decide whether to chase the unrelated repo-wide `verify:local` failure before broader Task 2 closure
- `handoff summary`:
  - This slice adds durable local retention for confirmed session-attendance outbox rows without widening transport or server scope.
  - Normal drain now preserves retained attendance as `confirmed_pending_clinical`, skips it on later recovery/drain, and exposes explicit scoped reconfirm/clear helpers with collision and state guards.
  - Focused payroll API/outbox/hook/browser verification passed, including the direct loopback IndexedDB replay proof.
  - The only non-green evidence is the unrelated repo-wide `verify:local` failure at `test:ci`, which terminated with `ai-documentation` stderr followed by a Vitest heap OOM outside this slice.
