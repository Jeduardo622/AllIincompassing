# Agent Work Ledger Phase 2 Container Harness Plan

> Execution uses `superpowers:subagent-driven-development` and `superpowers:test-driven-development` in the existing isolated worktree.

**Goal:** Provide one reproducible local command that starts a fresh complete Supabase stack plus containerized app and Agent Work Ledger workers, runs the required integration matrix, emits sanitized evidence, and cleans every runtime resource.

## Route

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: local runtime configuration, Docker networking, privileged database access, Edge Function execution, queue/Cron/Vault state, and credential handling cross protected boundaries even though no hosted action is allowed
- triggering paths: new Docker/Compose assets; `scripts/agent-work-ledger-*.mjs`; `package.json`; local Supabase and function runtime boundaries
- required agents: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer`; also `devops-engineer`, `supabase-reviewer`, `performance-engineer`, and `documentation-engineer`
- reviewer required: yes
- verify-change required: yes
- linear required: yes, `WIN-271`

## Scope

Allowed surfaces:

- dedicated Dockerfile and Compose configuration for the harness
- new `scripts/agent-work-ledger-harness/**` orchestration, preflight, function-service, health, schema, cleanup, and evidence code
- narrow container-mode adapters in existing local Agent Work Ledger smoke scripts
- focused harness and adapter tests
- `package.json`, `.dockerignore`, `.gitignore`, this plan, the operations runbook, and the Agent Work Ledger handoff

Non-goals:

- no migration, RLS, grant, RPC, queue semantics, function authority, application feature, CI workflow, deployment, or hosted configuration changes
- no `.env*` reads or writes
- no hosted Supabase, GitHub, Netlify, browser connector, deployment connector, or model provider access
- no `active` runtime mode and no Task 16 work

Stop conditions:

- any need to weaken tenant/auth/JWT/runtime-policy gates
- any need to inherit unallowlisted host credentials or use a non-local URL
- any need to read real fixtures or preserve unsanitized output
- any expansion into migrations, hosted systems, or production runtime behavior

## Architecture

- A host Node controller performs only fail-closed preflight, local Supabase CLI lifecycle, fresh resets, Docker image/Compose lifecycle, sanitized evidence hashing, and unconditional cleanup.
- The image is built from a temporary `git archive HEAD` context so unrelated worktree drift, especially `deno.lock`, cannot enter the image.
- Supabase uses its complete CLI-managed Docker stack on a dedicated Docker network.
- Compose runs separate `app`, `agent-work-items`, `agent-work-runner`, `agent-work-sweeper`, and `harness` services on that network.
- The controller injects an allowlisted process environment only. Hosted project refs and remote-capable credentials fail preflight.
- Stateful checks receive a fresh local database reset. Existing deterministic synthetic seeds remain authoritative.
- Artifacts contain only check names, bounded durations, exit status, fixed reason codes, and SHA-256 hashes of sanitized output.
- Cleanup removes Compose services/volumes/orphans, scheduler jobs, fixed Vault secrets, queue messages through fresh-volume destruction, temp build context, function listeners, and the Supabase stack.

## Task P2.1: Container Safety Adapters

Use TDD to add a shared exact-host local-container validator and narrow container modes for Edge smoke and scheduler smoke. Preserve loopback defaults. Container mode must use dedicated function services, exact service DNS targets, advisory runner/sweeper mode, shadow item mode, bounded waits, and no `--no-verify-jwt` acceptance path.

Verification:

- focused adapter tests RED then GREEN
- existing local-env, Edge smoke, and scheduler tests
- existing host-run Edge and scheduler smokes remain green

## Task P2.2: One-Command Harness

Use TDD to add the host preflight/orchestrator, container check runner, Docker image, Compose topology, app/function health checks, schema/tenant/security checks, queue/scheduler/runner/sweeper smoke, chaos, shadow parity, retention, trace plans, eval, and relevant app/API checks.

Required controls:

- command: `npm run test:agent-work:phase2`
- complete local Supabase stack
- no default Compose `.env` loading
- process-only generated local values
- bounded child processes and readiness waits
- runtime modes limited to `shadow` and `advisory`
- fresh reset before destructive stateful checks
- sanitized PHI-free output and ignored per-run evidence directory
- finally-block cleanup on pass, failure, and interruption

Verification:

- focused harness tests RED then GREEN
- negative remote URL/project/token preflight tests
- static Compose/Docker/runtime-mode/no-`.env` contract
- one complete clean container run

## Task P2.3: Repeatability And Release Evidence

Run `npm run test:agent-work:phase2` twice as two independent cold lifecycles. Record command, start/end timing, exit status, manifest path, artifact hashes, cleanup proof, and no-residue inspection for both runs.

Then run:

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- focused harness tests
- `npm run validate:tenant`
- `npm run build`
- `git diff --check`
- normal pre-commit hook without bypass

Complete `verify-change`, specialist review, `pr-hygiene`, the handoff, and `WIN-271`. Stop before GitHub or hosted actions.
