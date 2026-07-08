# Codex Alignment Pack

This pack aligns the uploaded Codex setup with the existing repo policy spine:

- `AGENTS.md`
- `docs/ai/cto-lane-contract.md`
- `docs/ai/verification-matrix.md`
- `.agents/skills/**`
- `.codex/agents/**`
- `.codex/rules/default.rules`

## Apply option A: patch

From the repository root:

```bash
git checkout -b codex/codex-agent-alignment
git apply codex_alignment.patch
```

## Apply option B: overlay copy

Copy the contents of `overlay/` into the repository root:

```bash
cp -R overlay/. .
```

Then review:

```bash
git status
git diff --stat
git diff -- AGENTS.md docs/ai/cto-lane-contract.md docs/ai/repo-tech-agents-skills-workflow-memo.md
```

## After applying

1. Merge `.gitignore.codex-alignment-snippet` into `.gitignore` if those patterns are not already present.
2. If you want hosted Supabase MCP, edit `.codex/config.toml`, uncomment the Supabase MCP block, and replace `YOUR_DEV_PROJECT_REF` with a dev or branch project ref.
3. Set `SUPABASE_ACCESS_TOKEN` in the shell/IDE environment, not in the repo.
4. Keep Netlify production deploys behind explicit approval. The included command rules gate common CLI deploy prefixes; MCP deploy tools still require operator review before use.

## Validation

The generated TOML and YAML files were syntax-checked. The patch was generated from the uploaded files and checked against a clean copy of those files.
