# Agent Work Local Operator And Responsive Observer Design

## Objective

Add two repo-local engineering-loop capabilities without creating a new application authority surface:

1. `agent-work-local-operator` runs the existing fully containerized Agent Work Ledger proof as a fixed, local-only operator profile and verifies the exact required evidence before reporting success.
2. `responsive-ui-observer` makes deterministic desktop and mobile layout observation mandatory for visible UI changes.

The implementation is local-only, synthetic, PHI-free, and fail-closed. It does not add a generic Ledger caller, workflow intake, migration, Edge Function, RPC, runtime mode, hosted action, or provider call.

## Route And Scope

- `classification`: `high-risk human-reviewed`
- `lane`: `critical`
- Linear: `WIN-275`
- Triggering risk: local runner/sweeper orchestration, tenant-scoped synthetic proof, browser execution policy, credential handling, and mandatory verification-policy changes.

Allowed surfaces:

- new repo-local skills and agent descriptors
- new local operator and responsive observer scripts plus focused tests
- `package.json`
- engineering-loop, testing, Ledger runbook, verification, handoff, and supplemental review evidence

Non-goals:

- no `supabase/migrations/**` or `supabase/functions/**` changes
- no new queue, effect, approval, tenant, auth, or clinical authority
- no caller-selected workflow or organization
- no `.env*` reads, hosted URL fallback, browser session reuse, model/provider call, deploy, push, or PR
- no `active` runtime mode

Stop conditions:

- existing harness cannot prove exact fixed-workflow postconditions without a Supabase runtime change
- observer requires real credentials, hosted state, or non-synthetic data
- implementation needs a generic Ledger caller or broader CI/workflow edit

## Local Operator

`npm run agent-work:local:operator` is a thin fixed-profile wrapper around `test:agent-work:phase2`. It inherits the Phase 2 harness local URL, hosted-ref, credential, clean-state, bounded-wait, artifact, and cleanup guards.

Before invoking the heavy harness, the wrapper validates its own fixed contract. After the harness exits, it reads the generated manifest and requires the complete check set, including item creation/read, tenant security, runner/sweeper scheduling, chaos, shadow parity, authoritative local database checks, and cleanup audit. It rejects unknown arguments and any attempt to select a workflow, tenant, runtime mode, URL, or credential.

The operator remains an engineering harness. It never writes engineering prompts or tasks to the Ledger and never becomes an application caller.

## Responsive Observer

`npm run test:ui:responsive -- --base-url=http://127.0.0.1:<port> --route=/path` launches an ephemeral Playwright Chromium context for each explicit allowlisted route at exactly:

- desktop: `1440x900`
- mobile: `390x844`

The observer:

- reads only command arguments and process environment; it never imports the shared Playwright env loader
- requires an explicit loopback HTTP base URL and local relative routes
- aborts non-read methods and external-origin requests
- applies bounded navigation, settle, and capture timeouts
- records screenshots and sanitized layout metrics only
- fails on page errors, error-level console events, failed same-origin requests, horizontal overflow, clipped fixed controls, or undersized visible mobile interactive targets
- emits a deterministic JSON evidence card with route, viewport, checks, screenshot hash/path, result, and sanitized failure codes
- never records cookies, storage state, HAR, video, trace, response/request bodies, query strings, DOM text, emails, UUIDs, tokens, or credentials

Computer inspection may review already-generated local screenshots as a supplemental diagnostic step. It is never required for or authoritative over pass/fail.

## Mandatory Engineering Loop

Visible UI changes under `src/components/**`, `src/pages/**`, or shared styling/config must declare the affected routes and run the responsive observer at both fixed viewports. A UI verification card is incomplete without the command and evidence-card result. Failures return to implementation and must be re-observed before `verify-change` and `pr-hygiene`.

Auth/session or tenant-sensitive routes still require their existing protected browser gates. The observer supplements rather than replaces them.

## Verification

TDD covers argument rejection, local-only URL enforcement, absence of `.env` loading, request method/origin blocking, fixed viewport coverage, deterministic artifact names, sanitization, layout checks, operator manifest validation, and failure propagation.

Final local verification includes focused tests, both documented commands, policy checks, lint, typecheck, full tests, tenant validation, build, `verify:local`, exact-diff specialist review, `verify-change`, and `pr-hygiene`. The Phase 2 operator is run from committed HEAD because the existing harness intentionally rejects dirty protected inputs.
