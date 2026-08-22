# High-Risk Paths

This document explains why certain paths in this repository always require human review before merge. It complements [AGENTS.md](../../AGENTS.md), lane routing in [docs/ai/cto-lane-contract.md](./cto-lane-contract.md), and verification rules in [docs/ai/verification-matrix.md](./verification-matrix.md).

## Process Requirement Vs GitHub Enforcement

In this single-owner repository, "human review required before merge" is currently stronger as a repository process rule than as a GitHub-enforced gate.

Measured evidence:

- live branch protection on `main` still reports `required_approving_review_count=1`
- disposable docs-only probe PR [#311](https://github.com/Jeduardo622/AllIincompassing/pull/311) reached `mergeStateStatus: "CLEAN"` and `mergeable: "MERGEABLE"` with `latestReviews: []`

Treat protected-path review requirements in this document and `AGENTS.md` as mandatory operating policy, but do not claim that GitHub currently enforces non-author approval effectively for the repo owner.

Independent-human approval remains the default. Because this is a personal single-owner repository, a protected workflow may implement the `solo-maintainer owner-attested critical lane` only when live GitHub evidence proves exactly one GitHub human maintainer with write-or-higher access, the owner login and numeric account ID match the dispatcher, exact-head required CI passes, and hash-bound independent agent reviews pass. The owner must review and merge before a separate dispatch. Any second eligible human or incomplete authority evidence disables the exception.

The general prohibition on Codex merge or dispatch remains in force for all other solo-maintainer merge or dispatch actions. The only delegated owner-session dispatch exceptions are `.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml`, and `.github/workflows/provision-qa-personas.yaml`, and the owner must personally inspect and merge the critical PR before authorizing anything.

Delegated owner-session dispatch allowlist (exactly four literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml`, `.github/workflows/provision-qa-personas.yaml`].

If the owner explicitly authorizes Codex in the current task, that authorization permits exactly one dispatch submission through either an owner-authenticated GitHub UI controlled through Browser or Computer Use, including a GitHub Actions page opened from GitHub Desktop, or a purpose-built GitHub connector workflow-dispatch action when that exact capability is available and preserves the owner actor. Cleanup authorization must bind the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. Canary authorization must bind the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. Recovery authorization must bind the exact workflow path, acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY`, merged WIN-275 PR number, exact current-main commit SHA, and `expected_pg_cron_oid`. QA persona authorization must bind `.github/workflows/provision-qa-personas.yaml`, `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING`, the merged WIN-43 PR number, the exact current-main commit SHA, and the workflow's immutable inputs; it permits only the fixed eight-persona synthetic bootstrap and never secret viewing or active `PW_*` rotation. Authorization is separate per workflow and requires fresh current-task owner authorization per workflow.

Codex must recheck main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs immediately before dispatch submission. A connector is unavailable unless it exposes the exact submitted inputs, requires no credential or secret disclosure, and preserves the owner actor for workflow-side validation. Each workflow must still revalidate immediately before hosted access.

The authorization is one-time, consumed on dispatch submission, non-transferable, and non-reusable. It is revoked by any drift, missing evidence, navigation/session/tool ambiguity, or failed run, and any rerun needs fresh authorization.

These exceptions are owner-session-only. Codex cannot merge through them and still must never merge the critical PR on the owner's behalf. They permit only the owner-authenticated GitHub UI or purpose-built connector action above; direct gh/CLI/raw API/token dispatch, generic repository-write tools, secret viewing, self-authorization, active mode, gate weakening, and extension to any other workflow remain forbidden. Cleanup and recovery remain zero-residue only with no provider/model calls or retention deletion. The canary remains temporary advisory only, restores disabled first on every terminal path, forbids provider/model calls and retention deletion, and must also end with zero residue. Active mode remains forbidden.

## `supabase/migrations/**`

Why high risk:

- Changes here can alter schema, RLS, grants, RPCs, and performance characteristics across the whole system.
- A migration mistake can break tenant isolation, auth behavior, or production data access.

Minimum human review:

- Confirm schema, RLS, grant, and rollback impact.
- Confirm required verification includes policy checks, `npm run test:ci`, and `npm run validate:tenant`.

## `supabase/functions/**`

Why high risk:

- This is privileged backend code for auth, scheduling, onboarding, reporting, AI flows, and org-scoped access.
- Changes here can drift from app-side handlers or widen data exposure.

Minimum human review:

- Confirm auth, org-scope, and request/response behavior.
- Confirm whether tenant validation and browser/auth checks are also required.

## `src/server/**`

Why high risk:

- This directory contains app-side server handlers and transport logic for runtime config and API routes.
- Changes here affect the boundary between the SPA, Netlify handlers, and Supabase authority.

Minimum human review:

- Confirm route behavior, API boundary assumptions, and compatibility with edge/runtime ownership.
- Confirm required checks from the verification matrix for server/API work.

## `src/lib/auth*`

Why high risk:

- Auth, role resolution, guardian behavior, and session handling directly control who can access what.
- Regressions here can silently weaken role boundaries or break sign-in, sign-out, and protected routes.

Minimum human review:

- Confirm role and tenant access behavior did not broaden unexpectedly.
- Confirm auth/routing verification, including browser checks when applicable.

## `src/lib/runtimeConfig*`

Why high risk:

- Runtime config is loaded before app render and can fail the app closed at startup.
- Changes here affect how Supabase URLs, keys, and default organization context are injected.

Minimum human review:

- Confirm startup behavior in dev and deployed environments.
- Confirm runtime-config changes still follow auth/routing verification requirements.

## `scripts/ci/**`

Why high risk:

- These scripts enforce repository policy, coverage, migration governance, and architecture checks.
- A weak or incorrect change can make CI green while reducing real protections.

Minimum human review:

- Confirm the change preserves or tightens an existing protection.
- Validate the affected script directly, not only via aggregate commands.

## `.github/workflows/**`

Why high risk:

- Workflow files define the actual CI/CD gates, secret usage, and required checks.
- A small workflow change can bypass protections or make security checks conditional when they should fail hard.

Minimum human review:

- Confirm job ordering, required checks, and secret handling remain intentional.
- Validate the affected workflow directly and keep behavior aligned with `AGENTS.md`.

## `netlify.toml`

Why high risk:

- This file controls build behavior, redirect ordering, function routing, and security headers.
- Incorrect redirects can break `/api/*` endpoints or expose the SPA catch-all in front of server routes.

Minimum human review:

- Confirm redirect and header behavior explicitly.
- Confirm runtime-config and API routes still precede the SPA fallback.

## Review Rule

If a change touches any path above:

- require human review before merge, using independent approval by default or the fail-closed solo-maintainer owner-attested contract above when eligible
- route the task as `critical` lane in `route-task`
- use `reviewer` before finalizing
- use the `verify-change` skill to select the required checks
- run `npm run verify:local` when the required checks do not need secrets, then add any extra checks required by the verification matrix
- require Linear issue linkage before marking `pr-ready: yes`
