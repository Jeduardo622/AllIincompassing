# Session Data Collection 2.0 — Phase 0 Spec Lock (Blocking Addendum)

## Status

Blocked pending product/architecture clarification before any schema, RLS, or write-path implementation.

Date: 2026-04-09.

## Why this addendum exists

The implementation request references `docs/SESSION_DATA_COLLECTION_2.0_RESEARCH_ONE_PAGER.md` as the source-of-truth handoff, but that file is not present in the current repository checkout.

Until that handoff is available (or equivalent decisions are explicitly restated), implementation across `supabase/migrations/**`, `supabase/functions/**`, and app persistence paths cannot be completed safely without risking schema drift and completion-rule regressions.

## Route-task artifact for this slice

- classification: `blocked pending clarification`
- lane: `blocked`
- why: required handoff/spec input is missing for a high-risk tenant-sensitive feature.
- triggering paths:
  - missing required source document: `docs/SESSION_DATA_COLLECTION_2.0_RESEARCH_ONE_PAGER.md`
  - intended implementation paths (high risk): `supabase/migrations/**`, `supabase/functions/**`, session completion authority.
- required agents (once unblocked):
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- reviewer required: `not yet` (required once unblocked)
- verify-change required: `not yet` (required once unblocked)
- mandatory checks: `none until clarified`
- linear required (once unblocked to critical work): `yes`

## Allowed files for this blocked slice

Only docs needed to record block status and unblock criteria:

- `docs/SESSION_DATA_COLLECTION_2.0_PHASE_0_SPEC_LOCK.md` (this file)

## Decision lock needed to unblock

Provide explicit decisions for all items below (or restore the missing one-pager containing them):

1. **Data model option**
   - Choose Option A, B, or C.
   - Define canonical table(s), ownership, and versioning behavior.
2. **Completion readiness authority**
   - Confirm whether `checkInProgressSessionCloseReadiness` remains client-side advisory only.
   - Confirm authoritative enforcement path in `sessions-complete` (and whether new required fields/measures gate completion).
3. **Tenant boundary rules**
   - Exact org-scoping for read and write.
   - RLS policy expectations for therapist/client/admin roles.
4. **Server-side data exposure constraints**
   - Reconfirm that `ai_guidance_documents` / `white_bible_core` remain server-only and are never therapist-readable through new paths.
5. **Phase target**
   - Identify the exact next implementable phase and minimal acceptance criteria for this branch.

## Planned implementation once unblocked

1. Route-task rerun for the exact implementation slice (expected `critical`).
2. Supabase migration + RLS + generated DB types update.
3. App + server/edge persistence wiring using existing tenant-safe patterns.
4. Completion-readiness and `sessions-complete` alignment updates.
5. Tests (including tenant isolation checks).
6. Full `verify-change` + `pr-hygiene` artifacts.

## Residual risk while blocked

No runtime behavior changed in this commit. Risk is limited to delayed delivery until spec decisions are confirmed.
