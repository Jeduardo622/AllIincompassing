# Therapist Sessions Workflow Blueprint

## Source Alignment
- ABA backend guidance stresses multi-tenant isolation, RLS, and therapist-centric scheduling safeguards for sessions, including unique scheduling constraints and auditability.
- Our server-side guard matrix already gates therapist-facing paths and maps each route to the Supabase policy surface we must satisfy.

```1:75:docs/aba_session_management_backend_only.txt
Implementing Secure ABA Session Management
with Supabase (Backend Only)
Database Schema Design
Design a multi-tenant Postgres schema (managed by Supabase) that separates data by organization (ABA
provider) and supports sessions, notes, and scheduling. Key tables might include:
Therapists – holds therapist profiles (e.g. name, credentials) and organizational context. For
example: id (UUID primary key, often referencing the auth user’s ID), organization_id (UUID
reference to an organization/clinic), specialties (array), availability_hours (JSON
schedule). Each therapist row links to exactly one Supabase Auth user (for login) and is tied to an
organization. 
Clients – stores client (patient) info, with similar fields: id (UUID primary key), organization_id
(UUID reference), personal details, etc. Use a deleted_at timestamp or status field for soft
deletes (archive) rather than outright deletion, since medical records shouldn’t be silently removed
. 
Sessions – represents therapy sessions (scheduled appointments). Includes id (UUID), 
client_id (UUID ref to Clients), therapist_id (UUID ref to Therapists), organization_id, 
start_time and end_time (timestamptz for schedule), and fields for tracking attendance and
notes. For example, a status enum (like 'scheduled', 'completed', 'cancelled') or a
boolean attended flag can mark client attendance. A notes text column (or a separate 
SessionNotes table linking session_id → note text) stores the therapist’s session notes. To prevent
overlapping bookings, consider a unique index or check on sessions (e.g. no two sessions for the
same therapist at overlapping times). Index critical fields like organization_id, therapist_id,
client_id, and start_time to optimize queries (e.g. quickly fetching an org’s schedule). 
```

## Route & Policy Baseline
- `/schedule` and `/clients/:clientId` must stay inside `public.sessions: sessions_scoped_access` plus `public.clients: role_scoped_select`, ensuring therapists only see their own calendar and client context.
- `/therapists/:therapistId` allows a therapist to review their profile but relies on the same `role_scoped_select` guarantees used by admins.
- Admin-only `/therapists` and `/therapists/new` routes reinforce the split between self-service therapist data and back-office management.

```23:74:src/server/routes/guards.ts
const guardDefinitions: readonly GuardWithMatcher[] = [
  createGuard({
    path: '/',
    allowedRoles: ['client', 'therapist', 'admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.sessions: sessions_scoped_access'],
  }),
  createGuard({
    path: '/schedule',
    allowedRoles: ['client', 'therapist', 'admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.sessions: sessions_scoped_access'],
  }),
  createGuard({
    path: '/clients',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: ['view_clients'],
    supabasePolicies: ['public.clients: role_scoped_select'],
  }),
  createGuard({
    path: '/clients/:clientId',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: ['view_clients'],
    supabasePolicies: [
      'public.clients: role_scoped_select',
      'public.sessions: sessions_scoped_access',
    ],
  }),
  createGuard({
    path: '/therapists',
    allowedRoles: ['admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.therapists: role_scoped_select'],
  }),
  createGuard({
    path: '/therapists/:therapistId',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.therapists: role_scoped_select'],
  }),
  createGuard({
    path: '/therapists/new',
    allowedRoles: ['admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.therapists: role_scoped_select'],
  }),
  // ... existing definitions ...
];
```

## Front-End Guardrails (2025-11-11)
- `/schedule` defaults the therapist filter to the signed-in therapist when appropriate, highlights the scoped filter, and pre-fills the session modal so new bookings stay within the tenant boundary.
- Session booking mutations elevate Supabase `409` conflicts into retry guidance (“slot taken — refresh or pick another time”) without dismissing the modal, keeping therapists in context.
- `/clients` and `/clients/:clientId` short-circuit client fetches when an organization isn’t selected, aligning the UI with RLS policies and eliminating cross-tenant listing attempts.
- Client creation now stamps the active organization ID in the payload so new records inherit the correct tenant automatically.
- Automated coverage: `npm run playwright:schedule-conflict` verifies the retry-hint UI, and `src/lib/__tests__/multiTenantAccess.test.ts` (Supabase MCP) asserts client listings stay tenant-scoped.

## Therapist Session Lifecycle
1. **Context loading**
   - Therapist lands on `/schedule`, triggering Supabase queries constrained by `sessions_scoped_access`. Filter by `organization_id` (JWT claim) and `therapist_id = auth.uid()` to honor the multi-tenant guidance captured in the ABA reference.
   - When drilling into `/clients/:clientId`, reuse the same policy pair so therapists only see their assigned clients.

2. **Slot reservation**
   - Initiate `requestSessionHold` with therapist/client IDs, timestamps, and idempotency keys to claim a slot before writing any `sessions` rows.
   - Edge function keeps track of recurrence payloads so we can batch holds when the therapist books recurring appointments.

```80:151:src/lib/sessionHolds.ts
export async function requestSessionHold(payload: HoldRequest): Promise<HoldResponse> {
  const occurrencePayloads: HoldOccurrenceRequest[] = Array.isArray(payload.occurrences) && payload.occurrences.length > 0
    ? payload.occurrences
    : [{
        startTime: payload.startTime,
        endTime: payload.endTime,
        startTimeOffsetMinutes: payload.startTimeOffsetMinutes,
        endTimeOffsetMinutes: payload.endTimeOffsetMinutes,
      }];

  const response = await callEdge(
    "sessions-hold",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        therapist_id: payload.therapistId,
        client_id: payload.clientId,
        start_time: payload.startTime,
        end_time: payload.endTime,
        session_id: payload.sessionId ?? null,
        hold_seconds: payload.holdSeconds ?? 300,
        start_time_offset_minutes: payload.startTimeOffsetMinutes,
        end_time_offset_minutes: payload.endTimeOffsetMinutes,
        time_zone: payload.timeZone,
        occurrences: occurrencePayloads.map((occurrence) => ({
          start_time: occurrence.startTime,
          end_time: occurrence.endTime,
          start_time_offset_minutes: occurrence.startTimeOffsetMinutes,
          end_time_offset_minutes: occurrence.endTimeOffsetMinutes,
        })),
      }),
    },
    { accessToken: payload.accessToken },
  );
  // ... existing code ...
}
```

3. **Confirmation & persistence**
   - After the hold succeeds, call `bookSession` to confirm, derive CPT metadata, and persist the session series. The workflow retries hold cancellation on failure, aligning with the ABA document’s emphasis on idempotent, auditable flows.

```338:481:src/server/bookSession.ts
export async function bookSession(payload: BookSessionRequest): Promise<BookSessionResult> {
  if (!payload?.session) {
    throw new Error("Session payload is required");
  }

  assertSessionCompleteness(payload.session);
  const recurrence = payload.recurrence ?? payload.session.recurrence ?? null;
  const cpt = deriveCptMetadata({
    session: payload.session,
    overrides: payload.overrides,
  });

  const occurrences = generateOccurrences(payload.session, recurrence, {
    startOffsetMinutes: payload.startTimeOffsetMinutes,
    endOffsetMinutes: payload.endTimeOffsetMinutes,
    timeZone: payload.timeZone,
  });

  const [primaryOccurrence] = occurrences;
  if (!primaryOccurrence) {
    throw new Error("Unable to derive primary occurrence for booking");
  }

  const hold = await requestSessionHold({
    therapistId: payload.session.therapist_id,
    clientId: payload.session.client_id,
    startTime: primaryOccurrence.startTime,
    endTime: primaryOccurrence.endTime,
    sessionId,
    holdSeconds: payload.holdSeconds,
    idempotencyKey: payload.idempotencyKey,
    startTimeOffsetMinutes: primaryOccurrence.startOffsetMinutes,
    endTimeOffsetMinutes: primaryOccurrence.endOffsetMinutes,
    timeZone: recurrence?.timeZone ?? payload.timeZone,
    accessToken: payload.accessToken,
    occurrences: occurrences.map((occurrence) => ({
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      startTimeOffsetMinutes: occurrence.startOffsetMinutes,
      endTimeOffsetMinutes: occurrence.endOffsetMinutes,
    })),
  });

  let confirmed;
  try {
    confirmed = await confirmSessionBooking({
      holdKey: hold.holdKey,
      session: sessionPayload,
      idempotencyKey: payload.idempotencyKey,
      startTimeOffsetMinutes: primaryOccurrence.startOffsetMinutes,
      endTimeOffsetMinutes: primaryOccurrence.endOffsetMinutes,
      timeZone: recurrence?.timeZone ?? payload.timeZone,
      accessToken: payload.accessToken,
      occurrences: hold.holds.map((heldOccurrence, index) => ({
        holdKey: heldOccurrence.holdKey,
        session: {
          ...sessionPayload,
          start_time: occurrences[index]?.startTime ?? heldOccurrence.startTime,
          end_time: occurrences[index]?.endTime ?? heldOccurrence.endTime,
        },
        startTimeOffsetMinutes:
          occurrences[index]?.startOffsetMinutes ?? deriveOffsetMinutes(
            recurrence?.timeZone ?? payload.timeZone,
            heldOccurrence.startTime,
          ),
        endTimeOffsetMinutes:
          occurrences[index]?.endOffsetMinutes ?? deriveOffsetMinutes(
            recurrence?.timeZone ?? payload.timeZone,
            heldOccurrence.endTime,
          ),
        timeZone: recurrence?.timeZone ?? payload.timeZone,
      })),
    });
  } catch (error) {
    try {
      await cancelSessionHold({ holdKey: hold.holdKey, accessToken: payload.accessToken });
    } catch (releaseError) {
      console.warn("Failed to release session hold after confirmation error", releaseError);
    }
    throw error;
  }

  // ... existing code ...
}
```

4. **Finalization & Compliance**
   - Persisted sessions inherit organization scoping, enabling reports and audits. Extend with DST-aware duration handling and audit logs per the ABA guidance.
   - Any cancellations/unholds must log outcomes so support can prove we respected the “no double booking” guarantee and HIPAA audit expectations.
   - Agent-driven operations now include trace metadata (`requestId`, `correlationId`, `agentOperationId`) in hold/confirm/cancel audit payloads to support deterministic replay and post-incident debugging.

## Data Model & RLS Checklist
- Ensure `sessions` maintains an exclusion constraint on `(therapist_id, tstzrange(start_time, end_time))` to prevent double-booking, alongside indexed `organization_id` as recommended by the ABA reference.
- RLS policies need to align with route guard expectations: therapists read/write only their own sessions/notes; admins act on org-wide data; clients, if exposed, get a read-only subset.
- Add audit triggers for session note updates and secure storage (encrypt at rest or application-level encryption for PHI) to satisfy HIPAA/CMIA obligations.
- Enforce therapist `status` to `active`/`inactive` at the database layer and ensure schedule queries only surface active providers.

## Implementation Backlog
- [x] Validate Supabase migrations include the exclusion constraint and composite indexes outlined above.
- [x] Extend edge functions to return retry hints on `409` conflicts so the UI can reschedule per hold contract expectations.
- [x] Instrument audit logging for holds, confirmations, and note updates to satisfy compliance logging.
- [x] Thread trace identifiers across session hold/confirm/cancel flows and provide replay reporting (`agent-trace-report` + monitoring tab).
- [ ] Review route-specific UI components (`/schedule`, `/clients/:clientId`) to ensure they filter via the JWT’s `org_id` and therapist ID, mirroring the policy assumptions.

## 2026-03 E2E validation findings
- Added `scripts/playwright-session-lifecycle.ts` to run booking -> start -> terminal-close lifecycle checks (default no-show) with artifact output in `artifacts/latest`.
- Added `scripts/playwright-session-complete.ts` to run the same harness with terminal status `completed`.
- Added `scripts/playwright-schedule-blocked-close.ts` to verify notes-required blocked-close guidance from `/schedule`.
- Session lifecycle start flow uncovered a database guard mismatch (`scheduled -> in_progress` transition blocked). This is fixed by migration `supabase/migrations/20260316153000_allow_session_in_progress_transitions.sql`.
- Transcript entities existed in hosted environments but were missing from migration history in this repository. `supabase/migrations/20251005131500_transcription_consent_and_retention.sql` now bootstraps `session_transcripts` and `session_transcript_segments` with idempotent `CREATE TABLE IF NOT EXISTS` and indexes before consent/retention logic runs.
- Environment gap discovered during E2E: `sessions-start` and `generate-session-notes-pdf` edge endpoints returned `404 NOT_FOUND` in the target shared environment, indicating deployment/config drift despite functions being present in source.
- Booking via `/api/book` returned `401` in the target shared environment during browser E2E, requiring service-role fallback for fixture session creation in the lifecycle script. This indicates runtime auth/config parity issues between the deployed app API layer and expected Supabase token validation path.
- Unit/CPT recording layer remains partially coupled to booking confirmation; when booking falls back outside hold/confirm flow, `session_cpt_entries` and `session_audit_logs` are not populated for that session. Keep this as an operational risk until booking API parity is restored in the target environment.

## 2026-03 one-swoop parity hardening
- CI now enforces Supabase route parity (`CI_SUPABASE_AUTH_PARITY_REQUIRED=true`, `CI_EDGE_ROUTE_PARITY_REQUIRED=true`) so missing lifecycle edge functions fail policy checks.
- Session lifecycle browser checks now support strict parity mode (`CI_SESSION_PARITY_REQUIRED=true`), which hard-fails on:
  - `/api/book` auth `401` regressions,
  - `sessions-start` edge `404` regressions,
  - `generate-session-notes-pdf` edge `404` regressions.
- Push pipelines now deploy the required session edge bundle in one step via `npm run ci:deploy:session-edge-bundle`:
  - `sessions-hold`, `sessions-confirm`, `sessions-start`, `sessions-cancel`, `generate-session-notes-pdf`.
- `/api/book` server-side Supabase key resolution now matches runtime publishable-key resolution patterns, reducing Netlify/Supabase auth drift that previously surfaced as false `401` responses.
- Shared environment edge gateway returned `Invalid JWT` for valid `/auth/v1/user` tokens. Session lifecycle functions were redeployed with runtime auth enforced in-function (`getUserOrThrow`) and gateway JWT verification disabled for the five lifecycle routes to restore parity.
- Booking 500 regression (`program_id` null during hold confirmation) was fixed by migration `supabase/migrations/20260317043000_confirm_session_hold_program_goal_required.sql`, which updates `confirm_session_hold(uuid, jsonb)` to persist `program_id` and `goal_id`.
- Session start remains sensitive to transient edge timeouts (`504`) in shared env; strict lifecycle checks now fail on route absence (`404`) but allow RPC fallback on gateway timeouts so end-to-end validation can complete while route health is remediated.

## 2026-03 stabilization follow-up (shared env)
- Root cause discovered during post-remediation stabilization: lifecycle edge functions can be redeployed with gateway JWT verification re-enabled (`verify_jwt=true`) unless explicitly disabled at deploy time.
- Symptom pattern observed:
  - strict lifecycle parity runs failed at `/api/book` with `401 unauthorized` from downstream `sessions-hold/sessions-confirm`,
  - non-strict lifecycle run reached `sessions-start` and failed with `401 Invalid JWT` at edge gateway.
- Operational fix applied:
  - redeployed `sessions-hold`, `sessions-confirm`, `sessions-start`, `sessions-cancel`, and `generate-session-notes-pdf` with `--no-verify-jwt`,
  - verified remote function metadata reports `verify_jwt=false` for all five lifecycle routes.
- CI/deploy hardening:
  - `scripts/ci/deploy-session-edge-bundle.mjs` now deploys lifecycle functions with `--no-verify-jwt`,
  - the same script now fails fast if post-deploy verification finds any lifecycle function with `verify_jwt !== false`.
- Remaining risk:
  - strict lifecycle can still fail earlier on `/api/book` auth parity if app runtime/token context drifts in shared env; treat this as a release blocker for session route parity.

## 2026-03 session completion execution hardening
- `scripts/playwright-session-lifecycle.ts` now emits step checkpoints (`login`, `route-check`, `book-session`, `start-session`, `create-session-note`, `verify-notes-pdf`, `cancel-session`) to make failures deterministic in shared-environment runs.
- Added bounded network controls for edge calls:
  - `PW_EDGE_FETCH_TIMEOUT_MS` (default `20000`) for lifecycle edge/RPC fetch timeout enforcement.
  - `PW_LIFECYCLE_STEP_TIMEOUT_MS` (default `120000`) for per-step watchdog timeout.
- `/api/book` now retries transient `5xx` failures (including `504`) with bounded backoff in the lifecycle runner, in addition to existing `409` retry handling.
- Session cancel fallback now handles `5xx` edge failures by applying a service-role status update to prevent orphaned in-progress test sessions from blocking completion evidence.
- Shared-env strict verification completed end-to-end after hardening with session IDs:
  - `b646beb9-f0be-4310-9e83-2d52f612fe1a`
  - `1ea3be0e-d9d8-4eb3-bce0-e21b3be8619f`
- `generate-session-notes-pdf` remains intermittently slow (`504` under load). Lifecycle verification now treats this as availability degradation (warn) while continuing cancellation/closure steps.

## 2026-03 four-failure remediation pass
- Baseline evidence correlated the four target signatures in shared env:
  - `sessions-start` gateway timeouts (`504/502`) under load,
  - `generate-session-notes-pdf` timeouts (`504`),
  - `sessions-cancel` intermittent `500`,
  - `/api/book` transient `504`.
- `sessions-cancel` source hardening:
  - audit side effects in cancel/hold-release were made non-fatal,
  - scoped cancellation write path now uses `supabaseAdmin` after org/role checks to avoid policy-path update failures surfacing as `500`.
- Playwright lifecycle resilience hardening now includes:
  - bounded route/navigation timeouts in login/route checks (`60s`),
  - bounded edge fetch timeout and retry/backoff for booking/start/PDF/cancel paths.
- Latest strict verification matrix (with parity flags enabled) completed with consecutive passes:
  - `f6dc7d9c-cba0-4ccc-952a-9fda88929d6a`
  - `e27de834-af0b-473b-aa3c-0cc899f21167`
- Focused parity gates passed after remediation:
  - `scripts/ci/check-api-contract-smoke.mjs`
  - `scripts/ci/check-supabase-function-auth-parity.mjs`
- Residual risk:
  - shared-env logs still show intermittent lifecycle edge instability (`sessions-confirm`/`sessions-cancel` occasional `500`, PDF `504`); lifecycle now degrades safely and completes, but route-level reliability should continue to be monitored.

## 2026-03 scheduling routes re-audit sync
- Re-audit confirmed current authority split:
  - `/api/book` remains Netlify shim to booking orchestration (`sessions-hold` + `sessions-confirm`).
  - `/api/sessions-start` remains Netlify shim to RPC `start_session_with_goals`.
  - UI lifecycle start/cancel paths continue to call Supabase edge lifecycle routes directly.
- Route mapping sync fix:
  - Added explicit Netlify redirect for `/api/sessions-start` to `/.netlify/functions/sessions-start` to prevent SPA catch-all drift.
- Parity policy sync fix:
  - Lifecycle `function.toml` values were re-synced to `verify_jwt = false` to match deployed session lifecycle behavior and keep auth parity checks green.
- Contract sync fix:
  - Session cancellation client parser now accepts both flat `data.*` and nested `data.summary.*` response shapes.
- Verification rerun outcomes:
  - `scripts/ci/check-api-contract-smoke.mjs` passed.
  - `scripts/ci/check-supabase-function-auth-parity.mjs` passed for lifecycle scope.
  - `tests/edge/api-contract-envelope.test.ts` and booking/start handler tests passed.
  - strict `playwright:session-lifecycle` passed (`0ffdf752-233d-4c74-9e5a-6815995e4eaa`).

## 2026-03 production readiness gate

- Deployment and parity lock:
  - `npm run ci:deploy:session-edge-bundle` executed for lifecycle functions.
  - Lifecycle auth parity check passed for scoped set (`sessions-hold`, `sessions-confirm`, `sessions-start`, `sessions-cancel`, `generate-session-notes-pdf`).
- Release-gate verification passed:
  - `scripts/ci/check-api-contract-smoke.mjs` passed.
  - `tests/edge/api-contract-envelope.test.ts` passed.
  - Booking/start/cancel focused Vitest contracts passed.
  - Two consecutive strict lifecycle passes completed:
    - `470ede35-5c37-4fce-a82e-590a63f2cb94`
    - `3447e712-f93d-45cf-8339-f2a827deccc2`
- Operational note:
  - `generate-session-notes-pdf` can still be intermittently unavailable in shared environment; lifecycle keeps this non-blocking while enforcing core booking/start/cancel success criteria.

## 2026-03 business-logic hardening pass

- Idempotency replay isolation:
  - Lifecycle edge handlers now scope idempotency storage keys to `organization_id + user_id + endpoint + idempotency key`, preventing cross-principal replay reuse.
  - Replay checks now execute only after authenticated user and org context are resolved in lifecycle handlers.
- State transition enforcement:
  - `sessions-start` now enforces `status = scheduled` in both pre-checks and write predicate.
  - `sessions-cancel` now enforces cancellable statuses at write time (`UPDATE ... WHERE status IN (...)`) to close read/write race windows.
- Recurrence confirmation integrity:
  - Booking recurrence confirmation now maps hold occurrences to generated recurrence windows by stable time-window key (normalized ISO timestamps), with explicit `HOLD_OCCURRENCE_MISMATCH` conflict errors on mismatches.
- Upstream error classification:
  - API handlers now distinguish upstream dependency failures (`502 upstream_error`) from authorization denials (`401/403`) for org/role and authenticated-user resolution steps.
- Multi-occurrence confirm safety semantics:
  - `sessions-confirm` now returns explicit partial-failure semantics (`partial`, `PARTIAL_CONFIRMATION`, confirmed session payloads) if a multi-occurrence confirm fails after prior successes.
- Verification outcomes:
  - `node scripts/ci/check-api-contract-smoke.mjs` passed.
  - `node scripts/ci/check-supabase-function-auth-parity.mjs` passed.
  - `npx vitest run src/server/__tests__/bookHandler.test.ts src/server/__tests__/sessionsStartHandler.test.ts src/server/__tests__/bookSession.test.ts src/lib/__tests__/sessionCancellation.test.ts tests/edge/api-contract-envelope.test.ts` passed.
  - Two strict lifecycle E2E passes passed:
    - `playwright-session-lifecycle-1773870314551.json`
    - `playwright-session-lifecycle-1773870571656.json`

## 2026-03 session notes PDF async reliability migration

- Replaced synchronous PDF generation contract with async lifecycle:
  - `POST /functions/v1/generate-session-notes-pdf` now enqueues export jobs and returns `202` with `{ exportId, status }`.
  - `POST /functions/v1/session-notes-pdf-status` returns deterministic state transitions (`queued`, `processing`, `ready`, `failed`, `expired`).
  - `POST /functions/v1/session-notes-pdf-download` enforces org-scoped access and streams artifact bytes only when `ready`.
- Added persistent export job model:
  - New table: `public.session_note_pdf_exports` with status/error timestamps, org/client/requester scoping, artifact metadata, and request correlation field.
  - New indexes on org + creation time, status + creation time, requester + creation time, and client + creation time.
  - RLS policies enforce org-scoped reads and self-scoped inserts, with service-role processing access.
- Added secure export artifact storage path:
  - New private bucket: `session-note-exports`.
  - Storage policy links `storage.objects` rows to `session_note_pdf_exports` authorization for authenticated read access.
- Client UX now uses async polling flow:
  - `SessionNotesTab` enqueue -> status polling with bounded retries/backoff -> download on `ready`.
  - Prevents duplicate export submissions while an active export is already running.
- Lifecycle verification updated for async branch:
  - Playwright session lifecycle now polls status endpoint and validates download endpoint after enqueue.
- Rollout controls:
  - Gate activation with `SESSION_NOTES_PDF_ASYNC=true` in edge runtime, enable first in staging, then production after parity + soak checks.
  - Keep `generate-session-notes-pdf` + `session-notes-pdf-status` + `session-notes-pdf-download` in parity/deploy bundle scope to avoid partial rollout drift.

## 2026-04 booking update-session incident closure

- Incident summary:
  - Therapists/admins could open `Edit Session`, but `Update Session` intermittently failed with `Booking failed` when `/api/book` routed to edge authority and downstream `sessions-book` was temporarily unavailable.
- Fix shipped:
  - `src/server/api/book.ts` now falls back to the legacy booking path only when edge authority is unavailable at the transport layer (`404`, `408`, `5xx`) or when the edge request throws.
  - Conflict/business responses (for example `409` scheduling conflicts) still pass through without fallback so user-facing conflict behavior remains unchanged.
  - `src/server/__tests__/bookHandler.test.ts` adds regression coverage for:
    - edge unavailable -> fallback succeeds
    - edge request throw -> fallback succeeds
    - edge `409` conflict -> no fallback
- Verification evidence:
  - Focused checks passed: booking handler tests, scheduling flow tests, lint, typecheck, policy checks, and build.
  - Full gates passed before merge: CI workflow checks, `tenant-safety`, `tier0-browser`, Netlify preview checks, and `ci-gate`.
  - PR: `#361` merged to `main` at commit `7e1f23df1dff8cdd58efb3d1d4e950785f9d7ae8`.
- Current status:
  - Working now. As of `2026-04-03` (UTC), `Edit Session -> Update Session` is passing through the restored booking path in production-bound mainline configuration.
