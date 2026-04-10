# Session Data Collection 2.0 — Phase 0 Spec Lock Status

## Status

Phase 0 is no longer blocked by a missing handoff document.

- Research handoff now exists in `docs/SESSION_DATA_COLLECTION_2.0_RESEARCH_ONE_PAGER.md`.
- Phase 1 backend groundwork shipped with `client_session_notes.goal_measurements`.
- Current implementation focus is Track 1: therapist-facing measurement UI plus Session Notes read-path visibility.

Date: 2026-04-09.

## Locked Decisions In Effect

1. Data model
   - Current implementation is following Option A/C-style phased delivery from the one-pager.
   - Canonical storage for Track 1 is `client_session_notes.goal_measurements` keyed by `goal_id`.
   - Each stored measurement entry uses a versioned envelope: `{ version: 1, data: { ... } }`.
2. Completion readiness
   - Completion rules are unchanged for this track.
   - `checkInProgressSessionCloseReadiness` and `sessions-complete` still require non-empty `goal_notes` text per worked goal.
   - Structured measurements supplement note content; they do not replace goal-note requirements.
3. Tenant boundary
   - No new tables, RLS policies, grants, or RPC surfaces are introduced in Track 1.
   - Reads and writes continue through the existing org-scoped `client_session_notes` path.
4. Guidance exposure
   - `ai_guidance_documents` / `white_bible_core` remain server-side only and are not exposed in therapist UI.

## What Phase 0 Still Covers

Phase 0 remains the place to record future scope decisions that would widen behavior beyond Track 1, especially:

- changing completion authority to accept structured measurements without goal-note text
- moving from `client_session_notes.goal_measurements` to a normalized measurement table
- adding analytics, reporting, or computed mastery behavior from session-level measurement data

## Current Execution Note

Agents should treat the missing-one-pager block as resolved. Re-run `route-task` for the exact slice being implemented and route by the highest-risk touched path.
