---
name: playwright-regression-triage
description: Reproduce and summarize browser-only regressions in this repository. Use when a bug affects routes, auth or session flows, redirects, protected pages, browser-only rendering, or other failures that need Playwright evidence before implementation or review.
---

# Playwright Regression Triage

## Overview

Use this skill to turn a vague browser bug into a concrete reproduction, evidence set, and next-step summary. Prefer it when static inspection is insufficient and the issue depends on actual page behavior.

Sources of truth:
- `AGENTS.md`
- `docs/ai/verification-matrix.md`
- `.agents/skills/route-task/SKILL.md`
- `.agents/skills/verify-change/SKILL.md`

## Trigger Conditions

Use this skill when:
- the bug appears only in the browser or only during navigation
- a route, redirect, login, logout, or session restore flow needs reproduction
- a screenshot, console log, DOM snapshot, or network trace would materially reduce ambiguity
- the task likely needs `npm run test:routes:tier0`, `npm run ci:playwright`, or manual Playwright-driven evidence

## Tool Choice

Choose the smallest tool that can prove the problem:
- use the `playwright` skill for direct repro, route checks, screenshots, console output, and network capture
- use the `playwright-interactive` skill only when the flow needs repeated inspection, persistent state, or stepwise UI debugging
- do not start with broad end-to-end automation when a single route repro is enough

## Workflow

1. Define the failing user flow in one sentence.
2. Identify the narrowest repro path:
   - entry route
   - auth state needed
   - user role or tenant context needed
   - expected result
   - actual result
3. Capture only the evidence that reduces ambiguity:
   - screenshot for visual mismatch
   - DOM or accessibility snapshot for missing elements
   - console messages for client failures
   - network requests for route or API mismatches
4. When the repro crosses auth or protected-route boundaries, call that out and route follow-up work through `auth-routing-guard`.
5. When the repro suggests tenant, org-scope, or Supabase policy problems, route follow-up work through `supabase-tenant-safety`.
6. For non-trivial follow-up work, use `tester` for verification planning and `reviewer` when the failing surface is high risk.
7. End with a concise handoff summary that another agent can implement without re-running broad exploration.

## Output Requirements

Report:
- repro steps
- expected versus actual behavior
- artifacts captured
- likely boundary involved: route, auth, session, runtime config, or tenant scope
- recommended next skill or review path
