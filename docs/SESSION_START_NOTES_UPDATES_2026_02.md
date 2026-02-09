## Sessions Start + Notes Updates (2026-02)

### Scope
- Session start requirements (program + goal enforcement)
- Session notes logging with goal IDs
- Session-to-note linkage
- Audit visibility for goals and IDs
- Test coverage updates for the above

### Product Changes
- Manual session notes now require selecting a program and one or more goals from the goals bank.
- Session notes store `goal_ids` alongside `goals_addressed` titles for audit clarity.
- Session notes can be linked to a scheduled session via `session_id` (auto-selected when possible).
- Session start rejects re-starting a session that already has `started_at`.
- Session start modal warns when no active programs/goals exist for the client.

### UI Updates
- `SessionModal` shows a warning banner if there are no active programs or goals.
- `AddSessionNoteModal` includes:
  - Program selector (active program default)
  - Goals multi-select (non-archived)
  - Session selector (auto-picked by date/time/therapist; required if sessions exist)
- `SessionNotesTab` displays:
  - Goal titles (existing behavior)
  - Goal IDs (new audit badges)

### API / Data Layer
- `sessionsStartHandler` now returns 409 when `started_at` is already set.
- `createClientSessionNote` accepts and writes `goal_ids` and optional `session_id`.
- `SessionNote` type and mapping include `goal_ids` and `session_id`.

### Database / Supabase
- No new migrations required; existing schema already includes:
  - `sessions.program_id`, `sessions.goal_id`, `sessions.started_at`
  - `client_session_notes.goal_ids`
  - `client_session_notes.session_id`
- Updated edge function config to enforce JWT on `admin-create-user`.

### Acceptance Criteria Added
- Manual notes require at least one goals bank entry and persist `goal_ids`.
- UI blocks saving notes when no active program/goals exist.

### Tests Added/Updated
- `createClientSessionNote` test asserts `goal_ids` persistence.
- `sessionsStartHandler` returns 409 when session already started.
- Scheduling tests updated to include program/goal data for the new selectors.

### Files Changed
- UI:
  - `src/components/SessionModal.tsx`
  - `src/components/AddSessionNoteModal.tsx`
  - `src/components/ClientDetails/SessionNotesTab.tsx`
- API / Data:
  - `src/server/api/sessions-start.ts`
  - `src/lib/session-notes.ts`
  - `src/types/index.ts`
- Tests:
  - `src/lib/__tests__/session-notes.test.ts`
  - `src/server/__tests__/sessionsStartHandler.test.ts`
  - `src/components/__tests__/SchedulingIntegration.test.tsx`
  - `src/components/__tests__/SchedulingFlow.test.tsx`
  - `src/server/routes/__tests__/guards.test.ts`
- Supabase:
  - `supabase/functions/admin-create-user/function.toml`
- Docs:
  - `docs/GOALS_BANK_PROGRAM_NOTES_DRAFT.md`
  - `docs/SESSION_START_NOTES_UPDATES_2026_02.md`

### Validation
- `npm test`
