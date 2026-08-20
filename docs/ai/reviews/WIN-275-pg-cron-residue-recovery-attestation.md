# WIN-275 `pg_cron` Residue Recovery Attestation

## Review Boundary

This owner-dispatched critical slice is limited to `expected_pg_cron_oid=457927`. Its read-only preflight requires `cron.job=0`, zero related residue, and affirmative drop-authority proof for the Management API execution role. Its only database write is the guarded `DROP EXTENSION pg_cron` transaction under scheduler advisory locks and an `ACCESS EXCLUSIVE` `cron.job` lock. An always-conditioned read-only reconciliation distinguishes an exact unchanged OID from a completed drop after an ambiguous write response and rejects every other state; it also runs after a capability-preflight failure before disabled fallback, without invoking recovery. The public artifact is sanitized.

Non-goals are explicit: no retries, no chaining, no advisory, no active mode, no schedules, no Vault or Edge-secret deletion, no Ledger/queue/archive/fixture deletion, no retention deletion, and no provider/model calls. Hosted reads return only aggregate residue counts and fixed synthetic-marker matches; they do not return or archive customer record contents. The hash-bound specialist manifest is created after final specialist review from the exact reviewed surfaces before the PR is review-ready.

The owner must personally inspect and merge. Dispatch later requires `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY`, the exact current `main`, merged PR number, and immutable inputs.

## HTTP 400 Repair Evidence

Run `32411528128` failed at the Management API write with HTTP 400, then reconciled exact OID `457927` unchanged with zero residue and restored runtime `disabled`. No hosted mutation committed.

Fresh read-only catalog evidence proves OID `457927` is owned by `supabase_admin`; the Management API query session and current role are `postgres`; `postgres` is not superuser and has no membership or `SET ROLE` authority for `supabase_admin`. The missing drop-authority gate, rather than the OID or residue guard, caused the unsupported write attempt. The repair now rejects that state before mutation. It adds no role escalation, ownership change, retry, credential, or second mutation. No hosted dispatch was performed for this repair.

Until a supported owner-capable Supabase execution surface is available, the exact residue remains a precise blocker. A later owner dispatch is not authorized by this PR or attestation and must still satisfy every separate owner, exact-head CI, hash, OID, zero-residue, disabled-mode, non-PHI, and no-active-mode gate.

Delegated browser dispatch allowlist (exactly four literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml`, `.github/workflows/provision-qa-personas.yaml`].

The cleanup, canary, and QA persona acknowledgements remain `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`, `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY`, and `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING`. Each workflow requires separate fresh owner authorization in the current task for exactly one browser click dispatch through the owner's already-authenticated in-app GitHub browser session. Codex must recheck main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs immediately before click. Authorization is one-time, consumed on click, non-transferable, non-reusable, and revoked by drift, missing evidence, navigation/session ambiguity, or a failed run.

The general prohibition remains outside this literal allowlist. It must forbid gh/CLI/API/token dispatch, secret viewing, self-authorization, gate weakening, and extension to any other workflow. Codex cannot merge. Any later canary remains temporary advisory only and restores disabled first; active mode is forbidden, and cleanup is zero residue with no provider/model calls or retention deletion.
