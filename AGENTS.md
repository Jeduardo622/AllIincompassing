# AGENTS.md

## Mission

This repository is operated as an AI engineering lab. Codex should maximize autonomy while staying safe, test-driven, and reviewable.

## Working style

- Prefer small, reviewable pull requests.
- Never bypass tests, lint, or type checks.
- Explain tradeoffs when making architectural changes.
- Ask for clarification only when blocked by missing requirements or unsafe ambiguity.
- Prefer existing patterns in the codebase over inventing new abstractions.

## Commands

- Install: `<put your install command here>`
- Dev: `<put your dev command here>`
- Test: `<put your test command here>`
- Lint: `<put your lint command here>`
- Typecheck: `<put your typecheck command here>`
- Build: `<put your build command here>`

## Definition of done

A task is done only when:

1. Code is implemented.
2. Relevant tests pass.
3. Lint/typecheck/build pass if applicable.
4. Docs or comments are updated when behavior changes.
5. The result is ready for PR review.

## Guardrails

- Do not merge directly to main.
- Do not change secrets, deployment config, or billing-related settings.
- Do not remove tests to make CI pass.
- Flag risky migrations, auth changes, or data model changes before proceeding.

## Task execution

For non-trivial work:

1. Inspect the repo and summarize the relevant architecture.
2. Propose a short plan.
3. Implement in small steps.
4. Run verification.
5. Summarize what changed and any follow-up risks.
