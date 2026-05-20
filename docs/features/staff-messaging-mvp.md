# Staff Messaging MVP — Policy & Implementation Plan

**Status:** Policy closure (docs-only). Implementation not started.  
**Branch context:** `Messaging`  
**Last updated:** 2026-05-20

This document is the **source of truth** for product/security decisions and slice boundaries for internal staff messaging. Future implementation slices must re-run `route-task` for the exact slice and must not contradict this policy without an explicit doc revision and human review.

---

## 1. Feature summary

Internal **staff-only** messaging for authenticated users with roles `super_admin`, `admin`, and `therapist`. Users can view threads they participate in, start conversations within permission rules, send text messages, mark threads read, archive/mute **their own** participation, and filter/search the inbox at a basic level (client-side or simple filters — no full-text search index in MVP).

Storage is **Supabase-backed** with **participant-only** Row Level Security. This is **not** the AI assistant (`conversations` / `chat_history`); staff messaging uses **new greenfield tables**.

---

## 2. MVP included capabilities

- Org-scoped message threads with explicit participants
- **1:1** threads (all eligible staff roles per permission model)
- **Group** threads (admins and super_admins only may create)
- Send and receive **plain text** messages
- Thread list with basic filter/search (e.g. unread, archived, subject/sender — no FTS)
- Mark read (participant-level cursor)
- Archive and mute (**participant-local** only)
- Recipient lookup: active staff in the same organization, limited to allowed roles
- Polling / refetch / manual refresh (no Realtime in MVP)

---

## 3. Explicitly excluded / deferred capabilities

| Excluded from MVP | Deferred to later slices |
|-------------------|-------------------------|
| PHI, client names, clinical details, client-sensitive content in message bodies | Attachments |
| Org-wide admin read of private message bodies | Message editing |
| User hard-delete of messages or threads | Push / email notifications |
| Adding participants after thread creation | Typing indicators, presence |
| Cross-org `super_admin` inbox without being a participant | Supabase Realtime broadcast |
| Full-text search index / global search RPC | Audited break-glass admin/compliance review |
| Per-message `message_reads` table (use participant `last_read_at`) | Formal retention enforcement job |
| Netlify API layer (unless a later slice proves direct PostgREST insufficient) | Reactions, moderation UI |

---

## 4. Accepted product/security decisions

1. **No PHI in staff messages for MVP** — enforced as product policy + UI language; not a database constraint alone.
2. **Participant-only access** — users may read/write only threads where they are listed on `message_thread_participants`.
3. **No default org-wide admin visibility** — org `admin` / `super_admin` without a participant row cannot read message bodies.
4. **Future compliance review** requires a **separate** break-glass / audited design (e.g. impersonation-audit-style), not widening default RLS.
5. **Therapists** may create **1:1** threads only.
6. **Admins and super_admins** may create **group** threads and message **active staff** in their org.
7. **No participant adds after create** in MVP — initial participant set is fixed at thread creation.
8. **super_admin** has **no cross-org** inbox/read unless they are an explicit participant for that org’s thread.
9. **Indefinite retention** until a formal retention policy is chosen (staff tables are **not** governed by AI chat 90-day rules in `docs/security/tenant-isolation.md`).
10. **Realtime, push, email, attachments, edit, hard-delete** are out of MVP.

---

## 5. PHI / client-sensitive content policy

**Rule:** Staff messaging must **not** include PHI, client names, clinical details, or other client-sensitive content.

**Product/UI requirements (MVP):**

- Prominent in-app notice on compose and thread views (e.g. banner or helper text).
- Composer placeholder and validation copy stating the prohibition.
- No client autolink, caseload picker, or client-ID fields in messaging UI.
- Prefer generic thread subjects; discourage pasting identifiers.

**Technical stance:**

- No DB column-level PHI scanner in MVP; policy is enforced by UX, training, and future compliance controls.
- Extend `src/lib/logger/redactPhi.ts` (and logging policy) to cover `message` body fields and `thread_id` **before** production logging of message payloads.
- Tests and fixtures must use **synthetic** content only (`AGENTS.md` data rules).

**Repo note:** Clinical PHI exists elsewhere (session notes, program notes, assessments). Those surfaces are **not** precedent for permissive staff chat content.

---

## 6. Role and permission model

| Action | therapist | admin | super_admin |
|--------|-----------|-------|-------------|
| View threads where participant | Yes | Yes | Yes (same org thread only) |
| Send messages in participant threads | Yes | Yes | Yes |
| Create 1:1 thread | Yes | Yes | Yes |
| Create group thread | **No** | Yes | Yes |
| Message active staff in org (as recipient) | Yes (1:1 create) | Yes | Yes |
| Add participants after create | **No** | **No** | **No** |
| Org-wide read without participant row | **No** | **No** | **No** |
| Cross-org read without participant row | **No** | **No** | **No** |

**Role source of truth:**

- **RLS and server:** `user_roles` + `app.user_has_role_for_org('therapist'|'admin'|'super_admin', organization_id)` — not `profiles.role` alone (`AGENTS.md`).
- **UI routes:** `RoleGuard` / `effectiveRole` from `src/lib/authContext.tsx` — must stay aligned with junction roles.

**Active staff (recipient eligibility):**

- Same `organization_id` as the acting user’s org context.
- Active row in `user_roles` for an allowed staff role (`is_active`, `expires_at` respected).
- User is not deactivated (`profiles.is_active` or equivalent product rule).

---

## 7. Data model proposal (conceptual)

**New tables only** — do not extend `conversations` or `chat_history`.

### `message_threads`

- `id` (uuid, PK)
- `organization_id` (uuid, FK, required)
- `created_by` (uuid, FK → auth user)
- `subject` (text, optional)
- `thread_type` (`direct` | `group`)
- `created_at`, `updated_at`

### `message_thread_participants`

- `thread_id` (uuid, FK)
- `user_id` (uuid, FK)
- `organization_id` (uuid, denormalized for policy checks)
- `joined_at`
- `last_read_at` (nullable — unread derived vs thread/message activity)
- `archived_at` (nullable — participant-local)
- `muted_at` (nullable — participant-local)
- Unique (`thread_id`, `user_id`)

### `messages`

- `id` (uuid, PK)
- `thread_id` (uuid, FK)
- `sender_id` (uuid, FK)
- `body` (text, non-empty, reasonable max length in app validation)
- `created_at`
- No `updated_at` (no edit in MVP)

**Thread creation:** Prefer a single **SECURITY DEFINER** RPC (e.g. `create_message_thread`) that atomically inserts thread + initial participants with org and role checks, rather than multi-step client inserts.

---

## 8. Access / RLS model proposal (conceptual)

### Allowed patterns

- Thread/message `SELECT` / `INSERT` only when `auth.uid()` has a participant row on that thread.
- Thread `organization_id = app.current_user_organization_id()` (or equivalent org resolution used by new migrations).
- Staff eligibility on create: `app.user_has_role_for_org` for allowed roles in that org.
- Participant row updates (`last_read_at`, `archived_at`, `muted_at`) only for `user_id = auth.uid()` on that participant row.

### Forbidden RLS patterns (do not copy from repo)

| Anti-pattern | Where it exists | Why forbidden |
|--------------|-----------------|---------------|
| `conversations_admin_access` — global admin SELECT | `supabase/migrations/20250922120000_secure_misc_tables_rls.sql` | Org-wide private inbox |
| `app.is_admin()` on message SELECT | `chat_history` policies | Global admin, not org-scoped |
| Org-wide `user_has_role_for_org('admin', organization_id)` **without** participant EXISTS | Some org-scoped tables | Admin sees all rows |
| Reuse / extend `conversations` or `chat_history` | AI assistant | Wrong ownership model |

### super_admin

- Same participant rules as other roles.
- No cross-org access unless listed as participant on a thread in that org.

### Break-glass (future)

- Separate design with audit trail; **must not** widen default SELECT policies on these tables.

---

## 9. UI / route proposal (conceptual)

**Routes** (top-level, consistent with `/schedule`, `/clients`):

- `/messages` — thread list (inbox)
- `/messages/new` — compose (1:1 or group per role)
- `/messages/:threadId` — thread detail + composer

**Guards:** `PrivateRoute` + `RoleGuard` with roles `['therapist','admin','super_admin']`.

**Sync surfaces when routes ship (four-way parity):**

- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/server/routes/guards.ts`
- `cypress/support/routeScenarios.ts`
- `tests/edge/route-guards-parity.test.ts`

**UI structure:**

- `src/pages/messages/` — list, new, detail
- `src/components/messages/` — `ThreadList`, `ThreadRow`, `MessageList`, `MessageComposer`, `StaffRecipientPicker`
- `src/lib/messages/` — queries/mutations (Supabase client + React Query)

**Reuse:** `Modal`, native `textarea`, `src/lib/toast.tsx`, `RouteLoadingSkeleton`, lucide icons.

**PHI copy:** Banner on list, new, and detail pages.

**Refresh:** React Query `refetchInterval` or manual refresh — no Realtime subscription in MVP.

---

## 10. Verification / testing strategy (future slices)

### Docs-only (this document)

- Manual review: internal consistency, alignment with `docs/ai/verification-matrix.md`, forbidden RLS patterns documented.
- No `npm run verify:local` required for docs-only (`route-task` fast lane).

### Cross-cutting (every implementation slice)

- Fresh `route-task` + `verify-change` verification card.
- `reviewer` + `tester` for non-doc slices.
- Skills: `supabase-tenant-safety` (schema/RLS), `auth-routing-guard` (routes), `playwright-regression-triage` (browser failures).

### Slice 1 — Schema + RLS

- `npm run ci:check-focused` (includes RLS coverage, migration governance, privileged grants)
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- **Add:** `tests/integration/rls.message-threads.access.test.ts` using `tests/integration/_helpers/liveRlsHarness.ts`
- **Prove:** non-participant deny; cross-org deny; same-org admin **not** participant deny; participant allow; therapist cannot create `group` at DB/RPC layer
- Regenerate `src/lib/generated/database.types.ts`
- **Lane:** `critical` — human review + Linear

### Slice 2 — Server / API (optional; may skip)

- **Default MVP path:** direct Supabase PostgREST under RLS — **skip Slice 2** unless product requires Netlify handlers.
- If implemented: `ci:check-focused`, `lint`, `typecheck`, `test:ci`, `build`; handler tests under `src/server/__tests__/`; user JWT only; no service-role inbox reads.

### Slice 3 — UI (list / detail / compose)

- `npm run lint`, `npm run typecheck`, targeted `npm test`, `npm run build`
- Colocated tests: `src/lib/messages/**`, `src/pages/messages/**`, `src/components/messages/**`
- Assert PHI policy strings in UI tests
- **No** tier0 / Playwright until routes slice unless using temporary dev-only route

### Slice 4 — Unread / archive / mute polish

- Extend integration tests for participant row updates
- Unit tests for unread badge (`last_read_at` vs thread activity) and archived/muted list filtering
- Same UI verification commands as Slice 3

### Routes slice (often after Slice 3; may merge if small)

- Add Auth/Routing matrix: `test:routes:tier0`, `ci:playwright` (or targeted `scripts/playwright-staff-messages-smoke.ts` before full aggregate)
- `tests/edge/route-guards-parity.test.ts`

### Out of MVP verification union

- Full `ci:playwright` suite for schema-only PRs
- `validate:tenant` as sole proof of messaging RLS (integration tests are the real gate)

---

## 11. Protected-path risks

| Risk | Mitigation |
|------|------------|
| Copying `conversations` / `chat_history` admin RLS | Forbidden patterns section; code review checklist |
| Org-wide admin SELECT on new tables | Participant EXISTS on all body reads |
| `user_roles` vs `profiles.role` drift | RLS uses junction; UI uses `effectiveRole`; parity tests |
| Org metadata drift on invite | RPC validates target user org + active role |
| PHI in logs | Extend `redactPhi` before production message logging |
| Service-role / edge bypass reads | Defer edge; if added, `requireOrg` + tenant safety script |
| Route/nav/guard drift | Four-way sync + Cypress tier0 |
| Indefinite retention vs AI 90-day docs | Document staff tables separately in runbooks |

**High-risk paths touched by implementation:** `supabase/migrations/**`, `src/App.tsx`, `src/components/Sidebar.tsx`, `src/server/routes/guards.ts`, optional `src/server/api/**`, `src/lib/generated/database.types.ts`.

---

## 12. Implementation slice plan

### Slice 0 — Policy closure (this document)

- **Goal:** Record accepted decisions and slice boundaries.
- **Allowed scope:** `docs/features/staff-messaging-mvp.md` only.
- **Likely files:** This file.
- **Protected-path posture:** None (`fast` lane).
- **Required agents/skills:** `route-task`, manual `verify-change` (docs).
- **Verification:** Manual doc review.
- **Stop conditions:** Conflict with accepted decisions; attempt to add migrations/code in same PR.

---

### Slice 1 — Database schema + participant-only RLS

- **Goal:** Create `message_threads`, `message_thread_participants`, `messages` with org binding, participant-only policies, and `create_message_thread` RPC; regenerate types.
- **Allowed scope:** `supabase/migrations/**`, `src/lib/generated/database.types.ts` only.
- **Likely files:** New migration SQL; generated types.
- **Protected-path posture:** **Critical** — human review, Linear issue, `supabase-tenant-safety`.
- **Required agents/skills:** `specification-engineer`, `implementation-engineer`, `code-review-engineer`, `test-engineer`, `security-engineer`, `verify-change`, `pr-hygiene`.
- **Verification:** `ci:check-focused`, `test:ci`, `validate:tenant`, `build`; add `tests/integration/rls.message-threads.access.test.ts` (may land in Slice 1b if split).
- **Stop conditions:** Any `app.is_admin()` or org-admin SELECT on bodies; cannot prove participant INSERT/SELECT; stakeholder requests org-wide admin read.

---

### Slice 1b — RLS integration proof (optional split from Slice 1)

- **Goal:** Live deny/allow matrix before UI.
- **Allowed scope:** `tests/integration/**` only.
- **Likely files:** `tests/integration/rls.message-threads.access.test.ts`.
- **Protected-path posture:** Standard/critical (tests gate schema).
- **Verification:** `npm run test:ci` (integration).
- **Stop conditions:** Live Supabase env unavailable with no CI plan to run integration tests.

---

### Slice 2 — Server / API / service layer (optional)

- **Goal:** Netlify handlers for thread/message operations **only if** direct Supabase client is insufficient.
- **Allowed scope:** `src/server/api/staff-messages.ts` (or similar), `src/server/__tests__/`, `netlify.toml` redirect **only if required**.
- **Likely files:** `src/server/api/*`, `src/server/api/shared.ts` patterns.
- **Protected-path posture:** **Critical** for `src/server/**` and `netlify.toml`.
- **Required agents/skills:** `security-engineer`, `verify-change`.
- **Verification:** Server/API matrix in `verification-matrix.md`.
- **Stop conditions:** Handler needs service-role read of message bodies; bypasses RLS.

**Default:** **Skip Slice 2** for MVP; use `src/lib/messages/` + Supabase client.

---

### Slice 3 — Staff message list / detail UI (no Realtime)

- **Goal:** Inbox list, thread detail, compose, send, basic filters; polling/refetch.
- **Allowed scope:** `src/lib/messages/**`, `src/pages/messages/**`, `src/components/messages/**`.
- **Likely files:** New pages/components/lib; no `App.tsx` unless unavoidable.
- **Protected-path posture:** Standard.
- **Verification:** `lint`, `typecheck`, targeted vitest, `build`.
- **Stop conditions:** Requires Realtime or Netlify API to meet acceptance; PHI UI copy omitted.

---

### Slice 4 — Routes, nav, guard parity

- **Goal:** Production routes and sidebar; server/Cypress guard parity.
- **Allowed scope:** `src/App.tsx`, `src/components/Sidebar.tsx`, `src/server/routes/guards.ts`, `cypress/support/routeScenarios.ts`, `tests/edge/route-guards-parity.test.ts`, optional `src/lib/routeModulePrefetch.ts`.
- **Protected-path posture:** **Critical** (auth/routing).
- **Required agents/skills:** `auth-routing-guard`.
- **Verification:** Auth/routing matrix + `test:routes:tier0`; optional Playwright smoke.
- **Stop conditions:** Four-way sync incomplete; role matrix disagrees with product table in §6.

---

### Slice 5 — Unread / archive / mute polish

- **Goal:** Participant `last_read_at`, archived/muted filtering, unread badges.
- **Allowed scope:** `src/lib/messages/**`, `src/components/messages/**`, `src/pages/messages/**`, extend integration tests.
- **Protected-path posture:** Standard.
- **Verification:** Slice 3 commands + extended integration tests.
- **Stop conditions:** Org-wide archive; hard-delete migrations introduced.

---

### Later / deferred slices

| Slice | Goal | Notes |
|-------|------|--------|
| Realtime | `postgres_changes` or Realtime channel per thread | RLS-aligned channels; separate `critical` review |
| Notifications | In-app badge feed, email, push | PHI-safe payloads; policy revision required |
| Attachments | Storage + AV scan + size limits | Policy revision required |
| Audited admin / compliance review | Break-glass read | **No** default RLS widen; separate legal design |
| Formal retention | TTL job, export, legal hold | Replaces indefinite default |
| FTS / global search | Indexes + RPC | Admin read risk; participant-scoped search only |

---

## References

- `AGENTS.md` — roles, verification, high-risk paths
- `docs/ai/verification-matrix.md` — command matrix per change type
- `docs/ai/high-risk-paths.md` — critical lane paths
- `docs/security/tenant-isolation.md` — org boundaries (AI chat retention ≠ staff messaging)
- `docs/COMPLIANCE_READINESS.md` — compliance gap inventory
- Exploration handoff: prior ask-mode exploration on branch `Messaging` (2026-05-20)
