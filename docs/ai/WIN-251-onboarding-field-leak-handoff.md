# WIN-251 Onboarding Field-Leak Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: bounded client wizard render behavior and regression coverage.

## Scope

- task intent: prevent uncontrolled DOM input values from leaking between wizard steps.
- files touched: onboarding component, focused test, this handoff.
- single-purpose diff: yes

## Required Agents

- agents used: code review engineer, test engineer.
- reviewer: completed; approved.

## Verification Card

- executed checks:
  - regression before fix: failed with city value `Grace`.
  - `npm run ci:check-focused`: pass.
  - focused onboarding test after keyed remount: pass, 8 tests.
  - `npm run lint`: pass.
  - `npm run typecheck`: pass.
  - `npm run build`: pass.
- blocked checks: none.
- result: pass.
- residual risk: verify restored guardian values when navigating backward; regression now covers this behavior.

## PR Hygiene

- branch-ready: yes.
- linear-ready: blocked by expired Linear OAuth grant; issue `WIN-251` exists.
- protected-path drift: none.
- unrelated changes: none.
- generated artifact drift: none.
- verification summary: present.
- pr-ready: yes.

## Handoff Summary

The wizard now keys rendered step content by step number so React cannot reuse uncontrolled input nodes across semantically different fields. The regression reproduces the live guardian-to-address leak and confirms stored guardian values survive backward navigation.
