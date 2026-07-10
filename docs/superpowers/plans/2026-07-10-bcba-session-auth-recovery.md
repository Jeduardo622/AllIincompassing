# BCBA Session Auth Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover confirmed stale Supabase sessions and make confirmed already-started conflicts idempotent.

**Architecture:** Preserve structured response metadata at the two existing boundaries. Session-start recovery is local to its domain adapter; auth-query recovery is local to `AuthProvider` and reuses fail-closed cleanup.

**Tech Stack:** React, TypeScript, Supabase JS, Vitest.

## Global Constraints

- Linear issue WIN-217 is required.
- Only `rpcCode: "ALREADY_STARTED"` is idempotent.
- Only Supabase query `status === 401` initiates stale-session cleanup.
- No permission, schema, RLS, server, Edge, billing, or runtime-config changes.

---

### Task 1: Session-start idempotency

**Files:**
- Modify: `src/features/scheduling/domain/sessionStart.ts`
- Test: `src/features/scheduling/domain/__tests__/sessionStart.test.ts`

**Interfaces:**
- Consumes: `/api/sessions-start` JSON response containing optional `rpcCode`.
- Produces: `startSessionFromModal(request): Promise<void>` that resolves for 2xx and confirmed `ALREADY_STARTED` only.

- [ ] Add failing tests for `ALREADY_STARTED` resolution and `INVALID_STATUS` rejection.
- [ ] Run the focused test and confirm the new test fails for the expected conflict.
- [ ] Parse the fallback payload before error normalization and return only for status 409 plus `rpcCode === "ALREADY_STARTED"`.
- [ ] Run the focused test and confirm all cases pass.

### Task 2: Confirmed stale-auth cleanup

**Files:**
- Modify: `src/lib/authContext.tsx`
- Test: existing focused `src/lib/__tests__/authContext*.test.tsx` fixture selected after inspection

**Interfaces:**
- Consumes: Supabase query results with numeric `status`.
- Produces: auth fetch results that distinguish data, transient failure, and unauthorized failure.

- [ ] Add a failing test showing query status 401 clears user/session/profile/role and signs out.
- [ ] Add a control proving a 503 profile failure preserves current signed-in behavior.
- [ ] Run the focused auth test and confirm the 401 case fails before implementation.
- [ ] Preserve query status and invoke the existing fail-closed cleanup only for confirmed 401.
- [ ] Run the focused auth test and confirm both cases pass.

### Task 3: Critical-lane closure

**Files:**
- Create: `docs/ai/2026-07-10-bcba-session-auth-recovery-handoff.md`

**Interfaces:**
- Consumes: route classification, executed commands, reviews, and live PR state.
- Produces: verification card and PR-ready handoff linked to WIN-217.

- [ ] Run targeted tests.
- [ ] Run `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run test:routes:tier0`, and `npm run build`.
- [ ] Run `npm run ci:playwright` and `npm run verify:local` when the required environment is available; otherwise record exact blockers.
- [ ] Obtain code-review and security-review passes.
- [ ] Write the verification card, run PR hygiene, commit, push, and open a human-reviewed PR.
