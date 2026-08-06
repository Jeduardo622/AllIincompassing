# Agent Work Local Operator And Responsive Observer Implementation Plan

> **Required skills:** `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, repo-local `route-task`, `supabase-tenant-safety`, `verify-change`, and `pr-hygiene`.

**Goal:** Add a fail-closed local Agent Work Ledger operator and make deterministic desktop/mobile UI observation a mandatory engineering-loop gate.

**Architecture:** The operator validates and invokes the existing Phase 2 container harness, then verifies its sanitized manifest. The observer is an isolated Playwright runner that accepts only an explicit loopback base URL and relative routes, uses fixed viewports, blocks mutation/external requests, and emits sanitized screenshot/layout evidence.

**Route:** `classification: high-risk human-reviewed`; `lane: critical`; issue `WIN-275`.

## Task 1: Contract Tests

**Files:**
- Create: `tests/agentWorkLedgerLocalOperator.test.ts`
- Create: `tests/responsiveUiObserver.test.ts`

1. Write failing tests for operator argument rejection and exact Phase 2 evidence requirements.
2. Write failing tests for loopback-only URLs, relative-route allowlisting, fixed viewports, read-only request policy, artifact sanitization, deterministic evidence, and layout failure classification.
3. Run the two focused tests and preserve RED evidence.

## Task 2: Local Operator

**Files:**
- Create: `scripts/agent-work-ledger-local-operator.mjs`
- Create: `.agents/skills/agent-work-local-operator/SKILL.md`
- Create: `.agents/skills/agent-work-local-operator/agents/openai.yaml`
- Create: `.codex/agents/agent-work-local-operator.toml`
- Modify: `package.json`

1. Implement a fixed no-argument wrapper over `runPhase2Harness`.
2. Validate the returned manifest contains every required check and clean teardown evidence.
3. Emit only machine-safe status/failure codes.
4. Run focused tests to GREEN and commit the operator slice.

## Task 3: Responsive UI Observer

**Files:**
- Create: `scripts/lib/responsive-ui-observer.ts`
- Create: `scripts/playwright-responsive-ui-observer.ts`
- Create: `.agents/skills/responsive-ui-observer/SKILL.md`
- Create: `.agents/skills/responsive-ui-observer/agents/openai.yaml`
- Create: `.codex/agents/responsive-ui-observer.toml`
- Modify: `package.json`

1. Implement pure validation, sanitization, and layout-classification helpers first.
2. Implement the Playwright CLI with explicit loopback URL and route arguments, fixed viewports, ephemeral contexts, read-only/external request blocking, bounded waits, and sanitized artifacts.
3. Add a deterministic synthetic local fixture in the focused test and prove both viewports plus expected failure cases.
4. Run focused tests to GREEN and commit the observer slice.

## Task 4: Mandatory Policy And Runbooks

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/ai/verification-matrix.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/ops/agent-work-ledger.md`
- Modify: `docs/ops/agent-work-ledger-caller-adoption.md`
- Modify: `docs/ai/handoffs/agent-work-ledger-adoption-contract.md`
- Create: supplemental `WIN-275` review/attestation evidence if protected hashes require it

1. Define the observer trigger for visible UI and shared-style changes and require explicit affected routes.
2. State that the operator is a local synthetic harness, not a Ledger caller or authority surface.
3. Document commands, outputs, cleanup, Computer’s non-gating role, and fail-closed conditions.
4. Update hash-bound evidence additively; do not rewrite predecessor attestations.

## Task 5: Verification And Review

1. Run focused operator and observer tests.
2. Run the responsive observer against its synthetic local fixture.
3. Commit protected harness inputs, then run `npm run agent-work:local:operator` from exact HEAD.
4. Run `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run build`, and `npm run verify:local`.
5. Run independent code, test, security, architecture, Supabase, documentation, DevOps, and performance reviews in parallel on the exact diff.
6. Record the `verify-change` card, `pr-hygiene` verdict, and `WIN-275` handoff/Linear evidence.
7. Create focused local commits without bypassing hooks. Stop before push, PR, deploy, or hosted action.
