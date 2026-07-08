# Codex Agent Alignment

This document explains the alignment between repo policy, Codex custom agents, repo-local skills, and platform connectors.

## Source-of-truth order

1. `AGENTS.md`
2. `docs/ai/cto-lane-contract.md`
3. `docs/ai/verification-matrix.md`
4. `docs/ai/high-risk-paths.md`
5. `.agents/skills/**`
6. `.codex/agents/**`
7. `.codex/rules/default.rules`

## Agent naming

`route-task` emits lane-contract agent names. Those names should exist under `.codex/agents/*.toml`.

Compatibility aliases remain available:

- `reviewer` -> `code-review-engineer`
- `tester` -> `test-engineer`

Prefer the explicit lane-contract names in new prompts and handoffs.

## Platform specialists

Use these when stack boundaries are involved:

- `supabase-reviewer` for migrations, RLS, grants, RPC exposure, functions, and tenant-boundary work
- `netlify-deploy-reviewer` for build, deploy, redirect, function, environment, and production-safety work
- `security-engineer` for auth, tenant isolation, secrets, MCP/tooling, CI, or deploy security risk
- `devops-engineer` for CI and deploy workflow changes

## Skill alignment

Repo-local Codex skills are canonical under `.agents/skills/**`.

Core workflow spine:

1. `route-task`
2. scoped plan and specialist agents
3. implementation
4. `verify-change`
5. `pr-hygiene`
6. PR handoff

Domain skills:

- `auth-routing-guard`
- `supabase-tenant-safety`
- `playwright-regression-triage`
- `clinical-data-parity-auditor`

## MCP and secrets

- Keep tokens out of source control.
- Do not read or commit real `.env*` files unless the user explicitly asks for the current task.
- Codex MCP config belongs in `.codex/config.toml`.
- Supabase hosted MCP must be scoped to a dev or branch project and should be read-only by default.
- Netlify production deploys require explicit approval. `.codex/rules/default.rules` gates common CLI deploy prefixes, while MCP deploy tools remain subject to explicit operator approval and repo policy review before use.
