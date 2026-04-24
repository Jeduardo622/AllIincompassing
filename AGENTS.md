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
   - human review remains mandatory for `critical`
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
  - invoke the matching repo-local skill when scope enters auth/routing, tenant-sensitive Supabase work, or Playwright-driven browser triage
  - `verify-change` before closing
  - `pr-hygiene` before final handoff
  - push the branch and create a PR for human review
- Use these repo-local skills when the matching work appears:
  - `auth-routing-guard` for auth, routing, session, or redirect changes
  - `supabase-tenant-safety` for migrations, functions, RLS, grants, RPC exposure, or tenant-boundary changes
  - `playwright-regression-triage` for browser-only or route-level reproduction and evidence capture

When the required checks do not need secrets or protected external systems, run `npm run verify:local` before finalizing.

At minimum:

- UI-only changes: lint, typecheck, targeted tests, build
- Auth/routing/runtime-config changes: policy checks, lint, typecheck, test:ci, tier-0 browser gate, build
- Database or tenant-isolation changes: policy checks, test:ci, tenant validation, build

Required artifact for non-trivial code/config work:

- verification card from `verify-change` containing lane, required checks, executed checks, blocked checks, result, and residual risk
- PR hygiene verdict from `pr-hygiene` with `pr-ready` decision

## Subagent Use

For non-trivial tasks:

- Use `tester` for targeted test selection, reproduction, and verification.
- Use `reviewer` for auth, security, CI-policy, and high-risk diff review.

Subagent findings must reference specific files, diffs, or commands when possible.

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
- If the user points to `.env` or `.env.local` for a token, do **not** read those files unless they explicitly request it; explain that the MCP or CLI process must receive credentials via a supported **environment** path for that process, not by assuming the file is loaded automatically.
- The user frequently requires strict final-output contracts (`Return exactly` + named fields); when a response schema is specified, follow it literally and preserve field order/labels.

## Learned Workspace Facts

- **MCP processes** only see environment variables the IDE/OS (or server config) provides; project `.env` / `.env.local` is not automatically injected into MCP server processes unless your setup explicitly loads it for those tools.
- For **admin, scheduling, and RLS-related behavior**, treat **`user_roles` (and related RPCs / helpers) as the source of truth** for “what role does this user have in the org?”, not **`profiles.role` alone** when both exist—keep junction and profile in sync in privileged code paths.
