# WIN-275 Hosted `pg_cron` Residue Recovery

## Scope

This critical, owner-dispatched recovery removes only the failed canary's exact hosted `pg_cron` extension OID. The immutable input `expected_pg_cron_oid` must be `457927` for the currently observed incident, but the workflow fails closed if live state differs.

The sequence is: reassert runtime `disabled`; run a read-only preflight; require `cron.job=0` and zero Ledger, queue, archive, draft, Vault-canary, Edge-canary, retention-policy, lock, and synthetic-fixture residue; acquire the scheduler advisory locks and an `ACCESS EXCLUSIVE` lock only on extension-owned `cron.job`; repeat the exact OID and database/Vault zero-residue checks inside the bounded transaction; execute `DROP EXTENSION pg_cron`; then reconcile every attempted mutation even if the write response failed, timed out, or the recovery step was cancelled. The job-level cleanup condition survives cancellation so reconciliation and disabled fallback can run, while the twenty-minute job timeout remains the hard ceiling. Reconciliation accepts only exact OID `457927` still present with zero residue or the extension absent with zero residue; every other state fails closed. Edge-secret names are checked immediately before and after through a separate read-only CLI call because they cannot participate in the database transaction. Five-second lock and twenty-second statement timeouts fail closed rather than block ordinary hosted writes. The public artifact contains only fixed booleans, counts, timings, and a summary hash.

There are no retries and no chaining into the advisory canary. This workflow performs no advisory activation, no active mode, no schedules, no Vault or Edge-secret deletion, no Ledger or fixture deletion, no retention deletion, and no provider/model calls. Its hosted reads return only aggregate residue counts and fixed synthetic-marker matches; they do not return or archive customer record contents. The hash-bound specialist manifest is created after final specialist review and binds the exact reviewed surfaces before PR-ready closure.

## Owner Gate

The repository owner must personally inspect and merge the critical PR. A later dispatch is a separate action and requires the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY`, the merged WIN-275 PR number, the exact current-main commit SHA, `expected_pg_cron_oid=457927`, and fresh authorization in the current task.

Delegated browser dispatch allowlist (exactly four literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml`, `.github/workflows/provision-qa-personas.yaml`].

The other exact acknowledgements remain `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`, `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY`, and `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING`. Authorization is separate per workflow and permits exactly one browser click dispatch through the owner's already-authenticated in-app GitHub browser session. It binds all immutable inputs. Codex must recheck main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs immediately before click. Authorization is one-time, consumed on click, non-transferable, non-reusable, and revoked by any drift, missing evidence, navigation/session ambiguity, or failed run.

The general prohibition remains for all other dispatch actions. Codex cannot merge this PR. The exception forbids gh/CLI/API/token dispatch, secret viewing, self-authorization, gate weakening, and extension to any other workflow. Any later canary remains temporary advisory only and restores disabled first; active mode remains forbidden, and all cleanup remains zero residue with no provider/model calls or retention deletion.

## Route And Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: CI/workflow/policy and protected hosted Supabase extension recovery
- required checks: focused recovery/delegation/workflow contracts; script syntax; workflow YAML/runtime pins; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; exact-head CI; current-main CI after merge; read-only hosted preflight; owner-dispatched hosted proof
- executed checks: `npm ci` pass; seven focused contract suites `99/99` pass; script syntax and workflow YAML parse pass; `git diff --check` pass; policy pass; lint pass; typecheck pass; tenant validation pass; build pass; six independent specialist reviews pass
- blocked checks: local `npm run test:ci` reached the Windows Node 4 GB heap limit after broad progress, so exact-head GitHub CI remains the decisive full-suite gate; current-main CI and owner-dispatched hosted proof remain pending; hosted mutation is explicitly withheld pending owner merge and fresh authorization
- result: `pass-with-blocked-checks`
- residual risk: the one-time extension drop is irreversible and remains blocked until the final hash manifest, specialist PASS reviews, exact-head CI, owner merge, immediate live OID/zero-residue revalidation, and a separate exact browser authorization
- pr-ready: `yes` for an owner-reviewed critical PR; merge and hosted dispatch remain separately blocked
