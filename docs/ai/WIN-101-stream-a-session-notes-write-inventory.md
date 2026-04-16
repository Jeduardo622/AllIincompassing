# WIN-101 Stream A — `client_session_notes` write-path inventory

Issue: **WIN-101** (Linear) — Session Data Collection 2.0 production-readiness (Stream A: server-authoritative session note writes).

**Merge order:** Stream A (this document) → Stream B (Playwright measurement roundtrip + CI wiring).

## Route-task (this slice)

- **classification:** `low-risk autonomous`
- **lane:** `standard`
- **Rationale:** Stream A verification found **no remaining browser direct mutations** on `client_session_notes` in app code; this slice adds documentation, a regression guard test, and an inline contract comment. It does **not** change server handlers, Netlify routing, or auth.
- **Original WIN-101 Stream A intent** (server/API parity) was **`critical` + `high-risk human-reviewed`**; that classification applies when **changing** `src/server/api/session-notes-upsert.ts`, the Netlify function, or client write routing. This PR does not do those edits.

## Goal

Ensure all **therapist/app** writes to `client_session_notes` go through the server-authoritative **`POST /api/session-notes/upsert`** path (`invokeSessionNoteUpsertApi` → `upsertClientSessionNoteForSession` / `createClientSessionNote` / `updateClientSessionNote` in `src/lib/session-notes.ts`), with **no** parallel direct Supabase `insert` / `update` / `upsert` / `delete` on that table from product code under `src/`.

## Scope

- **In scope:** `src/` application and shared lib (excluding `src/server/**`, `src/tests/**`, `src/**/__tests__/**`, `src/lib/generated/**`).
- **Out of scope:** RLS harness (`src/tests/security/rls.spec.ts` uses service client inserts/deletes), server REST usage in `src/server/api/**`, Stream B (Playwright/CI).

## Writes (mutations)

| Location | Kind | Routing |
|----------|------|---------|
| `src/lib/session-notes.ts` | Upsert (create/update) | **`callApi('/api/session-notes/upsert', …)`** via `invokeSessionNoteUpsertApi` — **authoritative** |

Optional request body field **`captureMergeGoalIds`** (camelCase JSON): when **updating** an existing row, the server merges **`goal_notes`** and **`goal_measurements`** only for those goal keys from the payload and leaves other goal keys as stored (see `src/server/api/session-notes-upsert.ts`). Live session **Save skills** / **Save behaviors** pass this list from `SessionModal` via `Schedule` → `upsertClientSessionNoteForSession`; **Save progress** omits it (full map write).

No other files under scoped `src/` perform `insert` / `update` / `upsert` / `delete` on `client_session_notes` (verified by manual grep and `client-session-notes-direct-write-guard.test.ts`).

## Reads (not Stream A writes)

| Location | Kind | Notes |
|----------|------|--------|
| `src/lib/session-notes.ts` | `select` | List/detail reads for UI; still uses Supabase client for **read** |
| `src/components/SessionModal.tsx` | `select` | Hydrate linked session note for modal |
| `src/components/ClientDetails/PreAuthTab.tsx` | `select` | Pre-auth usage stats |
| `src/features/scheduling/domain/sessionComplete.ts` | `select` | `goal_notes` for close-readiness check; session completion uses **`/api/sessions-complete`** |
| `src/server/api/sessions-complete.ts` | GET (server) | Server-side read of `goal_notes` |

## Exceptions

- **RLS / security tests** (`src/tests/security/rls.spec.ts`): service-role `insert` / `delete` for policy verification — **test harness only**, not product writes.
- **Reads** via Supabase client on `client_session_notes` remain **out of Stream A**; parity target here is **write** routing only.

## Stream B (not in this PR)

- Playwright measurement roundtrip script: `scripts/playwright-session-note-measurement-roundtrip.ts`
- CI reliability wiring per WIN-101 plan

## Residual risk

- Guard test follows PostgREST-style method chains; unusual formatting could theoretically evade detection — keep writes centralized in `session-notes.ts`.
- Future direct mutations would fail CI if added in scoped `src/` paths.
