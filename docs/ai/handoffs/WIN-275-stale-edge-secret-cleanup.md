# WIN-275 Stale Edge Secret Cleanup

## Boundary

This is an owner-dispatched, one-time protected cleanup for stale Supabase Edge names found by hosted advisory canary run `32281634841`. The only deletable names are:

- `AGENT_WORK_RUNNER_SECRET`
- `AGENT_WORK_SWEEPER_SECRET`
- `AGENT_WORK_HOSTED_PROJECT_REF`

The workflow reasserts `AGENT_WORK_LEDGER_RUNTIME_MODE=disabled` before deletion and again on every terminal path. It authorizes no Vault deletion, no database row deletion, no retention deletion, no customer data access, no scheduler mutation, no fixture cleanup, no provider/model calls, and no active mode.

## Live Evidence

- Owner-dispatched canary run `32281634841` passed exact-main, CI, owner, and review-route gates, then failed closed during read-only preflight because one or more fixed stale Edge names existed.
- Setup and measurement did not run.
- Disabled restoration passed.
- Creator-bound cleanup correctly refused deletion because the failed run did not create the stale names.
- Independent post-run hosted SQL proved `pg_cron=false`; Vault-name, queue, archive, Ledger, draft, ungranted-lock, and active-retention-policy counts were all zero.

## Required Sequence

1. Owner reviews and merges the dedicated WIN-275 cleanup PR after exact-head required CI passes.
2. The general prohibition on Codex merge or dispatch remains in force for all other solo-maintainer merge or dispatch actions. The only delegated browser dispatch exceptions are `.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml`, and `.github/workflows/provision-qa-personas.yaml`. After the owner personally inspects and merges the critical PR, the owner may explicitly authorize Codex in the current task to perform exactly one browser click dispatch through the owner's already-authenticated in-app GitHub browser session.
   Delegated browser dispatch allowlist (exactly four literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml`, `.github/workflows/provision-qa-personas.yaml`].
3. Cleanup authorization must bind the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. Hosted advisory canary authorization must bind the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. Recovery authorization must bind `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY` and `expected_pg_cron_oid=457927`. QA persona authorization must bind `.github/workflows/provision-qa-personas.yaml`, `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING`, the merged WIN-43 PR number, the exact current-main commit SHA, and the workflow's immutable inputs. Authorization is separate per workflow and requires fresh current-task owner authorization per workflow.
4. Codex must recheck main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs immediately before click. Each workflow must still revalidate immediately before hosted access.
5. The authorization is one-time, consumed on click, non-transferable, and non-reusable. It is revoked by any drift, missing evidence, navigation/session ambiguity, or failed run. Any rerun needs fresh authorization.
6. This exception is browser-only and forbids gh/CLI/API/token dispatch, secret viewing, self-authorization, active mode, gate weakening, and extension to any other workflow. Cleanup remains zero-residue only with no provider/model calls or retention deletion. The canary remains temporary advisory only, restores disabled first on every terminal path, forbids provider/model calls and retention deletion, and must also end with zero residue. Active mode remains forbidden.
7. Script runs a read-only hosted baseline and stops on any database, Vault, queue, Ledger, draft, lock, retention, or `pg_cron` drift.
8. Script lists name/digest metadata only, reasserts disabled, deletes only present approved fixed names, and relists.
9. Script proves all three fixed names absent, runtime-mode name present, unrelated name/digest metadata unchanged, and hosted baseline still clean.
10. Workflow reasserts disabled and uploads a sanitized booleans/counts/timings artifact.
11. Only after successful cleanup and zero-residue proof may the owner separately redispatch the unchanged hosted advisory canary.

## Critical Lane

- classification: `high-risk human-reviewed`
- lane: `critical`
- Linear: `WIN-275`
- no Codex merge
- general prohibition remains for all other solo-maintainer dispatch actions
  - Codex may perform exactly one browser click dispatch only for a path in the exact four-entry allowlist, with separate explicit current-task owner authorization per workflow
  - The recovery workflow additionally requires `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY` and immutable `expected_pg_cron_oid=457927`; it is a separate current-task authorization.
- no hosted mutation occurs from the PR itself
- solo-maintainer owner acknowledgement: `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`

## Verification Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: CI/workflow/policy and protected hosted-secret cleanup
- Required checks: `npm ci`; direct cleanup contract; workflow YAML parse; script syntax; protected Git-blob hash proof; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run build`; `npm run test:routes:tier0`; exact-head GitHub CI
- Executed checks: `npm ci` pass; cleanup and action-runtime contracts pass (`13/13`); YAML parse pass; `node --check` pass; all seven protected Git-index hashes pass; policy pass; lint pass; typecheck pass; coverage pass (`92.96%` lines); build pass; Tier-0 routes pass (`244/244`)
- Blocked checks: local `npm run test:ci` is not green because unchanged `tests/scripts/provision-ci-smoke-bcba.test.ts` performs an LF-only source substring check against a CRLF Windows checkout; the same exact-main SHA has passing Ubuntu CI run `32279227956`. Exact-head GitHub CI remains required and pending until the PR is opened.
- Result: `pass-with-blocked-checks`
- Residual risk: name-based Supabase Management API deletion remains owner-dispatched and can run only after merged-current-main, live solo-maintainer topology, required CI, hash manifest, clean baseline, disabled mode, and clean checkout all revalidate.

## PR Hygiene

- `pr-ready`: yes, subject to exact-head CI and owner review
- `branch-ready`: yes, dedicated `codex/win-275-stale-edge-secret-cleanup`
- `linear-ready`: yes, `WIN-275`
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none
- `protected-path drift`: intentional `.github/workflows/**` critical-lane change only
- `change summary`: present
- `verification summary`: present above
- `reviewer`: five required specialist roles recorded in the hash-bound manifest
- `required follow-up`: push, open PR, pass exact-head CI, owner review and merge, then only if the owner explicitly authorizes it in the current task, perform one browser-only click dispatch for `.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`; any later `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml` dispatch needs its own fresh current-task owner authorization and exact canary acknowledgement; otherwise the owner dispatches manually
