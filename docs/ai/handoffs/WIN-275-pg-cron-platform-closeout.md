# WIN-275 Owner-Authorized `pg_cron` Platform Closeout

## Boundary

- classification: `high-risk human-reviewed`
- lane: `critical`
- issue: `WIN-275`
- reviewed repair: PR #987, exact head `c245ea45d48a1fb18a11f312f3a6bac083e05e7d`
- merged main: `b87342d3c960941173866e42f5d1292362fe5f2a`
- allowed hosted action: owner-authorized Supabase Studio/platform-managed removal of only the incident `pg_cron` extension
- prohibited actions: another recovery workflow dispatch, advisory or active enablement, PHI/customer-content access, provider/model calls, schedules, retention deletion, or synthetic fixture creation

## Evidence

The approved read-only pre-state reported `pg_cron_oid=457927` with zero Cron jobs, Ledger rows, queue/archive rows, drafts, fixed Vault names, active retention policies, ungranted locks, and synthetic fixture residue. PR #987 was merged, and all required exact-head and current-main checks passed before the platform path was authorized.

When Codex reacquired the exact Supabase Studio Extensions window for the confirmed action, the `pg_cron` control already displayed disabled. Codex therefore issued no additional mutation. Independent Supabase extension inventory reported `pg_cron.installed_version=null`. Direct catalog reconciliation reported `pg_cron_oid=null`, `cron_job_count=0`, and every guarded residue count still zero.

The final Edge Function Secrets readback reported the `AGENT_WORK_LEDGER_RUNTIME_MODE` digest as `17eb3c0168d0d7b21ede5481150f17233427d89833ec121b4dbc4fb96cfab71e`, exactly SHA-256 of the literal `disabled`. The recovery workflow still has only historical failed run `32411528128`; no second dispatch occurred.

## Result

The recorded pre-state and final post-state are proven: exact incident OID `457927` was present before the platform path, `pg_cron` is now absent, every guarded residue count remains zero, and runtime mode remains `disabled`. The transition mechanism was not observed by Codex. No active or advisory mode was enabled, and no PHI/customer-content read, provider/model call, schedule, retention deletion, or fixture creation occurred.

Audit limitation: Supabase Studio does not expose the reviewed advisory-lock, `ACCESS EXCLUSIVE` lock, or exact mutation-count artifact. Lock and one-mutation provenance are unavailable rather than inferred. The residue gate is cleared, but any later advisory canary remains a separate critical action requiring its own exact owner acknowledgement and fresh live gates.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: docs/process-only closeout for a protected hosted Supabase operation
- required checks: `git diff --check`; protected-surface drift check; PR #987 exact-head CI; current-main CI; live hosted post-state; runtime-disabled digest; recovery workflow run inventory
- executed checks: `git diff --check` pass; existing hash-bound handoffs and attestations unchanged; PR #987 exact-head required CI pass; current-main required CI pass; `pg_cron.installed_version=null`; `pg_cron_oid=null`; all guarded residue counts zero; runtime digest equals SHA-256(`disabled`); no second recovery workflow run
- blocked checks: Supabase Studio transaction-lock and exact mutation-count provenance are unavailable
- result: `pass-with-blocked-checks`
- residual risk: the platform-managed transition cannot prove the reviewed SQL lock sequence or exact mutation count; a later advisory canary still requires a new critical owner gate
- pr-ready: `yes` for documentation-only owner review; this update authorizes no hosted action
