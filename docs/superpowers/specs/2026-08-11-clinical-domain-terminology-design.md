# Clinical Domain Terminology Design

## Objective

Replace user-facing `Program` terminology with `Domain` wherever the application describes a clinical care plan used for goals, sessions, or session documentation.

## Scope

The terminology change covers:

- client-record navigation and live care-plan management
- assessment draft review and promotion into the live care plan
- schedule and session plan selection, validation, and status messages
- session-note guidance and BT ABA session-note summaries
- user-facing errors, empty states, confirmations, buttons, placeholders, accessibility labels, and success messages on those surfaces

The primary affected routes are:

- `/clients/:clientId?tab=programs-goals`
- `/clients/:clientId?tab=session-notes`
- `/clients/:clientId?tab=session-trends`
- `/schedule`

## Terminology Contract

Use these user-facing mappings, preserving capitalization and plurality:

| Existing | Replacement |
| --- | --- |
| Program | Domain |
| Programs | Domains |
| Program & Goals | Domain & Goals |
| Programs & Goals | Domains & Goals |
| Program Notes | Domain Notes |
| program note | domain note |
| draft program | draft domain |

The change is deliberately presentational. Internal contracts remain unchanged, including:

- `program`, `programs`, `program_id`, and related database/API/type identifiers
- route and tab IDs such as `programs-goals`
- capability names such as `manageProgramsGoals`
- query keys, analytics identifiers, test fixture IDs, and backend request/response fields
- uploaded or extracted source-document text that must preserve payer/source wording
- unrelated meanings such as insurance programs or software programs

Clinical names supplied by users are data and are not rewritten. For example, a domain currently named `Communication Program` keeps that stored name; only surrounding UI labels use `Domain`.

## Implementation

Update the existing components directly rather than introducing a terminology abstraction. This keeps the change reviewable and avoids coupling runtime copy to internal schema names.

Production copy changes are expected in:

- `src/pages/ClientDetails.tsx`
- `src/components/ClientDetails/ProgramsGoalsTab.tsx`
- `src/components/SessionModal.tsx`
- `src/components/AddSessionNoteModal.tsx`
- `src/components/session-notes/BtAbaSessionNoteForm.tsx`
- `src/components/AutoScheduleModal.tsx` when its errors are user-visible

Tests will assert the new labels and the absence of legacy clinical-care-plan labels. Existing behavioral logic and data flow must not change.

## Verification

Follow test-driven development:

1. Add or update focused assertions for `Domains & Goals`, domain-management copy, session domain selection, and session-note summaries.
2. Run the focused tests and confirm they fail because the old UI wording is still rendered.
3. Make the minimum production copy changes.
4. Re-run the focused tests to green.

Required completion checks:

- `npm run lint`
- `npm run typecheck`
- focused Vitest suites for affected components and pages
- `npm run test:ci`
- `npm run build`
- responsive observer for `/clients/:clientId?tab=programs-goals` and `/schedule` at `1440x900` and `390x844`
- final repository search confirming no legacy `Program` care-plan copy remains in user-facing component/page strings, excluding documented internal and source-text cases

## Boundaries And Stop Conditions

- Do not modify schemas, migrations, APIs, server handlers, authorization, routing, or tenant behavior.
- Do not rename files, exported types, internal variables, or persisted fields solely for terminology consistency.
- Stop and re-route if completing the UI terminology requires a protected-path change.
- Preserve unrelated changes in the original checkout; all implementation occurs in the isolated worktree.
