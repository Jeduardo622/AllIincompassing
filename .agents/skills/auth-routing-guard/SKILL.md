---
name: auth-routing-guard
description: Guard auth, routing, and session-sensitive changes in this repository. Use when work touches route guards, redirects, role handling, session lifecycle, login or logout flows, protected navigation, `src/lib/auth*`, `src/App.tsx`, `src/main.tsx`, or runtime-config-adjacent auth behavior.
---

# Auth Routing Guard

## Overview

Use this skill after `route-task` when the task affects auth or routing behavior. Keep changes aligned with the repo's protected-path rules, browser-gate expectations, and role-boundary review requirements.

Sources of truth:
- `AGENTS.md`
- `docs/ai/verification-matrix.md`
- `docs/ai/high-risk-paths.md`
- `.agents/skills/route-task/SKILL.md`
- `.agents/skills/verify-change/SKILL.md`

## Trigger Conditions

Use this skill when any of the following are true:
- files include `src/lib/auth*`, `src/App.tsx`, or `src/main.tsx`
- the task changes redirects, route guards, login or logout behavior, session restore, password recovery, role-based navigation, or protected route rendering
- the task is not limited to static UI and can change who sees what or when navigation is allowed

If the task also touches another protected path, follow the highest-risk classification and keep human review mandatory.

## Workflow

1. Confirm the task classification from `route-task`.
2. Identify the auth or routing boundary being changed:
   - sign-in, sign-out, password reset, or session bootstrap
   - route guard and redirect logic
   - role or tenant-aware navigation
   - runtime config consumed before auth-sensitive render
3. Inspect the current implementation before proposing changes. Follow existing patterns rather than adding new abstractions.
4. State the intended before and after behavior in access-control terms:
   - who should gain access
   - who should stay blocked
   - which route should render, redirect, or fail closed
5. Check for regression hotspots:
   - unauthenticated access to protected routes
   - stale session restore or broken logout
   - broadened role access
   - redirect loops or blank-screen startup failures
   - route changes that bypass tenant or org context
6. For non-trivial work, use:
   - `tester` for reproduction and verification planning
   - `reviewer` for auth, routing, and security review
7. Before finalizing, run `verify-change` and report the required auth or routing verification set.

## Minimum Verification Expectations

Auth, routing, and runtime-config-adjacent changes require:
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run test:routes:tier0`
- `npm run build`
- `npm run ci:playwright`

If `npm run ci:playwright` cannot run locally because secrets are unavailable, say so explicitly and leave it as a required CI gate.

## Output Requirements

Report:
- the auth or routing boundary being changed
- the expected access behavior before and after
- the regression hotspots reviewed
- required verification and any blocked checks
- whether `reviewer` was used or is still required
