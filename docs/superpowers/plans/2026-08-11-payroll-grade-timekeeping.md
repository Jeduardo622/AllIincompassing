# Payroll-Grade Timekeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a default-disabled, California-first timekeeping system that records payroll shifts separately from insurance/audit session attendance, derives approved hours and gross earnings, and emits a provider-neutral CSV without PHI.

**Architecture:** Implement five dependent, independently reviewable critical-lane PRs: protected data foundation, employee/session capture, California derivation, approval/locking, and canonical export. Supabase RPCs and Edge Functions are authoritative; Netlify handlers proxy the browser API; React Query drives role-specific UI. Immutable events, versioned snapshots, snapshot-bound approvals, and immutable export runs prevent later edits from rewriting payroll history.

**Tech Stack:** React 18, TypeScript, Vite, TanStack Query, Zod, Vitest, Playwright, Supabase Postgres/RLS/RPC/Edge Functions, Netlify Functions, `date-fns`/`date-fns-tz`, native IndexedDB, SHA-256.

## Global Constraints

- Classification is `high-risk human-reviewed`; lane is `critical` for every implementation PR.
- Link a Linear issue before implementation begins. Reuse and update an existing relevant issue when workspace plan limits prevent issue creation; existing issue linkage plus status/comment updates satisfies the critical-lane tracking requirement.
- Create every migration with the exact `npm run migration:new -- payroll_timekeeping_foundation`, `payroll_timesheet_snapshots`, `payroll_approval_workflow`, or `payroll_export_ledger` command listed in its task so the repository generator supplies the UTC prefix and governance headers; never hand-invent a migration timestamp.
- Replace the generator's placeholder `@migration-dependencies: none` with the exact latest prerequisite migration before implementation; for PR 1 at this baseline that prerequisite is `20260810222545_bt_closeout_legacy_therapist_compat.sql`.
- Required specialist sequence per PR: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer` -> `supabase-reviewer`; add `devops-engineer` for Netlify/API routing and `performance-engineer` for calculation, period, and export query paths.
- Independent-human review is required before merge. Codex must not merge or dispatch through the solo-maintainer exception.
- Keep the feature flag `payroll_timekeeping_v1` default-disabled and deny all payroll mutation/export operations when it is disabled.
- California is the only active jurisdiction policy. Texas and Arizona remain inactive and fail closed.
- Keep payroll shift time, session attendance, and clinical session status as separate authority domains.
- Session start may prompt a self clock-in; it must never create payroll time silently. Session close must never end a payroll shift.
- Use server receipt time plus reported occurrence time. Preserve exact instants and never round.
- Use one effective-dated base hourly rate in v1. Preserve work categories without changing the rate.
- Never auto-deduct meals. Paid rest breaks remain inside a shift.
- Raw events, snapshots, approvals, export runs, and export rows are append-only through application roles.
- Every mutation requires an idempotency key and commits its audit/result atomically.
- V1 supports one active payroll organization per authenticated user. Derive the actor organization from `app.resolve_user_organization_id(auth.uid())`, require it to match the payroll target, and independently require an active canonical `user_roles` membership; never authorize from `profiles.role`, auth metadata, UI visibility, a client-supplied organization ID, or the existing super-admin shortcut.
- Do not reuse scheduling tenant fallback or static `AppRole`/`RoleGuard` capabilities as payroll authority. Payroll route manifests and navigation are presentation hints only; protected bootstrap/API responses are authoritative.
- Never include session IDs, client IDs, names, diagnoses, goals, notes, authorization data, or other PHI in payroll CSV output or telemetry.
- Never log raw payroll rows, hourly rates, gross amounts, correction narratives, attendance/session references, or CSV bytes. Log only safe machine codes, record counts, opaque IDs, and checksums.
- Do not read `.env*`, use hosted customer data, apply hosted migrations, enable the feature, deploy, or merge without a separately authorized execution step.
- Stop and re-route if an implementation slice requires tax, deductions, filings, payments, unsupported California wage orders, alternative workweeks, collective bargaining rules, health-care 8/80, or active Texas/Arizona calculations.

---

## Delivery Map

| PR | Deliverable | User-visible state | Depends on |
|---|---|---|---|
| 1 | Employment, capability, policy, pay-period, immutable-event schema | No UI; flag remains disabled | Approved design |
| 2 | Shift/meal capture, offline outbox, corrections, and independent session attendance | Employee `/time` route available only to synthetic test orgs with flag enabled | PR 1 |
| 3 | California interval derivation, exceptions, snapshots, and earnings | Employee period review and estimated earnings | PR 2 + validated CA fixtures |
| 4 | Employee submit, assigned-manager review, payroll lock/reopen | `/time/review` and `/payroll` approval tabs | PR 3 |
| 5 | Provider-neutral canonical export, CSV, checksums, and adjustments | Locked-period CSV download and reconciliation | PR 4 |

Activation is a separate owner-controlled operation after all five PRs are merged, exact-head CI passes, legal/operations validates the supported California population, and synthetic local/preview evidence is recorded.

## Stable Cross-PR Interfaces

Define these names once in PR 1 and preserve them through PR 5:

```ts
export type PayrollCapability =
  | "time.clock_self"
  | "time.view_self"
  | "time.request_correction_self"
  | "time.review_assigned"
  | "time.approve_assigned"
  | "session_attendance.record_assigned"
  | "payroll.configure_employment"
  | "payroll.resolve_exceptions"
  | "payroll.lock_period"
  | "payroll.reopen_period"
  | "payroll.export_period"
  | "payroll.view_compensation";

export type TimeEventType =
  | "shift_started"
  | "shift_ended"
  | "meal_started"
  | "meal_ended"
  | "work_category_changed";

export type SessionAttendanceEventType = "session_started" | "session_ended";
export type WorkCategory = "direct_service" | "administration" | "travel" | "training";
export type WorkLocation = "client_site" | "office" | "home" | "community" | "other";

export type PayrollMutationEnvelope<T extends { idempotencyKey?: string }> = {
  data: T;
  occurredAt: string;
  timezone: string;
  workLocation: WorkLocation;
};
```

Subunit A clarification: the SQL RPC argument `idempotency_key` is authoritative. `PayrollMutationEnvelope.data.idempotencyKey` is optional; when present it must match the SQL argument exactly.

Authoritative mutation functions:

```sql
app.payroll_feature_enabled(target_organization_id uuid) returns boolean
app.payroll_actor_has_capability(target_organization_id uuid, required_capability text) returns boolean
public.record_employee_time_event(event_payload jsonb, idempotency_key text) returns jsonb
public.record_session_attendance_event(event_payload jsonb, idempotency_key text) returns jsonb
public.request_time_correction(correction_payload jsonb, idempotency_key text) returns jsonb
public.request_session_attendance_correction(correction_payload jsonb, idempotency_key text) returns jsonb
public.derive_timesheet_snapshot(target_employee_id uuid, target_pay_period_id uuid, idempotency_key text) returns jsonb
public.transition_timesheet_approval(transition_payload jsonb, idempotency_key text) returns jsonb
public.create_payroll_export(target_pay_period_id uuid, adapter_version text, idempotency_key text) returns jsonb
```

The public functions derive actor and organization from `auth.uid()` and canonical membership. They do not accept actor or organization IDs in request payloads.
`session_attendance.record_assigned` is the only delegated attendance-write capability in PR 1. It is scoped to active, nonexpired canonical `admin`, `super_admin`, and `admin_schedule` memberships, and it never grants payroll time mutation authority or payroll-admin compensation/lock/export authority.

### Task 1: Protected Payroll Foundation (PR 1)

**Files:**
- Create via `npm run migration:new -- payroll_timekeeping_foundation`: generator output matching `supabase/migrations/*_payroll_timekeeping_foundation.sql`
- Create: `tests/payroll-timekeeping-foundation-migration.test.ts`
- Create: `tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts`
- Create: `tests/sql/payroll_timekeeping_foundation_smoke.sql`
- Create: `scripts/payroll-timekeeping-security-contract.mjs`
- Create: `tests/payroll-typegen-command.test.ts`
- Create: `src/features/payroll/contracts.ts`
- Create: `src/features/payroll/access.ts`
- Create: `src/features/payroll/__tests__/contracts.test.ts`
- Create: `src/features/payroll/__tests__/access.test.ts`
- Modify: `package.json` add `typegen:local` for the canonical generated artifact without changing hosted `typegen`
- Regenerate: `src/lib/generated/database.types.ts`
- Update: `docs/superpowers/specs/2026-08-11-payroll-grade-timekeeping-design.md` tracking section with Linear keys and PR 1 evidence

**Interfaces:**
- Consumes: canonical `user_roles`, `roles`, `public.feature_flags`, `public.organization_feature_flags`, `auth.uid()`, organization and profile foreign keys.
- Produces: the stable types and SQL functions listed above; PR 1 implements feature/capability checks and all four event/correction mutation functions. Snapshot, approval, and export functions remain absent until their owning PRs.

- [ ] **Step 1: Create the Linear execution hierarchy and route the exact PR 1 slice**

Reuse `WIN-219` as the existing tracking parent and maintain status/comment updates because the workspace issue limit prevents a dedicated parent/child hierarchy. Record this route card in the issue comment and design tracking section:

```text
classification: high-risk human-reviewed
lane: critical
triggering paths: supabase/migrations/**, RLS, grants, RPC exposure, tenant isolation, compensation data
linear required: yes
human review required: yes
feature state: payroll_timekeeping_v1 default-disabled
```

- [ ] **Step 2: Write migration contract tests that fail before the migration exists**

Generate the migration shell first, then preserve the generated header in every edit:

```powershell
npm run migration:new -- payroll_timekeeping_foundation
$foundationMigration = (Get-ChildItem supabase/migrations/*_payroll_timekeeping_foundation.sql | Sort-Object Name -Descending | Select-Object -First 1).FullName
if (-not $foundationMigration) { throw "Foundation migration was not generated" }
```

In `tests/payroll-timekeeping-foundation-migration.test.ts`, assert the migration contains all required tables, RLS enablement, grants, append-only triggers, feature checks, and `search_path` hardening:

```ts
const requiredTables = [
  "employment_profiles",
  "payroll_organization_settings",
  "employee_rate_versions",
  "pay_groups",
  "pay_group_assignments",
  "pay_periods",
  "payroll_policy_versions",
  "payroll_capability_grants",
  "employee_manager_assignments",
  "payroll_mutation_receipts",
  "payroll_audit_events",
  "employee_time_events",
  "session_attendance_events",
  "time_correction_requests",
  "session_attendance_correction_requests",
  "timekeeping_exceptions",
  "payroll_retention_policies",
  "payroll_legal_holds",
];

for (const table of requiredTables) {
  expect(sql).toMatch(new RegExp(`create table(?: if not exists)? public\\.${table}`, "i"));
  expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  expect(sql).toMatch(new RegExp(`alter table public\\.${table} force row level security`, "i"));
}
expect(sql).toMatch(/revoke\s+insert\s*,\s*update\s*,\s*delete[\s\S]+employee_time_events[\s\S]+authenticated/i);
expect(sql).toMatch(/set search_path = ''/i);
```

- [ ] **Step 3: Run the focused contract tests and confirm red state**

Run: `npm test -- --run tests/payroll-timekeeping-foundation-migration.test.ts src/features/payroll/__tests__/contracts.test.ts src/features/payroll/__tests__/access.test.ts`

Expected: FAIL because the migration and payroll contracts do not exist.

- [ ] **Step 4: Implement the schema with explicit constraints and effective dates**

The migration must create enums/check constraints for California-only v1 and use integer minor units for money:

```sql
create table public.employment_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id),
  employee_number text not null,
  payroll_employee_id text not null,
  classification text not null check (classification in ('nonexempt')),
  home_jurisdiction text not null check (home_jurisdiction in ('CA', 'TX', 'AZ')),
  timezone text not null,
  active_from date not null,
  active_through date,
  therapist_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, employee_number),
  unique (organization_id, payroll_employee_id),
  unique (organization_id, user_id, active_from),
  unique (id, organization_id),
  foreign key (therapist_id, organization_id)
    references public.therapists(id, organization_id) on delete restrict,
  check (active_through is null or active_through >= active_from)
);

create table public.employee_rate_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employment_profile_id uuid not null,
  hourly_rate_cents integer not null check (hourly_rate_cents > 0),
  effective_from timestamptz not null,
  effective_through timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  check (effective_through is null or effective_through > effective_from)
);
```

`payroll_organization_settings` stores the opaque external organization payroll identifier and default workday/workweek configuration. Employment profiles store an opaque external employee payroll identifier. Use exclusion constraints to prevent overlapping active rate, manager, and pay-group assignment ranges. `pay_groups.cadence` permits `weekly`, `biweekly`, and `monthly`; an assignment trigger rejects monthly for active CA/TX/AZ nonexempt employees unless a future validated policy version explicitly supports it. Seed `payroll_timekeeping_v1` with `default_enabled=false` and a California ordinary-nonexempt policy version with `activation_status='inactive'`.

V1 permits an authenticated user to have only one active payroll organization at a time. Add a cross-organization exclusion constraint on `employment_profiles.user_id` using a half-open `daterange(active_from, active_through + 1, '[)')`; a future multi-organization model requires an organization-keyed actor-membership design and is out of scope.

Add a unique `(id, organization_id)` constraint to `public.therapists` before creating the optional composite therapist link; `therapists.organization_id` is already non-null and `id` is already primary, so this only supplies the composite reference target. Repeat `organization_id` on every tenant-bound child table, add unique `(id, organization_id)` keys, and use composite foreign keys with `ON DELETE RESTRICT` so a child cannot reference a parent from another organization.

Seed a minimum payroll retention of four years. `payroll_retention_policies` may extend but not shorten that period. `payroll_legal_holds` can suspend future disposal by organization, employee, pay period, or record category. V1 implements retention metadata and hold enforcement only; it does not implement destructive pruning.

- [ ] **Step 5: Implement capability derivation and least-privilege RLS**

`app.payroll_actor_has_capability` must require an active `profiles` row whose `organization_id` equals both `app.resolve_user_organization_id(auth.uid())` and `target_organization_id`, then directly verify an active, nonexpired canonical `user_roles` row; it must not call `app.user_has_role_for_org` or inherit its super-admin bypass. Self capabilities require an active matching `employment_profiles.user_id`. Manager capabilities require an effective `employee_manager_assignments` row. Compensation/configure/lock/export capabilities require an explicit effective `payroll_capability_grants` row and a canonical `admin` or `super_admin` membership. `admin_schedule`, `bcba`, `midtier`, therapist/BT, and client roles are ineligible for payroll-admin grants.

Policies must enforce:

```text
employee: select own events, corrections, exceptions, and non-peer compensation results
assigned manager: select assigned employee events/snapshots; no rate-table select
payroll admin with explicit grant: configuration, compensation, lock, reopen, export reads
authenticated: no direct insert/update/delete on source events, approvals, or export data
service_role: only the grants required by RPC/Edge execution
```

Create `app.reject_payroll_source_mutation()` triggers that reject `UPDATE` and `DELETE` on event and audit tables for every role, including service role. Corrections append records and replacement events; they never update originals. Sensitive tables use both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`; start ACLs with `REVOKE ALL` from `public`, `anon`, and `authenticated`, then restore only the exact read/RPC grants required.

- [ ] **Step 6: Implement idempotent event and correction RPCs**

Each RPC must use the payroll-specific `payroll_mutation_receipts` table keyed by organization, actor, operation, and idempotency key. It acquires a transaction advisory lock, stores the canonical payload hash, verifies the feature flag, derives actor/org, validates state, inserts the domain event plus `payroll_audit_events` row and replay result in one transaction, and returns the existing result for a same-payload replay. Return `IDEMPOTENCY_CONFLICT` if a reused key has a different hash. Do not use legacy `function_idempotency_keys`, whose endpoint/key scope and post-mutation persistence are insufficient for payroll atomicity.

State validation must reject duplicate starts, shift-end without shift-start, meal-start outside a shift, overlapping active meals, and replacement events in locked/exported periods. A correction request may still be appended against locked/exported history; applying it requires payroll-admin reopen and produces a new snapshot/approval/export chain. Session attendance accepts a nullable `employee_time_event_id` and required `session_id`, but payroll export views must not expose that session reference. Payroll corrections and session-attendance corrections use separate tables and RPCs; neither can silently rewrite the other authority domain.

- [ ] **Step 7: Add tenant and SQL smoke tests**

`tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts` must prove:

```ts
it("denies cross-organization event reads");
it("denies direct authenticated source-event inserts");
it("denies source-event update and delete through service role");
it("allows an employee to read only their own source events");
it("allows an assigned manager to read assigned time without rates");
it("requires explicit payroll grant for compensation and export access");
it("rejects metadata-only and profiles.role-only authority");
it("rejects overlapping active payroll employment across organizations");
it("prevents retention below four years and blocks disposal under legal hold");
```

`tests/sql/payroll_timekeeping_foundation_smoke.sql` and `scripts/payroll-timekeeping-security-contract.mjs` must exercise same-key replay, different-payload conflict, concurrent duplicate submission, cross-tenant denial, forced-RLS behavior, append-only enforcement, exact grants, and monthly-pay-group fail-closed behavior using synthetic UUIDs only.

- [ ] **Step 8: Correct and verify canonical type generation**

Add `"typegen:local": "supabase gen types typescript --local > src/lib/generated/database.types.ts"` without changing the existing hosted `typegen` command. `tests/payroll-typegen-command.test.ts` must assert the local script contains `--local`, writes the canonical path, and does not redirect to `src/lib/db.types.ts`. Keep `src/lib/db.types.ts` as a re-export only.

Run `npm run typegen:local` only against the local synthetic Supabase stack. Never point it at hosted production during this plan.

- [ ] **Step 9: Run PR 1 verification**

Run in order:

```powershell
npm test -- --run tests/payroll-timekeeping-foundation-migration.test.ts src/features/payroll/__tests__/contracts.test.ts src/features/payroll/__tests__/access.test.ts tests/payroll-typegen-command.test.ts
node scripts/payroll-timekeeping-security-contract.mjs
npm run ci:check-focused
npm run test:ci
npm run validate:tenant
npm run build
npm run verify:local
```

If local Supabase or `verify:local` prerequisites are unavailable, record the exact blocked command and require the equivalent exact-head CI result. Run `supabase-tenant-safety`, `verify-change`, and `pr-hygiene` before handoff.

- [ ] **Step 10: Commit PR 1**

```powershell
$foundationMigration = (Get-ChildItem supabase/migrations/*_payroll_timekeeping_foundation.sql | Sort-Object Name -Descending | Select-Object -First 1).FullName
git add -- $foundationMigration tests/payroll-timekeeping-foundation-migration.test.ts tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts tests/sql/payroll_timekeeping_foundation_smoke.sql scripts/payroll-timekeeping-security-contract.mjs tests/payroll-typegen-command.test.ts src/features/payroll/contracts.ts src/features/payroll/access.ts src/features/payroll/__tests__/contracts.test.ts src/features/payroll/__tests__/access.test.ts src/lib/generated/database.types.ts src/lib/db.types.ts package.json docs/superpowers/specs/2026-08-11-payroll-grade-timekeeping-design.md
git commit -m "feat(payroll): add protected timekeeping foundation"
```

### Task 2: Employee Capture and Session Attendance (PR 2)

Progress note 2026-08-12: Task 2E-B protected session-context transport is implemented in the existing `payroll-time-events` Edge, server, and client transports with focused green tests; repo-wide `test:ci` and `verify:local` remain blocked locally by aggregate coverage heap exhaustion outside the bounded slice.

**Files:**
- Create: one governed `supabase/migrations/*_payroll_timekeeping_capture_read_model.sql` migration on top of the PR 1 foundation
- Create: `tests/payroll-timekeeping-capture-migration.test.ts`
- Modify: `tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts`
- Modify: `scripts/payroll-timekeeping-security-contract.mjs`
- Create: `supabase/functions/payroll-time-events/index.ts`
- Create: `supabase/functions/payroll-time-events/index.test.ts`
- Create: `src/server/api/payroll-time-events.ts`
- Create: `src/server/__tests__/payrollTimeEventsHandler.test.ts`
- Create: `netlify/functions/payroll-time-events.ts`
- Modify: `netlify.toml` add `/api/payroll-time-events` before the SPA catch-all
- Create: `src/features/payroll/api.ts`
- Create: `src/features/payroll/outbox.ts`
- Create: `src/features/payroll/usePayrollTime.ts`
- Create: `src/features/payroll/__tests__/api.test.ts`
- Create: `src/features/payroll/__tests__/outbox.test.ts`
- Create: `src/pages/Time.tsx`
- Create: `src/pages/__tests__/Time.test.tsx`
- Create: `scripts/playwright-payroll-time-capture.ts`
- Create: `tests/scripts/playwright-payroll-time-capture.test.ts`
- Modify: `src/App.tsx` add lazy `/time` route behind the authenticated shell; the protected payroll bootstrap is authoritative
- Modify: `src/components/Sidebar.tsx` add capability-gated Time navigation
- Modify: `src/lib/routeModulePrefetch.ts` add `/time` lazy preload
- Modify: `src/lib/__tests__/routeModulePrefetch.test.ts`
- Modify: `src/server/routes/guards.ts` add `/time` guard evidence
- Modify: `src/server/routes/__tests__/guards.test.ts`
- Modify: `src/components/SessionModal.tsx` session-start prompt and session-end attendance orchestration
- Modify: `src/components/__tests__/SessionModal.test.tsx`
- Modify: `src/features/scheduling/domain/sessionStart.ts` pass stable attendance idempotency context
- Modify: `src/features/scheduling/domain/__tests__/sessionStart.test.ts`
- Modify: `src/features/scheduling/domain/sessionComplete.ts` end attendance before clinical completion without ending shift
- Modify: `src/features/scheduling/domain/__tests__/sessionComplete.test.ts`

**Interfaces:**
- Consumes: PR 1 event/correction RPCs and contracts.
- Produces: `fetchPayrollDay`, `recordTimeEvent`, `recordSessionAttendance`, `requestTimeCorrection`, `PayrollOutbox`, and the `/time` employee route. PR 3 consumes confirmed source events only.

- [ ] **Step 1: Route PR 2 and write failing API/outbox/UI tests**

Required behavior assertions:

```ts
it("sends Idempotency-Key and never sends organization_id or actor_id");
it("shows an offline event as pending rather than confirmed");
it("replays a queued event with its original key and occurredAt");
it("does not dequeue an event until the server confirms the same key");
it("prompts the assigned employee to clock in before starting a session");
it("allows continue-without-clock-in and surfaces session_outside_shift");
it("never clocks out when Close Session is clicked");
it("records session-ended before clinical close validation and reuses the key on retry");
```

Run: `npm test -- --run src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/outbox.test.ts src/pages/__tests__/Time.test.tsx src/components/__tests__/SessionModal.test.tsx`

Expected: FAIL because capture modules and UI do not exist.

- [ ] **Step 2: Implement the protected Edge and Netlify boundary**

`payroll-time-events` accepts only these actions:

```ts
const payrollActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_day"), localDate: z.string().date() }),
  z.object({ action: z.literal("record_time_event"), event: timeEventInputSchema }),
  z.object({ action: z.literal("record_session_attendance"), event: sessionAttendanceInputSchema }),
  z.object({ action: z.literal("request_correction"), correction: correctionInputSchema }),
  z.object({ action: z.literal("request_session_attendance_correction"), correction: attendanceCorrectionInputSchema }),
]);
```

Require bearer auth and `Idempotency-Key` for every mutation. Mutations invoke the protected event/correction RPCs; `get_day` invokes the Task 2 `public.get_payroll_day(local_date date)` read RPC. Mutation responses echo the effective key in both the `Idempotency-Key` header and JSON body. `src/server/api/payroll-time-events.ts` follows `sessions-start.ts`: CORS/rate-limit/auth checks, production proxy through `proxyToEdgeAuthority`, and no service-role fallback that broadens authority. The Netlify wrapper follows `netlify/functions/sessions-start.ts`, and `netlify.toml` must map `/api/payroll-time-events` before `/*`.

The Task 2 migration must remain additive on top of PR 1. It adds a `SECURITY DEFINER`, `search_path = ''` self-read RPC that derives actor, organization, and active employment and returns explicit `ok`, `feature_disabled`, `unsupported_jurisdiction`, or `no_employment_profile` states. It must not widen raw table RLS. Interpret `local_date` in `employment_profiles.timezone`, apply `payroll_organization_settings.workday_starts_at` in that timezone, and filter confirmed rows by `[day_start, next_day_start)`. Return the resolved timezone and workday start.

The same migration adds nullable same-organization `source_session_attendance_event_id` linkage to `timekeeping_exceptions`, a partial unique index limited to `exception_code = 'session_outside_shift'`, append-only enforcement, and a replacement attendance RPC that inserts the linked outside-shift exception atomically for `session_started` without an employee-time-event link.

- [ ] **Step 3: Implement the native IndexedDB outbox**

Use this interface so tests can inject an in-memory store without adding an IndexedDB package:

```ts
export interface PayrollOutboxStore {
  put(event: PendingPayrollEvent): Promise<void>;
  list(): Promise<PendingPayrollEvent[]>;
  remove(idempotencyKey: string): Promise<void>;
  markFailed(idempotencyKey: string, safeCode: string): Promise<void>;
}

export type PendingPayrollEvent = {
  idempotencyKey: string;
  action: "record_time_event" | "record_session_attendance";
  occurredAt: string;
  payload: Record<string, unknown>;
  state: "pending" | "replaying" | "needs_attention";
};
```

Queue only after validating the payload locally. Replay serially per employee, preserve original order, stop on a state conflict, and never relabel an event confirmed until the server returns the matching idempotency key. Lifecycle mutation keys must survive retryable clinical failures and client reload.

- [ ] **Step 4: Build the employee `/time` route**

The page must display active shift elapsed time, active meal, work category, work location, confirmed events, pending events, payroll correction history, separate session-attendance correction history, and current-period placeholder totals labelled `Calculation pending` until PR 3. Controls are shift start/end, meal start/end, work-category transition, work-location selection, payroll correction request, and session-attendance correction request.

Use `useMutation` and org/user-scoped query keys:

```ts
export const payrollTimeQueryKey = (organizationId: string, userId: string, localDate: string) =>
  ["payroll-time", organizationId, userId, localDate] as const;
```

Do not render rate or earnings fields in PR 2. Feature-disabled, unsupported-jurisdiction, no-employment-profile, and unresolved-offline states must be explicit fail-closed screens. `RoleGuard` and `src/server/routes/guards.ts` may permit the broad staff role set for routing, but only the protected payroll bootstrap can reveal capabilities or data.

- [ ] **Step 5: Integrate independent session attendance**

On `Start Session`, check whether the authenticated actor is the assigned employee and has an active shift. If yes, append `session_started` and then start the clinical session. If no active shift, show `Clock in and start` and `Continue session without clocking in`; the latter appends attendance and a `session_outside_shift` exception before clinical start. `Clock in and start` uses separate stable keys for `shift_started` and `session_started`, links attendance to the confirmed time event, then starts the clinical session. An admin/scheduler acting for someone else can append attendance for the assigned employee but cannot clock that employee in.

On `Close Session`, append `session_ended` from the click before clinical note finalization. If clinical completion later fails, attendance stays ended. Retrying close reuses the attendance idempotency key and replays attendance before clinical completion. Clear the retained key only after compatible clinical success. `ALREADY_TERMINAL` is success only after revalidation proves a compatible terminal session state. Never call `shift_ended` from either session action.

- [ ] **Step 6: Run focused and browser verification**

```powershell
deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts
npm test -- --run src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/outbox.test.ts src/pages/__tests__/Time.test.tsx src/components/__tests__/SessionModal.test.tsx src/features/scheduling/domain/__tests__/sessionStart.test.ts src/features/scheduling/domain/__tests__/sessionComplete.test.ts src/server/__tests__/payrollTimeEventsHandler.test.ts tests/scripts/playwright-payroll-time-capture.test.ts
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run test:routes:tier0
npm run ci:playwright
npm run build
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/time
npm run verify:local
```

Run `auth-routing-guard`, `responsive-ui-observer`, `supabase-tenant-safety`, `verify-change`, and `pr-hygiene`. The responsive evidence must include `1440x900` and `390x844`.

- [ ] **Step 7: Commit PR 2**

```powershell
git add -- supabase/functions/payroll-time-events src/server/api/payroll-time-events.ts src/server/__tests__/payrollTimeEventsHandler.test.ts netlify/functions/payroll-time-events.ts netlify.toml src/features/payroll src/pages/Time.tsx src/pages/__tests__/Time.test.tsx scripts/playwright-payroll-time-capture.ts tests/scripts/playwright-payroll-time-capture.test.ts src/App.tsx src/components/Sidebar.tsx src/lib/routeModulePrefetch.ts src/lib/__tests__/routeModulePrefetch.test.ts src/server/routes/guards.ts src/server/routes/__tests__/guards.test.ts src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx src/features/scheduling/domain/sessionStart.ts src/features/scheduling/domain/sessionComplete.ts src/features/scheduling/domain/__tests__/sessionStart.test.ts src/features/scheduling/domain/__tests__/sessionComplete.test.ts
git commit -m "feat(payroll): capture shifts and session attendance"
```

### Task 3: California Derivation and Earnings Snapshots (PR 3)

**Files:**
- Create via `npm run migration:new -- payroll_timesheet_snapshots`: generator output matching `supabase/migrations/*_payroll_timesheet_snapshots.sql`
- Create: `supabase/functions/_shared/payroll/types.ts`
- Create: `supabase/functions/_shared/payroll/timezone.ts`
- Create: `supabase/functions/_shared/payroll/pairEvents.ts`
- Create: `supabase/functions/_shared/payroll/california.ts`
- Create: `supabase/functions/_shared/payroll/hashSnapshot.ts`
- Create: `supabase/functions/payroll-timesheets/index.ts`
- Create: `supabase/functions/payroll-timesheets/index.test.ts`
- Create: `src/server/api/payroll-timesheets.ts`
- Create: `src/server/__tests__/payrollTimesheetsHandler.test.ts`
- Create: `netlify/functions/payroll-timesheets.ts`
- Modify: `netlify.toml` add `/api/payroll-timesheets` before the SPA catch-all
- Create: `tests/fixtures/payroll/california-ordinary-nonexempt.json`
- Create: `tests/payroll-california-calculation.test.ts`
- Create: `tests/payroll-timesheet-snapshot-migration.test.ts`
- Modify: `src/features/payroll/api.ts`
- Modify: `src/features/payroll/usePayrollTime.ts`
- Modify: `src/pages/Time.tsx`
- Modify: `src/pages/__tests__/Time.test.tsx`
- Regenerate: `src/lib/generated/database.types.ts`

**Interfaces:**
- Consumes: confirmed PR 2 source events, effective policy/rate/pay-group versions.
- Produces: immutable `timesheet_snapshots`, versioned `timekeeping_exceptions`, `deriveCaliforniaTimesheet(input)`, snapshot hashes, and employee period-review data used by PR 4.

- [ ] **Step 1: Obtain California fixture approval before implementation**

The child Linear issue must attach synthetic fixtures reviewed by payroll operations/legal for ordinary California nonexempt employees. The supported fixture catalog must include regular day, over-8 daily OT, over-12 double time, over-40 weekly OT without double counting, seventh consecutive day, cross-midnight, DST spring/fall, effective rate boundary, missing/late/short/interrupted meal, waiver, premium owed, session outside shift, correction invalidation, and open-punch failure.

- [ ] **Step 2: Write failing pure calculation and migration tests**

Run `npm run migration:new -- payroll_timesheet_snapshots` before writing the migration contract and preserve its generated governance header.

Use integer seconds and cents in expectations:

```ts
expect(result.totals).toEqual({
  regularSeconds: 8 * 3600,
  overtimeSeconds: 2 * 3600,
  doubleTimeSeconds: 0,
  mealPremiumCents: 0,
  grossEarningsCents: 22000,
});
expect(result.classifiedSeconds).toBe(result.workedSeconds);
expect(result.exceptions).toEqual([]);
```

Run: `npm test -- --run tests/payroll-california-calculation.test.ts tests/payroll-timesheet-snapshot-migration.test.ts`

Expected: FAIL because calculation modules and snapshot schema do not exist.

- [ ] **Step 3: Implement deterministic event pairing and boundary splitting**

`pairEvents` returns paid intervals, meals, category segments, and blocking exceptions. It must sort by authoritative occurrence instant then server receipt/id, never infer a missing event, and split at local workday, fixed 168-hour workweek, pay-period, rate-version, and jurisdiction boundaries.

```ts
export type CalculationInput = {
  employeeId: string;
  timezone: string;
  workdayStartLocal: string;
  workweekStartsOn: number;
  policyVersionId: string;
  payPeriodId: string;
  events: readonly CalculationEvent[];
  rateVersions: readonly RateVersion[];
  mealResolutions: readonly MealResolution[];
};

export function deriveCaliforniaTimesheet(input: CalculationInput): TimesheetCalculation;
```

- [ ] **Step 4: Implement California precedence and meals**

Classify double time first, then daily/seventh-day overtime, then weekly overtime only on remaining regular seconds. Assert every worked second belongs to exactly one bucket. Meal detection produces exceptions; it never subtracts time automatically. A validated `premium_owed` resolution adds one hour at the applicable base rate per supported premium without deleting worked time.

Unsupported policy flags return a blocking `unsupported_policy` exception and no lockable snapshot. The exception engine also identifies duplicate/open/overlapping shift, meal, and session events; attendance outside shifts; excessive reported/server skew; implausible duration; cross-midnight/DST ambiguity; missing rate/policy/pay-group assignment; stale snapshot; and correction-after-approval/export.

- [ ] **Step 5: Persist immutable versioned snapshots**

Create `timesheet_snapshots` and `timesheet_snapshot_lines` with repeated tenant keys, composite tenant foreign keys, policy/rate IDs, canonical JSON, SHA-256, hours buckets, premium cents, gross cents, and source-event high-water mark. `derive_timesheet_snapshot` runs in a transaction, invalidates prior current snapshots when inputs change, and returns an existing snapshot for an unchanged source/policy/rate hash.

Snapshot tables use enabled and forced RLS, allow scoped reads, and allow no application-role update/delete. A new derivation appends a version and a required payroll audit event.

- [ ] **Step 6: Expose period review and update `/time`**

`payroll-timesheets` supports `get_period` and `derive_snapshot`. Show exact punches, classified regular/OT/double-time hours, premiums, gross earnings, policy/rate version dates, exceptions, and correction effects. Do not add submit/approve controls until PR 4.

- [ ] **Step 7: Run calculation, tenant, performance, UI, and repository gates**

```powershell
deno test --no-check --allow-env supabase/functions/payroll-timesheets/index.test.ts
npm test -- --run tests/payroll-california-calculation.test.ts tests/payroll-timesheet-snapshot-migration.test.ts src/server/__tests__/payrollTimesheetsHandler.test.ts src/pages/__tests__/Time.test.tsx
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run test:routes:tier0
npm run ci:playwright
npm run build
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/time
npm run verify:local
```

The `performance-engineer` must review period derivation query count, indexes, maximum supported events per period, and explain plans for snapshot/source lookups. Run `verify-change` and `pr-hygiene`.

- [ ] **Step 8: Commit PR 3**

```powershell
$snapshotMigration = (Get-ChildItem supabase/migrations/*_payroll_timesheet_snapshots.sql | Sort-Object Name -Descending | Select-Object -First 1).FullName
git add -- $snapshotMigration supabase/functions/_shared/payroll supabase/functions/payroll-timesheets src/server/api/payroll-timesheets.ts src/server/__tests__/payrollTimesheetsHandler.test.ts netlify/functions/payroll-timesheets.ts netlify.toml tests/fixtures/payroll tests/payroll-california-calculation.test.ts tests/payroll-timesheet-snapshot-migration.test.ts src/features/payroll/api.ts src/features/payroll/usePayrollTime.ts src/pages/Time.tsx src/pages/__tests__/Time.test.tsx src/lib/generated/database.types.ts
git commit -m "feat(payroll): derive California earnings snapshots"
```

### Task 4: Submission, Manager Approval, and Payroll Locking (PR 4)

**Files:**
- Create via `npm run migration:new -- payroll_approval_workflow`: generator output matching `supabase/migrations/*_payroll_approval_workflow.sql`
- Create: `supabase/functions/payroll-approvals/index.ts`
- Create: `supabase/functions/payroll-approvals/index.test.ts`
- Create: `supabase/functions/payroll-administration/index.ts`
- Create: `supabase/functions/payroll-administration/index.test.ts`
- Create: `src/server/api/payroll-approvals.ts`
- Create: `src/server/api/payroll-administration.ts`
- Create: `src/server/__tests__/payrollApprovalsHandler.test.ts`
- Create: `src/server/__tests__/payrollAdministrationHandler.test.ts`
- Create: `netlify/functions/payroll-approvals.ts`
- Create: `netlify/functions/payroll-administration.ts`
- Modify: `netlify.toml` add `/api/payroll-approvals` before the SPA catch-all
- Modify: `netlify.toml` add `/api/payroll-administration` before the SPA catch-all
- Create: `src/pages/TimeReview.tsx`
- Create: `src/pages/Payroll.tsx`
- Create: `src/pages/__tests__/TimeReview.test.tsx`
- Create: `src/pages/__tests__/Payroll.test.tsx`
- Create: `scripts/playwright-payroll-approval.ts`
- Create: `tests/scripts/playwright-payroll-approval.test.ts`
- Create: `tests/payroll-approval-workflow-migration.test.ts`
- Modify: `src/features/payroll/contracts.ts`
- Modify: `src/features/payroll/api.ts`
- Modify: `src/App.tsx`, `src/components/Sidebar.tsx`, `src/server/routes/guards.ts`
- Modify: `src/lib/routeModulePrefetch.ts` add `/time/review` and `/payroll` lazy preloads
- Modify: related route, sidebar, and role tests
- Regenerate: `src/lib/generated/database.types.ts`

**Interfaces:**
- Consumes: current valid PR 3 snapshot/hash and explicit manager/payroll capabilities.
- Produces: protected employment/rate/pay-group/period/policy administration, append-only `timesheet_approvals`, employee submission, assigned-manager approval/return, payroll lock/reopen, and exact snapshot status consumed by PR 5.

- [ ] **Step 1: Write failing workflow-transition and authorization tests**

Run `npm run migration:new -- payroll_approval_workflow` before writing the migration contract and preserve its generated governance header.

Allowed transitions:

```text
draft -> submitted: employee on own current snapshot
submitted -> manager_approved: effective assigned manager
submitted -> returned: effective assigned manager with comment
manager_approved -> locked: payroll admin with lock capability and zero blocking exceptions
locked -> reopened: payroll admin with reopen capability and mandatory reason
```

Tests must reject self-approval by a manager who is also the employee, stale snapshot hashes, unassigned managers, profile/metadata authority, unresolved blocking exceptions, duplicate transition keys with changed payloads, and export use after reopen.

- [ ] **Step 2: Implement append-only approval transitions**

Create `timesheet_approvals` as transition records, not a mutable status row. Use repeated organization keys, composite tenant foreign keys, enabled and forced RLS, and append-only triggers. A current-state view derives status from the ordered transition chain. Each transition stores snapshot ID/hash, actor, occurred/received timestamps, reason/comment, idempotency key, and previous transition ID. Every successful transition appends a required payroll audit event in the same transaction.

Corrections or new source events after submission append `approval_invalidated`. Reopen appends `period_reopened`; it never deletes the prior lock.

- [ ] **Step 3: Implement protected approval APIs**

`payroll-approvals` accepts:

```ts
type ApprovalAction =
  | { action: "submit"; snapshotId: string; snapshotHash: string; attestation: true }
  | { action: "manager_approve"; snapshotId: string; snapshotHash: string; comment?: string }
  | { action: "return"; snapshotId: string; snapshotHash: string; comment: string }
  | { action: "lock"; snapshotId: string; snapshotHash: string }
  | { action: "reopen"; snapshotId: string; snapshotHash: string; reason: string };
```

The server derives actor/org and uses the transition RPC. Do not expose direct table mutations.

- [ ] **Step 4: Implement protected employment and pay-period administration**

`payroll-administration` requires `payroll.configure_employment` and exposes effective-dated create/deactivate actions for organization payroll identifiers, employment profiles, base rates, manager assignments, payroll capability grants, pay groups, pay-group assignments, pay-period generation, and supported policy activation. Correction/attendance-correction review and exception resolution require `payroll.resolve_exceptions`; applying a correction appends replacement interpretation/events and required audit history. It never accepts an organization ID and never deletes a version. Tests must cover overlapping effective ranges, external identifier uniqueness and CSV safety, monthly assignment rejection, unsupported jurisdiction/policy rejection, compensation visibility, correction-after-lock requiring reopen, and correction-after-export producing a new adjustment chain.

Generate pay periods deterministically from pay-group cadence, timezone, and calendar anchor. Re-running generation returns existing periods and cannot change boundaries after source events exist.

- [ ] **Step 5: Build employee, manager, and payroll-admin views**

Add employee attestation/submit to `/time`. `/time/review` lists only effective manager assignments and hides rates unless the actor separately has `payroll.view_compensation`. `/payroll` provides Employment, Pay Groups, Periods, Exceptions, and Approvals tabs. It lists blocking exceptions, manager approval state, lock/reopen actions, and compensation only for explicitly granted payroll actors.

Returned and invalidated states must remain employee-visible with reason and history. Never permit a manager to edit punches in the approval UI; corrections use the existing request flow.

- [ ] **Step 6: Run approval browser and repository gates**

```powershell
deno test --no-check --allow-env supabase/functions/payroll-approvals/index.test.ts supabase/functions/payroll-administration/index.test.ts
npm test -- --run tests/payroll-approval-workflow-migration.test.ts src/server/__tests__/payrollApprovalsHandler.test.ts src/server/__tests__/payrollAdministrationHandler.test.ts src/pages/__tests__/TimeReview.test.tsx src/pages/__tests__/Payroll.test.tsx tests/scripts/playwright-payroll-approval.test.ts
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run test:routes:tier0
npm run ci:playwright
npm run build
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/time
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/time/review
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/payroll
npm run verify:local
```

Run all required specialists, `auth-routing-guard`, `responsive-ui-observer`, `supabase-tenant-safety`, `verify-change`, and `pr-hygiene`.

- [ ] **Step 7: Commit PR 4**

```powershell
$approvalMigration = (Get-ChildItem supabase/migrations/*_payroll_approval_workflow.sql | Sort-Object Name -Descending | Select-Object -First 1).FullName
git add -- $approvalMigration supabase/functions/payroll-approvals supabase/functions/payroll-administration src/server/api/payroll-approvals.ts src/server/api/payroll-administration.ts src/server/__tests__/payrollApprovalsHandler.test.ts src/server/__tests__/payrollAdministrationHandler.test.ts netlify/functions/payroll-approvals.ts netlify/functions/payroll-administration.ts netlify.toml src/pages/TimeReview.tsx src/pages/Payroll.tsx src/pages/__tests__/TimeReview.test.tsx src/pages/__tests__/Payroll.test.tsx scripts/playwright-payroll-approval.ts tests/scripts/playwright-payroll-approval.test.ts tests/payroll-approval-workflow-migration.test.ts src/features/payroll/contracts.ts src/features/payroll/api.ts src/App.tsx src/components/Sidebar.tsx src/lib/routeModulePrefetch.ts src/lib/__tests__/routeModulePrefetch.test.ts src/server/routes/guards.ts src/lib/generated/database.types.ts
git commit -m "feat(payroll): add snapshot-bound approval workflow"
```

### Task 5: Provider-Neutral CSV Export and Adjustments (PR 5)

**Files:**
- Create via `npm run migration:new -- payroll_export_ledger`: generator output matching `supabase/migrations/*_payroll_export_ledger.sql`
- Create: `supabase/functions/payroll-export/index.ts`
- Create: `supabase/functions/payroll-export/index.test.ts`
- Create: `src/server/payroll/exportTypes.ts`
- Create: `src/server/payroll/canonicalRows.ts`
- Create: `src/server/payroll/csvAdapterV1.ts`
- Create: `src/server/payroll/exportHash.ts`
- Create: `src/server/payroll/__tests__/canonicalRows.test.ts`
- Create: `src/server/payroll/__tests__/csvAdapterV1.test.ts`
- Create: `src/server/api/payroll-export.ts`
- Create: `src/server/__tests__/payrollExportHandler.test.ts`
- Create: `netlify/functions/payroll-export.ts`
- Modify: `netlify.toml` add `/api/payroll-export` before the SPA catch-all
- Create: `tests/fixtures/payroll/provider-neutral-v1.csv`
- Create: `tests/payroll-export-ledger-migration.test.ts`
- Create: `scripts/playwright-payroll-export.ts`
- Create: `tests/scripts/playwright-payroll-export.test.ts`
- Modify: `src/pages/Payroll.tsx` export/reconciliation UI
- Modify: `src/pages/__tests__/Payroll.test.tsx`
- Regenerate: `src/lib/generated/database.types.ts`

**Interfaces:**
- Consumes: PR 4 locked snapshot chain.
- Produces: immutable canonical rows, versioned CSV bytes, SHA-256 checksum, idempotent export run, and linked adjustment exports.

- [ ] **Step 1: Write failing golden, PHI-exclusion, and migration tests**

Run `npm run migration:new -- payroll_export_ledger` before writing the migration contract and preserve its generated governance header.

The v1 canonical header is fixed:

```csv
schema_version,export_id,adjusts_export_id,organization_payroll_id,employee_payroll_id,pay_group_id,period_start,period_end,work_date,earning_code,hours,base_rate,applied_rate,gross_earnings,correction_indicator,snapshot_version,snapshot_hash
```

Tests must prove deterministic row ordering, RFC 4180 escaping, UTF-8 with CRLF, CSV-formula injection rejection for identifier fields beginning with `=`, `+`, `-`, or `@`, decimal rendering from integer seconds/cents, stable SHA-256, unchanged-run idempotency, adjustment linkage, totals reconciliation, and absence of these case-insensitive tokens in headers or values: `session`, `client`, `patient`, `diagnosis`, `goal`, `note`, `authorization`.

- [ ] **Step 2: Implement export ledger and authorization**

Create append-only `payroll_export_runs` and `payroll_export_rows` with repeated organization keys, composite tenant foreign keys, enabled and forced RLS, and exact ACLs. An export run stores organization/pay group/period, adapter version, source snapshot IDs/hashes, adjustment parent, checksum, row count, totals, actor, and timestamps. Only `payroll.export_period` can create/read downloadable export bytes; employees and ordinary managers cannot read rows.

`create_payroll_export` locks the pay-period export scope, verifies every employee snapshot is locked/current, verifies no blocking exception or reopen exists, and returns the prior run for the same canonical hash.

- [ ] **Step 3: Implement canonical rows and CSV adapter**

Use explicit decimal helpers; never use binary floating-point for persisted/exported money:

```ts
export type CanonicalPayrollRow = {
  schemaVersion: "provider-neutral-v1";
  earningCode: "REG" | "OT" | "DT" | "MEAL_PREMIUM";
  seconds: number;
  baseRateCents: number;
  appliedRateNumerator: 1 | 3 | 2;
  appliedRateDenominator: 1 | 2;
  grossCents: number;
  snapshotVersion: number;
  snapshotHash: string;
};

export function buildCanonicalRows(input: LockedPeriodInput): CanonicalPayrollRow[];
export function renderProviderNeutralCsvV1(rows: readonly CanonicalPayrollRow[]): string;
```

Derive `hours`, `base_rate`, `applied_rate`, and `gross_earnings` as fixed decimal strings at render time.

- [ ] **Step 4: Implement protected download and reconciliation UI**

`POST /api/payroll-export` creates or reuses a run. `GET /api/payroll-export?runId=<uuid>` returns `text/csv` only after rechecking actor/org/export capability. Set `Content-Disposition` to a filename containing no organization or employee name.

The `/payroll` UI displays adapter version, checksum, row count, regular/OT/DT/premium totals, source snapshot count, prior adjustment link, and download action. It must show a reconciliation failure instead of offering a download when canonical row totals differ from locked snapshots. The employee `/time` history shows that a period was exported and any later adjustment status without exposing peer rows or the provider CSV.

- [ ] **Step 5: Prove export reconciliation and full v1 flow**

Run:

```powershell
deno test --no-check --allow-env supabase/functions/payroll-export/index.test.ts
npm test -- --run tests/payroll-export-ledger-migration.test.ts src/server/payroll/__tests__/canonicalRows.test.ts src/server/payroll/__tests__/csvAdapterV1.test.ts src/server/__tests__/payrollExportHandler.test.ts src/pages/__tests__/Payroll.test.tsx tests/scripts/playwright-payroll-export.test.ts
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run test:routes:tier0
npm run ci:playwright
npm run build
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/payroll
npm run verify:local
```

Run the end-to-end synthetic scenario: configure employee/rate/pay group -> clock shift/meal -> record linked session attendance -> derive CA snapshot -> employee submit -> assigned manager approve -> payroll lock -> export -> append post-export correction -> invalidate/reapprove/relock -> adjustment export linked to original. Assert source seconds, snapshot seconds/cents, approval hashes, export rows, and checksums reconcile.

Run required specialists including `performance-engineer`, then `auth-routing-guard`, `responsive-ui-observer`, `supabase-tenant-safety`, `verify-change`, and `pr-hygiene`.

- [ ] **Step 6: Commit PR 5**

```powershell
$exportMigration = (Get-ChildItem supabase/migrations/*_payroll_export_ledger.sql | Sort-Object Name -Descending | Select-Object -First 1).FullName
git add -- $exportMigration supabase/functions/payroll-export src/server/payroll src/server/api/payroll-export.ts src/server/__tests__/payrollExportHandler.test.ts netlify/functions/payroll-export.ts netlify.toml tests/fixtures/payroll/provider-neutral-v1.csv tests/payroll-export-ledger-migration.test.ts scripts/playwright-payroll-export.ts tests/scripts/playwright-payroll-export.test.ts src/pages/Payroll.tsx src/pages/__tests__/Payroll.test.tsx src/lib/generated/database.types.ts
git commit -m "feat(payroll): export locked earnings as neutral CSV"
```

## Final Activation Gate

Do not activate `payroll_timekeeping_v1` during any implementation PR. After PR 5 is merged, prepare a separate owner-reviewed activation packet containing:

```text
supported population: ordinary California nonexempt employees only
unsupported population: alternative workweeks, CBAs, specialized wage orders, minors, health-care 8/80, Texas, Arizona
feature default: disabled
candidate organizations: explicit IDs approved by owner, never inferred
legal/operations fixture approval: attached
exact main SHA and exact-head CI: attached
tenant/RLS verification card: pass
employee/manager/payroll desktop and mobile evidence: pass
export reconciliation and PHI exclusion: pass
rollback: disable organization feature override; preserve all source/history rows
```

The owner enables only an explicit synthetic or approved pilot organization through the existing feature-flag administration path. A rollback disables the organization override; it never deletes payroll records or rewrites events, approvals, or exports.

## Plan Self-Review Checklist

- Spec coverage: separate clocks, optional linkage, prompt-not-auto-clock, close-not-clock-out, all nonexempt roles, base rate, three pay-group definitions with monthly fail-closed assignment, three-step approval, meals, exact time, offline queue, append-only corrections, California calculations, PHI-free neutral CSV, adjustment exports, and inactive Texas/Arizona are mapped to tasks.
- Type consistency: event, capability, category, location, snapshot, approval, and export names are defined before use.
- Authority consistency: every privileged route derives actor/org server-side and uses canonical `user_roles` plus explicit payroll grants/assignments.
- UI completeness: no route exposes a control before its authoritative persistence and state transition exists.
- Rollback safety: every PR can remain merged while the feature is disabled; activation rollback does not destroy evidence.
- Placeholder scan: the plan contains no deferred implementation markers or unspecified error-handling steps.
