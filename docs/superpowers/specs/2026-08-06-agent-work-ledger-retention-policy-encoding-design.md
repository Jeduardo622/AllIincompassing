# Agent Work Ledger Retention Policy Encoding

## Decision

Record the solo-maintainer decision from WIN-275 as an immutable, migration-owned policy decision catalog:

- `ledger_history`: 365 days
- `queue_archive`: 90 days
- `execution_trace`: 30 days

The canonical approval text is:

`ledger_history=365 days, queue_archive=90 days, execution_trace=30 days; approve non-destructive policy encoding.`

Its UTF-8 SHA-256 is `148b3b42e4b5dfb1bf5fb134bc09351409a1181b53e68d2d0e45ee8b36609e34`.

## Design

Add one forward migration that creates a service-role-readable, append-only `agent_work_retention_policy_decisions` table and seeds version 1 for the three categories. The decision rows carry a machine-coded owner-attestation kind, the WIN-275 Linear comment reference, decision timestamp, and canonical decision hash.

This catalog is distinct from `agent_work_retention_policies`. The operational registry remains empty because it requires an environment-specific `auth.users` approver and represents runtime policy activation. The existing prune RPC remains unchanged and continues to return `policy_unapproved` with zero deletion.

## Safety

- Forced RLS and explicit grants allow `service_role` to select only.
- A trigger rejects updates and deletes; future decisions are new migration-owned versions.
- No queue, trace, ledger, assessment, runtime, scheduler, Vault, provider, or hosted surface changes.
- No `.env*`, customer data, PHI, model call, or external provider access.
