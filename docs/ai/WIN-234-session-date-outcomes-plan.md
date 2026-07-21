# WIN-234 Session-Date Prompt Outcome Selection

## Routing

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Linear: [WIN-234](https://linear.app/winningedgeai/issue/WIN-234/align-prompt-outcome-analytics-to-clinical-session-dates)
- Triggering path: `src/server/api/trial-events.ts`
- Human approval, `verify-change`, and `pr-hygiene` are mandatory before merge.

## Scope

- Preserve `trial_events.event_timestamp` as capture and audit time.
- Select `view=prompt_outcomes` rows by authorized `client_session_notes.session_date` membership.
- Keep the final event read user-token/RLS backed and return the existing minimal DTO.
- Add focused regressions for late-entered and UTC-boundary sessions.

## Tenant boundary

- The active organization, requested client, and requested goal must remain validated before the analytics read.
- The final query must constrain both trial events and joined session notes to the same organization and client.
- Nested session/note relationship data is filter-only and must not be returned.

## Non-goals and stop conditions

- No timestamp rewrite, backfill, capture change, schema, migration, RPC, RLS, grant, role, or index change.
- No change to existing non-prompt trial-event GET modes, trend bucketing, or graph UI.
- Stop if session-date selection cannot remain user-token/RLS backed or requires a database change.

## Verification contract

- Focused API and trend tests.
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run test:routes:tier0`
- `npm run build`
- `npm run ci:playwright` when hosted credentials are available; otherwise require PR CI.
- Read-only hosted Supabase relationship, index, and query-plan verification.
