---
description: 
alwaysApply: true
---
# AGENTS.md

## Mission

This repository is an AI-assisted engineering lab for a React/Vite app with Supabase, Netlify, and policy-heavy CI. Optimize for the smallest practical end-to-end change that can be implemented, verified, reviewed, and merged safely. Prefer complete bounded fixes/features over artificially fragmented slices, while preserving auth, tenant isolation, and deployment safety.

## Working Style

- Inspect the relevant architecture before changing code.
- Prefer existing patterns over new abstractions.
- Keep diffs as small as practical while still completing the bounded end-to-end slice.
- For implementation work, create a new branch before changing code. Use the `codex/` prefix for Codex-created branches.
- Do not bypass tests, lint, typecheck, or policy checks.
- For non-trivial changes, summarize risk and verification before closing the task.
- After changes are complete, push the branch and create a PR for human review. Do not assume direct pushes to `main`.
- Use Linear for non-trivial work that should have reviewable execution history. At minimum, high-risk changes should map to a Linear issue before merge.
- Route non-trivial work using the lane contract in `docs/ai/cto-lane-contract.md` before implementation.
- For autonomous PR waiting, use bounded polling with explicit timeout; never allow indefinite hangs.

## Agent Work Ledger Boundary

- Linear, verification cards, and markdown handoffs remain the systems of record for software-engineering work. Do not write source code, issue text, prompts, review notes, or arbitrary engineering tasks into the Agent Work Ledger.
- The Agent Work Ledger is a tenant-scoped application workflow for the fixed IEHP assessment-preparation and CalOptima draft-review flows. It does not grant engineering agents a generic execution queue or a new authority surface.
- Application callers may use only the authenticated routes and fixed workflow contracts documented in `docs/ops/agent-work-ledger-caller-adoption.md`. The server derives organization, client, actor, graph, and policy authority; callers must not supply or infer them.
- Runtime modes are limited to `disabled`, `shadow`, and `advisory`. `active` is forbidden. Runtime-policy failure must fail closed, and model output remains advisory and non-authoritative.
- Any change to Ledger functions, migrations, runtime policy, tenant scope, RLS, grants, RPCs, queues, effects, approvals, or clinical draft staging is `critical`, requires `supabase-tenant-safety`, and remains human-reviewed.

## Autonomous Execution Contract

Tracking updates improve operational control, but they do not replace routing, verification, reviewer/tester scrutiny, or protected-path escalation.

### Core rule

Codex may operate autonomously only within the lane and scope allowed by a fresh `route-task` classification for the current slice.

Tracking updates never override lane rules.

### Lane policy

- `fast`: autonomous execution allowed for explicitly bounded low-risk slices.
- `standard`: conditional autonomy allowed only when the full autonomous workflow contract is satisfied.
- `critical`: no autonomy expansion. Human-reviewed flow remains required.
- `blocked`: no implementation until the ambiguity is resolved.

For a personal repository with one human maintainer, the human-reviewed requirement may use the `solo-maintainer owner-attested critical lane`. Independent-human approval remains the default. The exception is fail-closed and requires live proof of exactly one GitHub human maintainer with write-or-higher access, exact owner login and numeric account identity, a merged issue-linked PR at current `main`, passing exact-head required CI, independent code/security/test/domain agent reviews recorded in a hash-bound manifest, and an explicit owner acknowledgement in a separate dispatch action. If ownership is organizational, the census is incomplete, another eligible human exists, or any evidence drifts, the exception is unavailable.

### What counts as non-trivial

Treat a slice as non-trivial if any of the following are true:

- it changes more than one production file
- it changes any shared utility, hook, store, query, schema, or config
- it changes state or data-fetch behavior
- it requires `verify-change`
- it requires a PR
- it affects tests beyond a small local assertion update

### Minimum autonomous workflow contract

For any autonomous slice, Codex must:

1. Run fresh `route-task` for the exact slice and emit:

   - classification
   - lane
   - triggering paths / risk rationale
2. Define scope before coding:

   - allowed files or surfaces
   - non-goals
   - stop conditions for scope widening
3. Follow the required verification path from the verification matrix:

   - run the minimum required commands
   - use `verify-change` for non-trivial code/config work
   - say explicitly when a check is not meaningful locally or requires secrets/protected systems
4. Use the required specialist support:

   - `reviewer` for all non-trivial code/config work
   - `tester` for standard-lane implementation or when verification planning is non-obvious
   - security/perf/domain specialists when risk indicates
   - human review remains mandatory for `critical`; the narrowly defined solo-maintainer owner attestation above is the human decision when no independent human exists
5. Maintain PR hygiene for non-trivial work:

   - isolated branch
   - reviewable diff sized to the bounded end-to-end slice
   - accurate PR summary
   - live check status and merge blockers reported precisely
6. Maintain tracking artifacts for non-trivial work:

   - update Linear status / next action
   - update the markdown task or handoff artifact with scope, verification, blockers, and residual risk
7. Stop and escalate immediately when:

   - the lane changes or the slice touches protected paths
   - required checks fail outside allowed scope
   - policy ambiguity requires human judgment
   - safe containment is no longer possible

### Tracking requirements by lane

- `fast`
  - trivial docs/process-only slices: tracking updates optional
  - non-trivial fast slices: markdown update required; Linear recommended
- `standard`
  - Linear update required
  - markdown task/handoff update required
- `critical`
  - Linear update required
  - markdown task/handoff update required
  - human-reviewed workflow required
- `blocked`
  - tracking may be updated, but implementation may not begin

### Merge rule

Autonomous merge is allowed only when live branch protection and required checks allow it and no required human approval is missing.

If approval or protection rules require a human, Codex must stop at review-ready closure and report the exact blocker.

Codex must never merge through the solo-maintainer exception and must not dispatch through it except under the narrow delegated browser exceptions below. The repository owner must personally inspect and merge the PR, and any later protected dispatch remains a distinct action using the exact acknowledgement required by the workflow.

### Delegated Browser Dispatch Exceptions

The general prohibition above remains the default for all other solo-maintainer merge or dispatch actions.

Delegated browser dispatch allowlist (exactly four literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml`, `.github/workflows/provision-qa-personas.yaml`].

The only narrow exceptions are the four exact workflow paths in the allowlist above. After the owner personally inspects and merges the critical PR, the owner may explicitly authorize Codex in the current task to perform exactly one browser click dispatch through the owner's already-authenticated in-app GitHub browser session. Authorization is separate per workflow and requires fresh current-task owner authorization per workflow.

The cleanup authorization must bind the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. The canary authorization must bind the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. The recovery authorization must bind the exact workflow path, acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY`, merged WIN-275 PR number, exact current-main commit SHA, and `expected_pg_cron_oid`.

The QA persona authorization must bind `.github/workflows/provision-qa-personas.yaml`, the exact acknowledgement `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING`, the merged WIN-43 PR number, the exact current-main commit SHA, and the workflow's immutable inputs. It permits only the fixed eight-persona synthetic bootstrap and does not authorize secret viewing, active `PW_*` rotation, or any unrelated hosted mutation.

Codex must recheck main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs immediately before click. Each workflow must still revalidate immediately before hosted access.

The authorization is one-time, consumed on click, non-transferable, and non-reusable. It is revoked by any drift, missing evidence, navigation/session ambiguity, or failed run. Any rerun needs fresh authorization.

These exceptions are browser-only and solo-maintainer only. They do not permit gh/CLI/API/token dispatch, secret viewing, self-authorization, active mode, gate weakening, or extension to any other workflow. Cleanup and recovery remain zero-residue only with no provider/model calls or retention deletion. The canary remains temporary advisory only, restores disabled first on every terminal path, forbids provider/model calls and retention deletion, and must also end with zero residue. Active mode remains forbidden.

## Commands

- Install: `npm ci`
- Dev: `npm run dev`
- Test: `npm run test:ci`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Build: `npm run build`

Useful extras:

- Fast unit run: `npm test`
- Tier-0 browser gate: `npm run test:routes:tier0`
- Auth/session browser gate: `npm run ci:playwright`
- Responsive UI observer: `npm run test:ui:responsive -- --base-url=http://127.0.0.1:<port> --route=/affected-route`
- Policy checks: `npm run ci:check-focused`
- Coverage verification: `npm run ci:verify-coverage`
- Tenant isolation: `npm run validate:tenant`

## High-Risk Paths

Human review is required before merge for changes in:

- `supabase/migrations/**`
- `supabase/functions/**`
- `src/server/**`
- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

Also treat anything affecting billing, impersonation, guardian flows, RLS, grants, RPC exposure, tenant isolation, or secrets as high risk.

## Data And Secrets Rules

- Never modify secrets, deployment credentials, billing settings, or provider keys.
- Never read from or edit real `.env*` files unless explicitly asked.
- Do not copy real customer data, PHI, or operational artifacts into tests, docs, or commits.
- Prefer redacted or synthetic fixtures only.

See:

- `docs/ai/verification-matrix.md`
- `docs/ai/high-risk-paths.md`
- `docs/ai/cto-lane-contract.md`

## Verification

Use the minimum verification required for the change type. See `docs/ai/verification-matrix.md`.

Before finalizing any non-trivial code or config change, use the `verify-change` skill.

Repo-local skill layout:

- Codex repo-local skills live under `.agents/skills/**`.
- Cursor-only skills live under `.cursor/skills/**`.
- Do not add required Codex workflow skills under `agents/skills/**`; keep `.agents/skills/**` as the canonical Codex skill root.
- Use the repo-local workflow spine for non-trivial work:
  - create a new `codex/` branch before implementation work begins
  - create or confirm the matching Linear issue for non-trivial work; require one for high-risk work
  - `route-task` before implementation
  - ensure `route-task` emits both `classification` and `lane` (`fast`|`standard`|`critical`|`blocked`)
  - invoke the matching repo-local skill when scope enters auth/routing, tenant-sensitive Supabase work, Playwright-driven browser triage, or redacted clinical parity QA
  - `verify-change` before closing
  - `pr-hygiene` before final handoff
  - push the branch and create a PR for human review
- Use these repo-local skills when the matching work appears:
  - `auth-routing-guard` for auth, routing, session, or redirect changes
  - `supabase-tenant-safety` for migrations, functions, RLS, grants, RPC exposure, or tenant-boundary changes
  - `playwright-regression-triage` for browser-only or route-level reproduction and evidence capture
  - `clinical-data-parity-auditor` for redacted browser-only IEHP/FBA source-to-output parity QA; use only with redacted, synthetic, smoke, or test fixtures
  - `responsive-ui-observer` for every visible change under `src/components/**`, `src/pages/**`, or shared styling/config; declare each affected route and capture both required local viewports before `verify-change`
  - `agent-work-local-operator` only for the fixed synthetic local Ledger harness; it is verification tooling, not an application caller or engineering-task queue

For visible UI changes, deterministic responsive observation is mandatory. Run the repo-local observer against an explicit loopback URL and every affected route at desktop `1440x900` and mobile `390x844`. A UI verification card is incomplete without its sanitized evidence result. Computer inspection may review the generated local screenshots, but is supplemental and never determines pass/fail.

When the required checks do not need secrets or protected external systems, run `npm run verify:local` before finalizing.

At minimum:

- UI-only changes: lint, typecheck, targeted tests, build
- Auth/routing/runtime-config changes: policy checks, lint, typecheck, test:ci, tier-0 browser gate, build
- Database or tenant-isolation changes: policy checks, test:ci, tenant validation, build

Required artifact for non-trivial code/config work:

- verification card from `verify-change` containing lane, required checks, executed checks, blocked checks, result, and residual risk
- PR hygiene verdict from `pr-hygiene` with `pr-ready` decision

## Subagent Use

Codex custom agents live under `.codex/agents/**`. Use the lane-contract agent names when a task is routed through `route-task`; keep `reviewer` and `tester` as compatibility aliases for the older generic flow.

For non-trivial tasks:

- Use `specification-engineer` to confirm scope, acceptance criteria, non-goals, and stop conditions before implementation.
- Use `implementation-engineer` for the bounded implementation slice after routing is complete.
- Use `code-review-engineer` for focused review of correctness, regression risk, protected-path drift, and policy compliance. `reviewer` may satisfy this role when the generic reviewer path is requested.
- Use `test-engineer` for targeted test selection, reproduction, and verification planning. `tester` may satisfy this role when the generic tester path is requested.
- Use `software-architect` for critical-lane or cross-boundary design review.
- Use `security-engineer` for auth, secrets, tenant isolation, RLS, RPC exposure, MCP/tooling, or CI/deploy security risk.
- Use `performance-engineer` when query behavior, route startup, bundle boundaries, or runtime performance may be affected.
- Use `devops-engineer` or `netlify-deploy-reviewer` for Netlify, CI, build, redirect, function, environment, or deployment readiness work.
- Use `supabase-reviewer` for migrations, RLS, grants, RPC exposure, functions, and tenant-boundary work.
- Use `documentation-engineer` when behavior, process, runbook, or handoff documentation changes.

Subagent findings must reference specific files, diffs, commands, or policy docs when possible.

## Definition Of Done

A task is done only when:

1. Code is implemented.
2. Required verification has passed, or any unrun checks are explicitly called out.
3. Docs/comments are updated when behavior or process changes.
4. The result is pushed on a branch and a PR is ready for human review.
5. High-risk changes include a short risk summary.
6. High-risk changes are linked to a Linear issue, and non-trivial changes should be linked when practical.

## Learned User Preferences

- When the user asks to use Supabase from Cursor’s installed **plugin / MCP** stack, use the **Supabase plugin MCP** (read tool schemas first) for hosted work such as migration listing/apply and SQL checks on the linked project, instead of treating repo files as the only source of truth for what is applied remotely.
- If the user points to `.env` or `.env.local` for a token, do **not** read those files unless they explicitly request it; explain that the MCP or CLI process must receive credentials via a supported **environment** path for that process, not by assuming the file is loaded automatically. The same applies to API-key MCP plugins (e.g. Postman): configure the key in **Cursor’s MCP/plugin settings**; a full Cursor restart may be needed before a new key is picked up.
- The user frequently requires strict final-output contracts (`Return exactly` + named fields); when a response schema is specified, follow it literally and preserve field order/labels.

## Learned Workspace Facts

- **MCP processes** only see environment variables the IDE/OS (or server config) provides; project `.env` / `.env.local` is not automatically injected into MCP server processes unless your setup explicitly loads it for those tools.
- For **admin, scheduling, and RLS-related behavior**, treat **`user_roles` (and related RPCs / helpers) as the source of truth** for “what role does this user have in the org?”, not **`profiles.role` alone** when both exist—keep junction and profile in sync in privileged code paths.
- **Session capture** (`Save progress` / `POST /api/session-notes/upsert`): the **billing / authorization gate is relaxed by default** unless both **`VITE_SESSION_CAPTURE_RELAX_BILLING_GATE`** (client) and **`SESSION_CAPTURE_RELAX_BILLING_GATE`** (server) are the literal string **`false`**; keep those flags aligned when toggling strict mode. At least one **`authorizations`** row for the client is still required.
- **Schedule reschedule:** HTML5 **drag-and-drop is used whenever `(any-pointer: fine)` matches** (mouse, trackpad, or stylus), including hybrid touch laptops. **Long-press, then tap a slot**, is used only when there is **no** fine pointer (typical phones / finger-only tablets).
- Extra **git worktrees** (for example under **`.config/superpowers/worktrees/...`**) register as separate checkouts of the same repo; Cursor’s Source Control can list them as additional roots until **`git worktree remove`** (and clearing any stale multi-root workspace folders) tidies them up.
