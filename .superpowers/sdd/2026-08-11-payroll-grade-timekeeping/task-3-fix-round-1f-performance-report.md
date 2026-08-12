# Task 3 Fix Round 1F Performance Report

Status: review-ready
Date: 2026-08-12

Artifact:
- `reports/evidence/payroll-timesheet-derive-contract-1f-2026-08-12T10-43-09-419Z.json`
- Synthetic local Dockerized Supabase only: `127.0.0.1:54322/postgres`
- No customer, hosted, or environment-file data used.

Static contract:
- RED witnessed on `2026-08-12` via `npm test -- --run tests/payroll-timesheet-derive-contract.test.ts`.
- RED failure: missing authenticated JWT-context setup in `scripts/payroll-timesheet-derive-contract.mjs`.
- GREEN: `1` test passed after adding the authenticated context and transaction-isolated fixture contract.

Harness command:

```powershell
$env:PAYROLL_LOCAL_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'; npm run payroll:timesheet-derive-contract
```

Harness result:
- `success: true`
- Buckets: `0`, `50`, `200`, and `500` employee time-event rows.
- Every bucket ran the real authenticated `public.derive_timesheet_snapshot` RPC and returned `state: ok`.
- Every bucket used an outer transaction and rolled back its synthetic fixture and derived snapshot writes.

Timings (RPC wall):

| Source rows | Outcome | Wall time |
| ---: | --- | ---: |
| 0 | success | 60.925 ms |
| 50 | success | 59.176 ms |
| 200 | success | 35.669 ms |
| 500 | success | 98.026 ms |

Plan/index observations:
- `employee_time_events` used `employee_time_events_org_employment_event_at_idx` as an index-only scan in all four buckets.
- The 500-row employee-event source query remained bounded by `employee_time_events_org_employment_event_at_idx`; exact plan details are retained in the structured artifact.
- Correction and meal-resolution probes used event ownership indexes for joins. Their source tables were empty in this synthetic fixture, so PostgreSQL selected sequential scans on those empty relations.
- The receipt probe scanned a one-row transaction-local relation. This is not evidence of a scaling concern, but receipt-table scaling remains unproven by this harness.
- No hard wall-time threshold is asserted; the contract records evidence and fails on unsafe target, authentication mismatch, row-count mismatch, invalid RPC outcome, or missing bounded event index use.

Isolation and fail-closed evidence:
- The script accepts only the dedicated `PAYROLL_LOCAL_DATABASE_URL` input and rejects non-loopback, wrong-port, wrong-database, and wrong-user targets before connecting.
- The smoke fixture's own `BEGIN`/`COMMIT` wrapper is removed before execution so it remains inside each benchmark bucket's rollback-only transaction.
- The authenticated role and JWT subject are probed before the RPC call.
- The RPC result must match the exact canonical success envelope: UUID `snapshotId`, 64-character hexadecimal `sourceHash`, and `replayed: false`. Blocker, prerequisite, malformed, and unexpected-state envelopes fail closed.
- The static test loads this exact report-referenced artifact and verifies all four buckets, the canonical result fields, positive timings, exact source-plan families, plan/index consistency, scan metadata, source row counts, and bounded event index use.
- Before/after source counts remain stable; only the transaction-local idempotency receipt count changes from `0` to `1` before rollback.

Concerns and limits:
- This is bounded local evidence, not a production capacity claim or service-level objective.
- Empty correction and meal-resolution relations do not prove their behavior at large row counts.
- The planner estimated fewer employee-event rows than were returned at the 200- and 500-row buckets, but still selected the intended bounded composite index.
- Hosted activation remains forbidden for this task; payroll/legal review and human critical-lane review are still required.

Changed paths in this slice:
- `scripts/payroll-timesheet-derive-contract.mjs`
- `tests/payroll-timesheet-derive-contract.test.ts`
- `package.json`
- `reports/evidence/payroll-timesheet-derive-contract-1f-2026-08-12T10-43-09-419Z.json`
- `.superpowers/sdd/2026-08-11-payroll-grade-timekeeping/task-3-fix-round-1f-performance-report.md`
