# Session Data Collection 2.0 — Phase 1 (goal_measurements) Handoff

## Route-task
- classification: high-risk human-reviewed
- lane: critical
- why: scope touches `supabase/migrations/**` and tenant-scoped clinical note persistence (`client_session_notes`).
- triggering paths:
  - `supabase/migrations/20260409103000_session_data_collection_2_goal_measurements.sql`
  - `src/lib/session-notes.ts`
  - `src/components/SessionModal.tsx`
  - `src/pages/Schedule.tsx`
- required agents: specification-engineer → software-architect → implementation-engineer → code-review-engineer → test-engineer → security-engineer
- reviewer required: yes
- verify-change required: yes
- linear required: yes (not linked in this local environment)

## Scope lock
### Allowed files
- `supabase/migrations/20260409103000_session_data_collection_2_goal_measurements.sql`
- `src/lib/generated/database.types.ts`
- `src/lib/session-notes.ts`
- `src/components/SessionModal.tsx`
- `src/pages/Schedule.tsx`
- `src/types/index.ts`
- `src/lib/__tests__/session-notes.test.ts`

### Non-goals
- No completion-readiness rule changes (`checkInProgressSessionCloseReadiness` / `sessions-complete`).
- No therapist-facing UI redesign for entering measurement values.
- No changes to access for `ai_guidance_documents` / `white_bible_core`.

### Stop conditions
- If completion authority semantics must change, stop for explicit product/security sign-off.
- If schema decision must switch from per-goal JSON to separate relational table, stop and produce spec-lock addendum first.

## Implementation summary
- Added nullable `goal_measurements jsonb` to `client_session_notes` with object-type check constraint.
- Extended app read/write paths to round-trip `session_note_goal_measurements` through Schedule → SessionModal → `upsertClientSessionNoteForSession`.
- Updated generated DB types + app session note types.
- Added/updated unit coverage for `goal_measurements` persistence.

## Tenant boundary and safety statement
- Read/write boundary remains organization-scoped through existing `client_session_notes` RLS and explicit `.eq('organization_id', activeOrganizationId)` filters.
- No grants/RLS policy broadening introduced; migration only adds column + check constraint.
- Cross-tenant access remains impossible under existing org-scoped policies.

## Verification card (verify-change)
- classification: high-risk human-reviewed
- lane: critical
- change type:
  - database/RLS/migrations/tenant isolation
  - server/API-adjacent app write path (Schedule session note persistence)
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - pass: `npm run ci:check-focused`
  - pass: `npm run lint`
  - pass: `npm run typecheck`
  - pass: `npm run test:ci`
  - pass: `npm run validate:tenant`
  - pass: `npm run build`
  - fail: `npm run verify:local` (fails at `npm run test:routes:tier0` in this container)
- blocked checks:
  - `npm run test:routes:tier0` blocked due missing OS dependency `Xvfb` (Cypress cannot launch browser in this environment).
- result: pass-with-blocked-checks
- residual risk:
  - Browser route/auth regression suite is unverified locally due missing `Xvfb`; rely on CI/browser-enabled environment for this gate.

## Reviewer placeholder
- reviewer status: pending human review (required by critical lane)
- requested review focus:
  - tenant isolation and org-scoped note persistence
  - migration safety/idempotency
  - compatibility with session-close authority semantics

## PR hygiene snapshot
- branch-ready: yes (`codex/session-data-collection-2.0-phase1-schema-persistence`)
- single-purpose diff: yes
- protected-path drift: expected (`supabase/migrations/**`), lane remains `critical`
- verification summary: present
- linear-ready: no (external linkage needed before merge)
- pr-ready: no (blocked on Linear linkage + human reviewer sign-off)
