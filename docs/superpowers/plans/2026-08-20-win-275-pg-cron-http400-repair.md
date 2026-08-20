# WIN-275 pg_cron HTTP 400 Repair Plan

## Route

- Classification: high-risk human-reviewed
- Lane: critical
- Issue: WIN-275

## Diagnosis

Hosted read-only catalog checks proved that `pg_cron` OID `457927` is owned by
`supabase_admin`, while Management API SQL executes as non-superuser `postgres`.
That role has neither membership nor `SET ROLE` authority for `supabase_admin`,
so PostgreSQL rejects `DROP EXTENSION pg_cron` before mutation.

## Scope

1. Add a read-only preflight capability proof for exact extension ownership and
   drop authority.
2. Fail before the recovery mutation when the Management API execution role
   cannot own or inherit ownership of the exact extension.
3. Preserve the exact OID, advisory locks, `cron.job` lock, one-mutation SQL,
   reconciliation, disabled mode, sanitized non-PHI evidence, and active-mode
   prohibition.
4. Update the WIN-275 handoff and hash-bound owner-review evidence.

## Non-Goals

- No hosted dispatch or hosted mutation.
- No role grant, ownership reassignment, credential staging, or undocumented API.
- No canary, scheduler, retention, Vault, tenant-policy, or active-mode changes.

## Verification

1. Demonstrate a focused contract test failing before the production edit.
2. Run the focused recovery and delegated-dispatch contracts.
3. Run policy, lint, typecheck, tenant validation, tests, and build as required.
4. Obtain independent critical-lane specialist reviews on the final hash-bound
   surfaces before opening the owner-review PR.

## Stop Conditions

- Stop if recovery requires privilege escalation or a second mutation.
- Stop if an owner-capable supported Supabase execution surface is unavailable.
- Stop before any hosted dispatch; report the exact capability blocker instead.
