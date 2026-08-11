# Payroll-Grade Timekeeping Design

## Tracking

- Date: 2026-08-11
- Branch: `codex/payroll-timekeeping-design`
- Linear: required before implementation; not created during design
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Status: approved design; implementation plan written; implementation not started
- Implementation plan: `docs/superpowers/plans/2026-08-11-payroll-grade-timekeeping.md`

## Purpose

Add payroll-grade timekeeping for every nonexempt organization employee while preserving the existing clinical and insurance session lifecycle. The application will produce approved payroll-ready hours and gross earnings through a provider-neutral CSV adapter. Tax withholding, deductions, filings, money movement, and full payroll processing remain outside v1.

This document is a product and engineering design, not legal advice. California is the active v1 jurisdiction. Texas and Arizona are documented for future activation in:

- `docs/superpowers/specs/2026-08-11-payroll-timekeeping-texas-readiness.md`
- `docs/superpowers/specs/2026-08-11-payroll-timekeeping-arizona-readiness.md`

## Research Basis

The design uses the following primary sources as of 2026-08-11:

- [FLSA recordkeeping requirements](https://www.dol.gov/agencies/whd/fact-sheets/21-flsa-recordkeeping)
- [FLSA hours-worked guidance](https://www.dol.gov/agencies/whd/fact-sheets/22-flsa-hours-worked)
- [California Labor Code section 510](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=510.)
- [California Labor Code section 1174](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=1174.)
- [California payday guidance](https://www.dir.ca.gov/dlse/FAQ_Paydays.htm)
- [California overtime guidance](https://www.dir.ca.gov/dlse/faq_overtime.htm)
- [California meal-period guidance](https://www.dir.ca.gov/dlse/faq_mealperiods.htm)
- [HHS minimum-necessary guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/minimum-necessary-requirement/index.html)

The applicable California IWC wage order and any valid exception, alternative workweek, collective bargaining agreement, or health-care 8/80 arrangement must be confirmed by qualified operations/legal reviewers before activation. V1 fails closed when an employee requires an unsupported rule set.

## Problem

The existing session workflow is not payroll-authoritative:

- `sessions.started_at` records a clinical lifecycle transition, not a complete paid shift.
- generic and BT-specific close paths do not persist an authoritative actual work end timestamp on the session row
- an admin or scheduling actor may perform a session transition for another employee
- scheduled start/end and billing duration are not proof of all compensable work
- the current model cannot represent meals, travel, training, administration, missed punches, corrections, pay periods, approvals, or exports
- existing session audit writes are not a substitute for an immutable payroll ledger

Payroll time must therefore be modeled separately from session attendance and clinical completion.

## Approved Product Decisions

- Produce payroll-ready hours and gross earnings for an external provider; do not implement a full payroll engine.
- Use a provider-neutral canonical export with a versioned CSV adapter first.
- Cover every nonexempt employee, including session staff, schedulers, and administrative staff.
- Keep session linkage optional for payroll records.
- Use both a payroll shift clock and a separate insurance/audit session clock.
- A session interval classifies time inside a shift but never adds duplicate payable time.
- Starting a session without an active shift prompts the employee to clock in. Continuing creates a reconciliation exception; it does not silently create payroll time.
- Closing a session never clocks the employee out.
- Use one effective-dated base hourly rate per employee in v1.
- Preserve work categories such as direct service, administration, travel, and training even though they use the same base rate in v1.
- Support weekly, biweekly, and monthly pay-group definitions in the generic model.
- Prevent assignment of a nonexempt employee to a pay schedule that violates the employee's active jurisdiction policy. California, Texas, and Arizona generally require more frequent payment than monthly for the in-scope nonexempt population, so monthly is not activatable for those employees without a validated exception.
- Use employee submission, assigned-manager approval, and payroll-admin lock/export.
- Make corrections append-only, reasoned, and employee-visible.
- Use manual meal-start and meal-end punches. Never apply automatic meal deductions.
- Keep paid rest breaks on the clock.
- Use exact recorded time without rounding.
- Do not use continuous GPS or biometric surveillance in v1. Record an employee-selected work location and ordinary request/device metadata.

## Authority Boundaries

### Payroll timekeeping

Payroll timekeeping is authoritative for compensable employee time and earnings. It owns shifts, meals, work categories, corrections, exceptions, pay periods, snapshots, approvals, locks, and exports.

### Session attendance

Session attendance is authoritative for the exact service interval used by insurance, billing reconciliation, and audits. `Start Session` and `Close Session` produce attendance events. They do not silently mutate payroll time.

### Clinical session lifecycle

The existing session domain remains authoritative for scheduling, goals, notes, and clinical completion. Payroll approval cannot complete or modify a clinical session. Clinical completion cannot approve, lock, or export payroll.

## Architecture

Use separate bounded modules in the existing React/Vite application and Supabase project:

1. employment configuration
2. immutable payroll event capture
3. immutable session-attendance capture
4. jurisdiction policy calculation
5. timesheet derivation and exception detection
6. submission, approval, lock, and reopen workflow
7. canonical export and CSV rendering
8. reconciliation and adjustment exports

All privileged mutations pass through protected server or RPC boundaries. Application clients cannot directly update or delete raw events, approvals, locked snapshots, or export history.

Every mutation requires an idempotency key. The event, actor metadata, tenant scope, and idempotency result commit atomically. Payroll mutations fail if their required audit append fails.

## Identity and Capabilities

Create a first-class employment profile independent of `therapists`. Session-delivery staff may link the employment profile to an existing therapist/BT identity. Other employees use payroll without gaining clinical permissions.

Use canonical organization-scoped `user_roles` authority. Do not authorize payroll through `profiles.role`, `user_metadata`, client-supplied organization IDs, or UI visibility.

Required capabilities are distinct:

- `time.clock_self`
- `time.view_self`
- `time.request_correction_self`
- `time.review_assigned`
- `time.approve_assigned`
- `payroll.configure_employment`
- `payroll.resolve_exceptions`
- `payroll.lock_period`
- `payroll.reopen_period`
- `payroll.export_period`
- `payroll.view_compensation`

Super-admin and impersonation behavior must receive a separate security review. Impersonation must never become an alternate authority path for payroll approval or export.

## Data Model

Names are conceptual until implementation planning validates existing naming and migration conventions.

### Configuration

- `employment_profiles`: organization, user, employee number, nonexempt classification, home jurisdiction, timezone, active dates, and optional therapist identity
- `employee_rate_versions`: effective-dated base hourly rate
- `pay_groups`: cadence, calendar anchor, timezone, payday rule, and active status
- `pay_group_assignments`: effective-dated employee membership
- `pay_periods`: generated group periods and lifecycle state
- `payroll_policy_versions`: jurisdiction, effective dates, version, supported rule flags, and activation status

### Immutable source records

- `employee_time_events`: `shift_started`, `shift_ended`, `meal_started`, `meal_ended`, and work-category transitions
- `session_attendance_events`: `session_started` and `session_ended`

Each event records:

- organization and employee
- actor
- server receipt timestamp
- reported occurrence timestamp
- effective timezone and selected work location
- event source
- idempotency key
- optional session reference
- optional superseded interpretation reference
- safe metadata without PHI

Raw events cannot be updated or deleted through application roles.

### Workflow and derived records

- `time_correction_requests`: original event references, proposed replacements, reason, requester, review state, and resolution
- `timekeeping_exceptions`: type, severity, affected records, assignee, resolution reason, and lifecycle
- `timesheet_snapshots`: versioned derived intervals, policy/rate versions, regular/OT/double-time hours, premiums, and gross earnings
- `timesheet_approvals`: snapshot hash, employee attestation, manager approval, payroll lock, actors, and timestamps
- `payroll_export_runs`: group/period, adapter version, snapshot hashes, checksum, and reconciliation state
- `payroll_export_rows`: immutable canonical rows rendered by an export run

A correction appends a new interpretation and invalidates affected snapshots. Corrections after manager approval invalidate that approval. Corrections after export produce an adjustment snapshot and export; they never rewrite export history.

## Employee Workflow

The employee timekeeping surface shows:

- active shift and elapsed paid time
- active meal state
- selected work category and work location
- period totals and estimated earnings
- unresolved exceptions and correction history
- submission status

Employees manually start/end shifts and meals. Paid rest periods remain within the shift.

Offline punch attempts are visibly pending until the server confirms them. The UI never presents an unconfirmed event as authoritative.

At period end, the employee reviews punches, California calculations, exceptions, corrections, and gross earnings, then attests to the exact snapshot version and submits it.

## Session Workflow

`Start Session` records a session-attendance start using an authoritative server timestamp. If an active payroll shift exists, the session may reference the containing shift or derived segment.

If no payroll shift is active, the employee is prompted to clock in. The employee may continue the insurance/audit session without clocking in, but the system creates a visible session-outside-shift exception.

`Close Session` records session-attendance end independently of clinical note finalization and does not end payroll time. Payroll can continue for documentation, travel, administration, or other compensable work.

Session-attendance corrections use their own append-only review history. They do not silently rewrite payroll events.

## Approval Workflow

1. Employee attests to and submits a snapshot.
2. Assigned manager approves or returns that exact snapshot with comments.
3. Payroll admin resolves remaining exceptions, locks the approved snapshot, and exports it.

Managers cannot silently replace punches. Payroll admins may reopen a locked period only with a reason. Reopening invalidates the lock and prevents use of stale export data.

## California Calculation Policy

The calculation engine uses exact instants and an effective local workday/workweek. It must:

- pair valid shift and meal events deterministically
- split intervals at local workday, workweek, pay-period, rate, and jurisdiction boundaries
- calculate daily overtime, weekly overtime, double time, and seventh-day rules without classifying the same minute twice
- use only hours actually worked for overtime thresholds unless a validated rule says otherwise
- retain the policy version and all inputs used for each result
- detect unsupported exceptions and fail closed before lock/export

The first implementation must use reviewed California fixtures that cover ordinary nonexempt employees. Alternative workweeks, collective bargaining agreements, specialized wage orders, minors, and health-care 8/80 arrangements are unsupported until separately designed and validated.

### Meals

Never deduct meals automatically. Detect missing, late, short, interrupted, or overlapping meal punches. Resolution requires one of these recorded outcomes:

- corrected punch
- compliant meal
- validated waiver
- premium owed
- unsupported policy requiring escalation

Premiums cannot be silently suppressed. Work performed during a meal remains payable time.

## Exceptions and Fail-Closed Rules

Create explicit exceptions for:

- missing or duplicate punches
- open shifts, meals, or sessions
- overlapping shifts or session attendance
- session attendance outside payroll shifts
- excessive reported-time/server-time skew
- implausible durations
- cross-midnight and DST ambiguity
- schedule-versus-actual differences
- stale corrections or approvals
- unsupported jurisdiction policy
- export/snapshot checksum mismatch

Do not silently close open records. Structurally incomplete timesheets cannot be submitted. Required employee corrections block manager approval. Lock requires employee attestation and manager approval. Export requires a locked snapshot and deterministic recalculation with matching hashes.

## Offline and Retry Behavior

For temporary connectivity loss, store a pending event locally with a unique device operation ID and reported occurrence time. On reconnection, the server:

1. authenticates and resolves organization/employee authority
2. deduplicates by idempotency key
3. stores server receipt and reported occurrence times
4. validates event ordering
5. confirms the event or creates a review exception

An offline replay cannot update an existing event or bypass period locks.

## Provider-Neutral Export

The canonical export row includes:

- export and adjustment identifiers
- organization payroll identifier
- employee payroll identifier
- pay group and period dates
- work date
- earning code
- regular, overtime, and double-time hours
- base and applied rates
- gross earnings
- correction indicator
- source snapshot version and hash

The CSV excludes session IDs, client IDs, names, diagnoses, goals, notes, authorization data, and other PHI.

CSV schemas are versioned. Re-running an unchanged locked period returns the existing export. A post-export correction creates an adjustment export referencing the original run.

## Privacy and Retention

- Apply organization-scoped RLS to every payroll table.
- Restrict compensation visibility separately from ordinary scheduling/admin visibility.
- Keep payroll and clinical payloads separate.
- Do not log raw payroll rows, rates, PHI, or correction narratives in application telemetry.
- Retain payroll source and result records for at least four years, configurable longer and suspendable for legal hold.
- Keep session-attendance retention separately configurable for payer, clinical, and contractual requirements.
- Provide employee access to their own time, correction, approval, and export-derived records without exposing peer compensation.

## Delivery Phases

All phases remain behind a disabled feature flag until the complete California path is validated and approved.

1. Foundation: employment profiles, rates, pay groups, periods, immutable events, capabilities, RLS, grants, and audits.
2. Employee capture: shift/meal UI, offline pending events, corrections, exceptions, and session-attendance integration.
3. California calculations: interval derivation, overtime/double time, meals/premiums, snapshots, and earnings.
4. Approvals: attestation, assigned-manager review, payroll lock/reopen, and adjustment workflow.
5. Neutral export: canonical rows, versioned CSV, checksums, idempotency, and reconciliation.
6. Jurisdiction activation: Texas and Arizona only after separate implementation specs and current legal/operations validation.

Each implementation slice must be end-to-end and reviewable. No slice may expose a UI control backed by incomplete or non-authoritative persistence.

## Verification Contract

### Focused tests

- unit and property tests for interval pairing, boundaries, policy/rate versions, California overtime precedence, seventh-day rules, DST, meals, corrections, and snapshot hashes
- migration and SQL tests for append-only enforcement, RLS, grants, cross-tenant denial, capabilities, approval transitions, and export locking
- API tests for authentication, idempotency, concurrency, offline replay, stale approvals, required-audit failure, and malformed exports
- browser tests for employee, manager, and payroll-admin flows at desktop and mobile viewports
- golden CSV fixtures for stable columns, totals, checksums, adjustment linkage, and PHI exclusion
- reconciliation tests proving raw events, snapshots, approvals, and export totals agree

### Required repository gates

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run test:routes:tier0`
- affected session/timekeeping Playwright tests
- `npm run test:ui:responsive` with the explicit loopback port and each affected route named by the implementation plan
- `npm run build`
- `npm run verify:local` when locally supported
- `verify-change`
- `pr-hygiene`

Required specialist sequence:

1. `specification-engineer`
2. `software-architect`
3. `implementation-engineer`
4. `code-review-engineer`
5. `test-engineer`
6. `security-engineer`
7. `supabase-reviewer`
8. `performance-engineer`

Each implementation PR requires a Linear issue, a verification card, review evidence, exact-head required checks, and human review before merge.

## Likely Protected Surfaces

- `supabase/migrations/**`
- `supabase/functions/**`
- `src/server/**`
- canonical role/auth helpers
- session start/close integration surfaces
- new employee, manager, and payroll-admin UI routes
- generated database types
- tenant, API-boundary, migration, unit, and browser tests

Exact allowed files belong in each implementation plan and must not be inferred from this architecture document.

## Non-Goals

- tax calculation or withholding
- benefits and deductions
- direct deposit or money movement
- tax filings or year-end forms
- provider-specific APIs in v1
- exempt-employee payroll
- automatic meal deductions
- automatic payroll clock-in/out from session actions
- continuous GPS, geofencing, screenshots, keystroke monitoring, or biometrics
- replacing clinical session status, notes, billing, or payer workflows
- activating Texas or Arizona policy calculations

## Stop Conditions

Stop and re-route if implementation:

- cannot keep payroll, session attendance, and clinical status independent
- needs client/PHI fields in payroll exports
- authorizes from `profiles.role`, user metadata, or client-supplied tenant context
- permits direct mutation/deletion of source events
- permits approval/export without the required snapshot chain
- silently suppresses overtime, meal premiums, corrections, or exceptions
- requires activating an unsupported wage order, jurisdiction, or pay schedule
- cannot contain service-role access to a pre-authorized organization and actor
- expands into tax, deduction, filing, or payment execution
