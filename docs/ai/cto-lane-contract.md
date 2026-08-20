# CTO Lane Contract

This document defines the hard-gate workflow contract for non-trivial work in this repository.
Use it as the source of truth for:

- task routing (`route-task`)
- verification (`verify-change`)
- PR readiness (`pr-hygiene`)

When guidance conflicts, this file, `AGENTS.md`, and `docs/ai/verification-matrix.md` win.

## Execution sizing rule

Lane routing controls risk, not unnecessary task fragmentation.

Within an allowed lane, prefer the smallest practical end-to-end slice that can be implemented, verified, reviewed, and merged safely.

Do not split clearly related implementation work into multiple slices when one bounded change can complete the user-visible fix or feature without entering protected paths or widening blast radius.

A slice should be reduced only when:

- it would cross into protected paths
- verification requirements diverge materially
- safe containment is no longer clear
- policy ambiguity or human judgment is required

## Lane Definitions

Choose exactly one lane before implementation:

1. `fast`
2. `standard`
3. `critical`
4. `blocked` (no implementation until clarified)

## Lane Entry Criteria

### Agent Sequence: `fast`

Use when work is docs/process only, or a small low-risk UI/content adjustment that:

- does not touch high-risk paths from `AGENTS.md`
- does not change auth, routing, runtime config, server/API boundaries, tenant isolation, CI policy, or deploy routing

### Agent Sequence: `standard`

Use for non-trivial code or config work that is still outside high-risk paths.

Examples:

- component/page logic updates
- low-risk utility refactors
- non-sensitive test harness updates

### Agent Sequence: `critical`

Use immediately when any touched path or behavior is high-risk:

- `supabase/migrations/**`
- `supabase/functions/**`
- `src/server/**`
- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

Also treat any change affecting authz, org/tenant isolation, RLS, grants, RPC exposure, secrets, billing, or impersonation as `critical`.

### `blocked`

Use when scope is too unclear to route safely. No implementation may start in this state.

## Mandatory Agent Sequence

Agent names in this section are Codex custom-agent names expected under `.codex/agents/*.toml`. `reviewer` and `tester` remain compatibility aliases for `code-review-engineer` and `test-engineer` when older repo guidance requests the generic names.


### Verification: `fast`

For docs/process-only `fast` tasks, no subagent is required; the primary agent may satisfy scope confirmation and manual link/path verification.

For small code/config `fast` tasks, use:

- `specification-engineer` (lightweight scope confirmation)
- `implementation-engineer`
- `code-review-engineer`

### Verification: `standard`

- `specification-engineer`
- `implementation-engineer`
- `code-review-engineer`
- `test-engineer`

Add on demand:

- `security-engineer` for auth/input/secrets/external integration risk
- `performance-engineer` for latency/throughput or query-path impact

### Verification: `critical`

- `specification-engineer`
- `software-architect`
- `implementation-engineer`
- `code-review-engineer`
- `test-engineer`
- `security-engineer`

Add `performance-engineer` when query or runtime performance is part of the change.

### Solo-Maintainer Critical Review

Independent-human approval remains the default for `critical`. A user-owned repository may use the `solo-maintainer owner-attested critical lane` only when GitHub proves exactly one GitHub human maintainer with write-or-higher access and that account matches the repository owner and dispatch actor by login and numeric ID. The candidate must be a merged issue-linked PR at the immutable current `main`, its exact head must have successful required CI, and a committed SHA-256 manifest must record passing code, security, test, and applicable domain specialist reviews.

This is not autonomous approval. The owner must explicitly inspect and merge the candidate, then perform any protected dispatch separately with the workflow's exact solo acknowledgement. Organizational ownership, incomplete pagination or permissions, another eligible human, stale `main`, stale CI, missing agent evidence, or hash drift disables the exception and restores the independent-human requirement.

For WIN-275, the only delegated browser dispatch exceptions are `.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml` and `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`. The owner must personally inspect and merge before any authorization. The owner may then explicitly authorize Codex in the current task to perform exactly one browser click dispatch through the owner's already-authenticated in-app GitHub browser session.

Delegated browser dispatch allowlist (exactly two literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`].

The cleanup exception binds the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. The canary exception binds the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. Authorization is separate per workflow and requires fresh current-task owner authorization per workflow.

Codex must recheck main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs immediately before click, and each workflow must still revalidate immediately before hosted access.

The authorization is one-time, consumed on click, non-transferable, and non-reusable. It is revoked by any drift, missing evidence, navigation/session ambiguity, or failed run. Any rerun needs fresh authorization.

This delegated path is browser-only and preserves the general prohibition for all other solo-maintainer merge or dispatch actions. Codex cannot merge through this exception and still must never merge any critical PR on the owner's behalf. It forbids gh/CLI/API/token dispatch, secret viewing, self-authorization, active mode, gate weakening, and extension to any other workflow. Cleanup remains zero-residue only with no provider/model calls or retention deletion. The canary remains temporary advisory only, restores disabled first on every terminal path, forbids provider/model calls and retention deletion, and must also end with zero residue. Active mode remains forbidden.

## Mandatory Verification Commands

Run the union required by `docs/ai/verification-matrix.md`.

### `fast`

For docs/process-only `fast` work:

- verify links, commands, and file paths manually

For small code/config `fast` work:

- `npm run lint`
- `npm run typecheck`
- targeted tests when available, otherwise `npm test`
- `npm run build`

### `standard`

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run build`

Add route/auth browser checks when flows are affected:

- `npm run test:routes:tier0`
- `npm run ci:playwright`

### `critical`

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run build`

Add required domain gates:

- `npm run validate:tenant` for migrations/RLS/grants/RPC/tenant-scope changes
- `npm run test:routes:tier0` for route/auth/session-protected flow impact
- `npm run ci:playwright` for auth/session browser coverage

When required checks do not depend on protected systems/secrets, also run:

- `npm run verify:local`

## Hard Blockers

A task is blocked from completion when any item below is true:

- lane is missing or ambiguous
- touched paths are `critical` but task was not escalated
- required verification checks are missing without explicit blocked reason
- required reviewer pass is missing for non-trivial work
- `critical` work is not linked to a Linear issue
- PR hygiene output is missing or `pr-ready: no`

## PR Wait Policy (No Indefinite Hangs)

After opening a PR for autonomous work:

- move the Linear issue to `In Review` and post a "waiting on checks" note
- poll required checks every 3 minutes
- use a hard timeout of 45 minutes per PR

Outcomes:

- all required checks pass within timeout:
  - merge or mark ready to merge
  - move issue to `Done`
- any required check fails:
  - move issue to `In Progress`
  - post failing checks and next fix action
- checks still pending at timeout:
  - move issue to `Blocked`
  - label as waiting on checks/human approval
  - post exact next action and continue the queue

Never block the whole autonomous batch on one pending PR.

## Required Handoff Card

All non-trivial tasks must include this artifact:

- `classification`: `low-risk autonomous` | `high-risk human-reviewed` | `blocked pending clarification`
- `lane`: `fast` | `standard` | `critical` | `blocked`
- `files touched`: explicit files/globs
- `required agents`: exact sequence used
- `required checks`: exact command list
- `executed checks`: command -> pass/fail
- `blocked checks`: command -> reason (or `none`)
- `reviewer`: completed or blocked
- `residual risk`: short statement
- `pr handoff`: ready or missing prerequisites

Copy/paste template: `docs/ai/lane-handoff-template.md`

## Escalation Rules

- If scope expands into a `critical` path at any point, re-route immediately to `critical`.
- If classification cannot be justified with explicit files/behaviors, mark `blocked`.
- If checks fail, loop implementation -> review -> testing until blockers are closed.
