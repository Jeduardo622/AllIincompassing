# Session Data Collection 2.0 — Research Handoff (One-Pager)

**Status:** Research complete — ready for specification and phased implementation  
**Audience:** Implementing agents, tech lead, clinical/product reviewer  
**Last updated:** 2026-04-09  
**Related:** `AGENTS.md`, `docs/ai/high-risk-paths.md`, `docs/ai/verification-matrix.md`, `docs/THERAPIST_SESSIONS_WORKFLOW.md`, `docs/SESSION_START_NOTES_UPDATES_2026_02.md`

---

## 1. Purpose

Deliver a **stronger session data collection** experience than narrative-only notes: closer to industry **run-sheet** patterns (program → targets → quick measures → notes) while **preserving** org isolation, session lifecycle authority, and billing/session-note rules.

**Non-negotiable from product:** Implementation must be **end-to-end**: **Supabase-compatible data model + RLS + API/edge behavior**, not UI-only mock data. Frontend-only prototypes are **out of scope** for “done” unless explicitly labeled spike and thrown away.

---

## 2. Current State (As-Built)

### 2.1 Therapist journey (schedule → complete)

1. **Schedule** (`src/pages/Schedule.tsx`) — Create/edit session; program + primary goal + supplemental goals; booking/update mutations.
2. **Start** — `startSessionFromModal` → `/api/sessions-start` → RPC `start_session_with_goals`; populates **`session_goals`** (junction: `session_id`, `goal_id`, `program_id`, `client_id`, `organization_id`).
3. **Documentation** — **`client_session_notes`** row linked by `session_id`; `goal_notes` is a **per-goal map** (goal id → string); narrative + authorization + `service_code`. Persisted via `upsertClientSessionNoteForSession` on modal save when clinical draft exists (`src/lib/session-notes.ts`, `Schedule.tsx` `buildClinicalNoteDraft`).
4. **Close readiness** — For in-progress → completed, `checkInProgressSessionCloseReadiness` (`src/features/scheduling/domain/sessionComplete.ts`) requires **non-empty text in `goal_notes` for every `goal_id` in `session_goals`** for that session. Narrative-only does not satisfy.
5. **Programs/goals (plan)** — Rich fields on **`goals`**: `measurement_type`, `objective_data_points` (JSON), `baseline_data`, `target_criteria`, `mastery_criteria`, `maintenance_criteria`, etc. (`ProgramsGoalsTab.tsx`, generated types). **SessionModal** shows baseline/target/mastery as **read-only summary**, not structured capture.

### 2.2 Schema facts (generated / migrations)

| Table | Role today | Gap vs “Rethink-style” run sheet |
|--------|------------|-----------------------------------|
| **`session_goals`** | Junction only; no phase, trials, or measures | Cannot store per-session counters, phase, or probe state without **schema extension**. |
| **`client_session_notes`** | Billing + clinical note; `goal_notes` JSON map | Suitable to **extend** with structured values **per goal** (see §5) or stay string-only. |
| **`goals`** | Plan definitions | Source of truth for **what** to measure; not **session outcomes** beyond text notes. |
| **`sessions`** | Schedule + status + `started_at` | Lifecycle; completion via **`sessions-complete`** path. |

**Dead code note:** `persistSessionGoals` in `src/server/sessionGoalsPersistence.ts` is **not referenced** elsewhere; live flow uses booking/start RPCs. Do not assume this path without re-validation.

---

## 3. Reference Context (Not Requirements to Clone)

### 3.1 “White Bible” (`ai_guidance_documents.white_bible_core`)

- **Content:** Short curated ABA **principles** (operational definitions, measurement types, mastery criteria, baseline honesty, FBA linkage)—seeded in migration `20260225021000_create_ai_guidance_documents.sql`.
- **Use in app:** Server fetches `guidance_text` for **AI program/goal generation** (`assessment-documents.ts`, `assessment-drafts.ts` → `organization_guidance` in generation payload). **Not** a therapist-facing session reference UI.
- **RLS:** `ai_guidance_documents_read` allows **admin / super_admin / monitoring** only (`20260310162000_harden_ai_guidance_documents_rls.sql`). Therapists do **not** read this table from the client for session work.
- **Product implication:** Session 2.0 UX should use **clear, operational language** informed by these principles; **do not** ship raw `guidance_text` as in-app “clinical bible” for therapists.

### 3.2 Industry “run sheet” (e.g. Rethink-style screenshot)

- **Pattern:** Program list → main workspace with **collection type**, **baseline/mastery/maintenance** copy, **phase** (intervention/probe/etc.), **per-target** cards with **counters / %** and **Add note / Save**.
- **Adapt, don’t clone:** Our billing, authorization, org RLS, and **`session_goals` + `client_session_notes`** completion rules are **first-class**; parity is **workflow capability**, not pixel layout.

---

## 4. Problem Statement

**Today:** Session evidence is primarily **per-goal text** (and billing) with **plan-level** measurement definitions unused at session grain.

**Target:** **Session Data Collection 2.0** = a **run-sheet** experience backed by **persisted, queryable session-level measures** (minimum viable JSON or normalized rows) that align with **`goals.measurement_type`** / criteria, **without** weakening tenant isolation or completion semantics unless **explicitly** changed by spec + migration + review.

---

## 5. Backend / Supabase — Required Direction

Any “real” 2.0 delivery **must** include explicit **data ownership** and **compatibility** with:

1. **RLS** — `client_session_notes`, `session_goals`, `sessions` policies remain org-scoped; new tables need **`organization_id`** + policies consistent with existing patterns (`docs/security/tenant-isolation.md`).
2. **Completion pipeline** — `sessions-complete` (edge) + `checkInProgressSessionCloseReadiness` (client) today key off **`goal_notes` strings**. If structured data becomes the **source of truth**, **spec must define**: (a) whether **text** remains mandatory for compliance, (b) whether **structured saves** auto-fill or **replace** `goal_notes`, (c) whether server-side **re-check** must mirror client logic.
3. **RPCs / edge** — `start_session_with_goals` and completion paths are **high-risk**; changes to **when** a session can complete require **edge + tests + `validate:tenant`** as applicable.

### 5.1 Data model options (implementing team must pick one path)

| Option | Description | Pros | Cons / risk |
|--------|-------------|------|-------------|
| **A — JSON payload on existing notes** | Versioned structure inside `client_session_notes.goal_notes` values (e.g. `{ text, measures }` per goal) or parallel JSON column | Fewer tables; faster MVP | Migration + backfill + app parsing; JSON typing in TS |
| **B — Normalized `session_goal_measurements`** | Rows: `session_id`, `goal_id`, `organization_id`, measure fields, `phase`, optional trial aggregates | Query/report friendly; clearer RLS | New migration, indexes, policies, more joins |
| **C — Hybrid** | Small aggregates in JSON + **optional** detail table later | Phased | Two sources of truth unless disciplined |

**Recommendation for research handoff:** Option **B** or **C** if reporting/supervision matters; Option **A** only with **strict schema versioning** in `goal_notes` and a migration that **allows** structured shape without breaking string-only rows.

---

## 6. API & Application Surfaces (E2E Touchpoints)

| Layer | Files / areas | Notes |
|--------|----------------|-------|
| **Client** | `SessionModal.tsx`, `Schedule.tsx`, `sessionComplete.ts`, `sessionStart.ts`, `session-notes.ts` | Run Sheet UI can live here or new route; must persist **through** existing Supabase client with org context. |
| **Server** | `src/server/api/sessions-start.ts`, `sessions-complete.ts` | Rate limits, RPC, REST fallbacks. |
| **Edge** | `supabase/functions/sessions-complete/`, `sessions-start/` | Completion rules, JWT; **critical** path. |
| **Types** | `src/lib/generated/database.types.ts` | Regenerate after migrations. |

---

## 7. Compliance & Clinical Guardrails

- **PHI / audit:** Session notes and measures are clinical artifacts; avoid logging raw content; follow existing note locking (`is_locked`) behavior.
- **Completion messaging:** Current copy distinguishes **linked note `goal_notes`** from modal-only narrative (`IN_PROGRESS_CLOSE_NOT_READY_MESSAGE`); any change needs **UX + legal/clinical** review.
- **Internal ABA guide:** Stays **admin/agent**; therapist copy is **product-authored**, not raw DB dump.

---

## 8. Phased Implementation (E2E — Frontend + Backend Together)

| Phase | Scope | Supabase / backend | Lane (`route-task`) |
|-------|--------|---------------------|----------------------|
| **0 — Spec lock** | Choose Option A/B/C; completion rules; phase semantics; mobile/desktop IA | Migration sketch + RLS checklist | `blocked` until decisions recorded |
| **1 — Schema + RLS + types** | Tables/columns/policies; regenerate types; seed-safe rollout | **`supabase/migrations/**`** | **`critical`** |
| **2 — Write path** | Persist measures from Run Sheet; keep `goal_notes` sync rules; optional server validation | Edge/RPC only if rules move server-side | **`critical`** if edge/functions change |
| **3 — Read path + UI** | Run Sheet UI, completeness meter, schedule integration | Read-only queries; no policy bypass | **`standard`** if UI-only |
| **4 — Verification** | `validate:tenant`, policy checks, session lifecycle tests, Playwright for flows | CI | per `verification-matrix` |

**Minimum for “not frontend-only”:** Phases **1–2** must land with **Phase 3** in the same release train or feature flag, so production never stores **orphan UI state** not reflected in Supabase.

---

## 9. Verification (Mandatory)

- `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`
- **`npm run validate:tenant`** for any migration/RLS change
- **`npm run test:routes:tier0`** and **`npm run ci:playwright`** when schedule/session flows change materially
- Use **`verify-change`** skill + **`pr-hygiene`** before merge per `AGENTS.md`

---

## 10. Open Decisions (Implementing Agent Must Resolve)

1. **Phase model:** Per program, per goal, or per session? (Drives columns and UI.)
2. **Completion gate:** Structured data only vs text + structure vs text remains mandatory for audit.
3. **Mastery automation:** Display-only vs computed from stored session aggregates (requires analytics rules).
4. **Backfill:** How to treat existing `goal_notes` string-only rows when new shape ships.

---

## 11. Non-Goals (This Research)

- Cloning a third-party product UI verbatim.
- Exposing `white_bible_core` text to therapists as the “clinical standard.”
- Implementation in this document — **spec + tickets + migrations** follow separately.

---

## 12. Single-Line Summary for Routing

**Session Data Collection 2.0** = **Run-sheet UX + Supabase-backed session-level measures** with **org-safe RLS and explicit completion semantics**; **critical** lane for migrations/edge; **standard** for pure UI once read/write contract is stable.

---

## Document history

| Date | Change |
|------|--------|
| 2026-04-09 | Initial research one-pager for agent handoff |
