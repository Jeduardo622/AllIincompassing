# Goals Bank + Program Notes Draft

## Product Goal
Enable therapists to select and track structured goals and program notes across sessions, with AI-generated plans/session notes referencing a reusable goals bank (not service codes), while preserving multi-tenant safety and auditability.

## Scope Summary
- **Goals Bank**: Central, structured goal catalog scoped to organization and client.
- **Programs**: Treatment programs that group goals and sessions; can hold program-level notes.
- **AI Documentation**: AI-generated session notes and program notes reference goal IDs from the bank and optionally suggest new goals.

## Current State (Baseline)
- **Manual session notes**: `client_session_notes.goals_addressed` is a free-text array (no goal IDs).
- **AI session notes**: `ai_session_notes` stores structured `targeted_goals` inside note payload, not a reusable goals bank.
- **Programs**: No program entity or program notes exist today.

## Implementation Status (2026-02)
- **Schema**: `programs`, `goals`, `goal_versions`, `program_notes`, `session_goals` tables added.
- **Sessions**: `sessions.program_id`, `sessions.goal_id`, and `sessions.started_at` are required fields.
- **Notes**: `client_session_notes.goal_ids` and `ai_session_notes.goal_ids` added (uuid[]).
- **RLS**: Therapist/admin/super_admin share the same org-scoped policies for new tables.
- **APIs**: `/api/programs`, `/api/goals`, `/api/program-notes`, `/api/sessions-start` handlers added.
- **UI**: Client profile now includes a Programs & Goals tab; session modal supports program/goal selection and a Start Session action.
- **Goal versioning**: Trigger-backed `goal_versions` logging for clinical field updates.

## Implementation Update (2026-02-11)
- **Assessment-driven drafting**: Programs & Goals tab now supports an AI-assisted "Generate from Assessment" flow.
- **Therapist workflow**:
  - Therapist pastes assessment summary text (manual input).
  - System generates a draft program + measurable goals.
  - Therapist can review/edit and then create records through existing `/api/programs` and `/api/goals`.
- **Edge integration**:
  - New Supabase Edge Function: `generate-program-goals`.
  - Frontend helper: `generateProgramGoalDraft()` in `src/lib/ai.ts`.
  - Function enforces authenticated access and org context before generation.
- **Safety model**:
  - Drafts are suggestions only; therapist is the final approver.
  - Program/goal persistence still runs through existing scoped API handlers.
- **Testing coverage added**:
  - `src/components/__tests__/ProgramsGoalsTab.test.tsx`
  - `src/lib/__tests__/ai-auth-fetch.test.ts` (new generator auth/header tests)
  - Existing server handler suites for programs/goals/program notes validated.

## Proposed Data Model (Draft)
> Updated to match the implemented schema.

### Core Tables
- `goals`
  - `id` (uuid)
  - `organization_id` (uuid, required)
  - `client_id` (uuid, required)
  - `program_id` (uuid, required)
  - `title` (text)
  - `description` (text)
  - `target_behavior` (text)
  - `measurement_type` (text)
  - `original_text` (text, required)
  - `clinical_context` (text, nullable)
  - `baseline_data` (text, nullable)
  - `target_criteria` (text, nullable)
  - `status` (enum: active, paused, mastered, archived)
  - `created_by`, `updated_by`, `created_at`, `updated_at`

- `programs`
  - `id` (uuid)
  - `organization_id` (uuid)
  - `client_id` (uuid)
  - `name` (text)
  - `description` (text, nullable)
  - `status` (enum: active, inactive, archived)
  - `start_date`, `end_date` (date, nullable)
  - `created_by`, `updated_by`, `created_at`, `updated_at`

- `program_notes`
  - `id` (uuid)
  - `organization_id` (uuid)
  - `program_id` (uuid)
  - `author_id` (uuid)
  - `note_type` (enum: plan_update, progress_summary, other)
  - `content` (jsonb or text)
  - `created_at`, `updated_at`

- `goal_versions`
  - `id` (uuid)
  - `goal_id` (uuid)
  - `organization_id` (uuid)
  - `client_id` (uuid)
  - `program_id` (uuid)
  - `original_text`, `title`, `description`
  - `clinical_context`, `target_behavior`, `measurement_type`
  - `baseline_data`, `target_criteria`
  - `status` (text)
  - `changed_by`, `changed_at`, `change_reason`

- `session_goals`
  - `id` (uuid)
  - `organization_id` (uuid)
  - `session_id` (uuid)
  - `goal_id` (uuid)
  - `created_by`, `created_at`, `updated_at`

### Linkage to Sessions / Notes
- `sessions.program_id` (uuid, required)
- `sessions.goal_id` (uuid, required, primary goal)
- `sessions.started_at` (timestamptz, required)
- `session_goals` (join table for additional goals)
- `client_session_notes.goal_ids` (uuid[], nullable)
- `ai_session_notes.goal_ids` (uuid[], nullable)

## Goal Sources and Lifecycle
1. **Therapist selects from Goals Bank** when starting a session or writing notes.
2. **AI notes** map detected goals to existing goals bank entries where possible.
3. **AI can propose new goals**; therapist accepts to persist into `goals`.
4. Goals track progress through `program_notes` or per-session `progress_toward_goals` entries.

## Workflow Drafts

### 1) Create or Maintain Goals Bank
- Therapist or admin creates goals in the client’s goals bank.
- Goals are attached to a single program (required).
- Goals have status lifecycle (active → paused/mastered/archived).

### 2) Start Session → Select Program + Goals
- Therapist clicks “Start Session” from schedule.
- Required: select program, primary goal, and optionally additional goals.
- Persist `program_id` + `goal_id` on session; additional goals stored in `session_goals`.
- Start time tracked for compliance and audit.

### 3) AI-Generated Session Notes
- AI pipeline ingests transcript and context.
- AI retrieves active goals for client/program.
- AI outputs:
  - `goal_ids` (existing)
  - `progress_toward_goals` (structured)
  - `suggested_goals` (new candidates)
- Therapist confirms or edits before final save.

### 4) Program Notes (AI-Assisted)
- Periodic summaries (weekly/monthly).
- Pulls session notes + goal progress for program.
- Saves to `program_notes` with references to goals/program.

## AI Integration Requirements
- **Context retrieval**: Provide AI with active goals for the client/program (IDs + descriptions).
- **Goal matching**: AI maps transcript evidence to goal IDs; no free-text only.
- **Suggestion flow**: AI can emit new goal candidates → therapist approval required.
- **Compliance**: Ensure logs do not expose PHI beyond allowed policies.

## API / Edge Function Drafts
- `GET /api/programs?client_id=...`
- `POST /api/programs` (create)
- `PATCH /api/programs` (update)
- `GET /api/goals?program_id=...`
- `POST /api/goals` (create)
- `PATCH /api/goals` (update)
- `GET /api/program-notes?program_id=...`
- `POST /api/program-notes` (create)
- `POST /api/sessions-start` (assign program + goals; mark started)
- `POST /edge/ai-session-note-generator` (existing) should accept `goal_context`.
- `POST /edge/generate-program-goals` (implemented as Supabase function `generate-program-goals`) for assessment-based draft generation.
- `POST /edge/ai-program-note-generator` (new) to synthesize program notes.

## RLS + Security Considerations
- All `goals`, `programs`, and `program_notes` must be org-scoped.
- Therapist access limited to assigned clients/programs.
- Admins can manage org-wide goals/programs.
- `goal_ids` should be validated server-side to prevent cross-tenant leakage.

## UI / UX Draft
- **Goals Bank UI** (client details):
  - List goals, status, filters (active/mastered/archived).
  - Quick add/edit.
- **Program Panel** (client details or schedule):
  - Active program selector.
  - Program notes timeline.
- **Start Session Modal**:
  - Program dropdown (required).
  - Goals multi-select.
  - AI-assisted suggestions (optional).

## Migration Strategy (High-Level)
1. Add tables: `programs`, `goals`, `goal_versions`, `program_notes`, `session_goals`.
2. Add `sessions.program_id`, `sessions.goal_id`, `sessions.started_at`.
3. Add `goal_ids` columns to `client_session_notes` and `ai_session_notes`.
4. Backfill existing sessions with a legacy program/goal per client.
5. Update schedule RPCs and edge functions to include program/goal fields.
6. Update AI pipeline to read/write goal IDs (pending).

## Acceptance Criteria (Draft)
- Given a therapist is in a client’s schedule, when they start a session, then they must select a program and a primary goal from the goals bank.
- Given a therapist starts a session, then the program selection is required and persisted with the session.
- Given a goals bank entry is archived, when generating notes, then the AI must not assign the archived goal unless therapist explicitly selects it.
- Given a session note is AI-generated, then it must reference `goal_ids` and include measurable progress notes.
- Given a program summary is generated, then it must aggregate progress across the program’s sessions.
- Given a therapist logs a manual session note, when they save, then at least one goal from the goals bank is required and stored in `client_session_notes.goal_ids`.
- Given a client has no active programs or goals, when a therapist tries to log a session note, then the UI must block saving and explain the missing program/goals requirement.

## Open Questions
- How do we map existing free-text goals into structured goals without losing clinical intent?

## Structured Goals Without Losing Clinical Intent (Draft Guidance)
- Preserve original free-text goal text alongside structured fields (store as `original_text` or in metadata).
- Allow clinician-authored narrative fields (`description`, `target_behavior`, `baseline_data`) to remain editable after auto-structuring.
- Support goal versioning (e.g., revisions recorded with timestamps and author) to preserve clinical evolution.
- Use a “goal template” plus free-text overrides rather than forcing rigid categorical values.
- Maintain clinician-facing labels as primary display text; structured fields power analytics and AI mapping.

## Structured Goals Without Losing Clinical Intent (Included Approach)
### Field Strategy
- **`original_text`**: required, clinician-authored source text (never overwritten).
- **`title`**: short display label derived from original text but editable.
- **`description`**: clinician-facing narrative for context and nuances.
- **`clinical_context`**: optional rationale or constraints (e.g., setting, antecedents).
- **`target_behavior`** + **`measurement_type`**: structured analytics fields (AI-assisted, clinician-editable).
- **`baseline_data`** + **`target_criteria`**: keep as free-text to preserve clinical nuance.

### Versioning
- Maintain a `goal_versions` log (append-only) capturing:
  - `goal_id`, `changed_by`, `changed_at`
  - `original_text`, `description`, `target_behavior`, `measurement_type`, `baseline_data`, `target_criteria`
- Display latest version by default; allow diff review for compliance.

### AI Guardrails
- AI may propose structured fields but **must not edit `original_text`**.
- AI suggests mappings to existing goals with confidence scoring and a rationale.
- Therapists explicitly confirm AI-proposed goal creation or edits.

### Backfill Guidance (Existing Free-Text Goals)
- Import free-text into `original_text` and `description` verbatim.
- Leave structured fields empty until therapist reviews or AI suggests mappings.

## Sample Goal Record (JSON)
```json
{
  "id": "1a2b3c4d-5678-4901-9abc-def012345678",
  "organization_id": "0f1e2d3c-4b5a-6978-90ab-cdef12345678",
  "client_id": "b1c2d3e4-5678-49ab-8cde-f0123456789a",
  "program_id": "c2d3e4f5-6789-4abc-9def-0123456789ab",
  "title": "Mand for help during transitions",
  "description": "Client will request help using functional communication during transitions with minimal prompting.",
  "target_behavior": "Use a functional communication response (FCR) to request help within 10 seconds of transition cue.",
  "measurement_type": "frequency",
  "original_text": "By 12/31, when given a transition cue, client will request help using an FCR within 10 seconds in 4/5 opportunities across 3 consecutive sessions.",
  "clinical_context": "Applies to school and clinic settings; transition cue includes verbal prompt or visual schedule change.",
  "baseline_data": "Currently requests help in 1/5 opportunities with full physical prompting.",
  "target_criteria": "4/5 opportunities across 3 consecutive sessions with no more than a verbal prompt.",
  "status": "active",
  "created_by": "9e8d7c6b-5a4f-3210-9fed-cba987654321",
  "updated_by": "9e8d7c6b-5a4f-3210-9fed-cba987654321",
  "created_at": "2026-02-04T17:25:00.000Z",
  "updated_at": "2026-02-04T17:25:00.000Z"
}
```

## goal_versions Schema Sketch (SQL)
```sql
create table if not exists goal_versions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  organization_id uuid not null,
  client_id uuid not null,
  program_id uuid not null,
  original_text text not null,
  title text not null,
  description text not null,
  clinical_context text,
  target_behavior text,
  measurement_type text,
  baseline_data text,
  target_criteria text,
  status text not null,
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  change_reason text
);
```

