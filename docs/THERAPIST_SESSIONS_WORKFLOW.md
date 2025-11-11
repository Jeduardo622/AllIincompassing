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

## Data Model & RLS Checklist
- Ensure `sessions` maintains an exclusion constraint on `(therapist_id, tstzrange(start_time, end_time))` to prevent double-booking, alongside indexed `organization_id` as recommended by the ABA reference.
- RLS policies need to align with route guard expectations: therapists read/write only their own sessions/notes; admins act on org-wide data; clients, if exposed, get a read-only subset.
- Add audit triggers for session note updates and secure storage (encrypt at rest or application-level encryption for PHI) to satisfy HIPAA/CMIA obligations.

## Implementation Backlog
- [x] Validate Supabase migrations include the exclusion constraint and composite indexes outlined above.
- [x] Extend edge functions to return retry hints on `409` conflicts so the UI can reschedule per hold contract expectations.
- [x] Instrument audit logging for holds, confirmations, and note updates to satisfy compliance logging.
- [ ] Review route-specific UI components (`/schedule`, `/clients/:clientId`) to ensure they filter via the JWT’s `org_id` and therapist ID, mirroring the policy assumptions.
