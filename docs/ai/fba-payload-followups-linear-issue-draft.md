## Linear Issue Draft: FBA Payload Follow-Ups

- Team: `Winningedgeai`
- Status: Blocked in-session for MCP write due required `title` argument not being passable from current tool bridge

### Suggested title

`Critical follow-up: harden FBA generate-program-goals payload rollout`

### Suggested description

Follow-up work for the production payload upgrade to `generate-program-goals` with staged-only safety intact.

Scope:
- Add explicit transitional cleanup guardrails for legacy UI fallback in `ProgramsGoalsTab`.
- Add DB-level non-breaking constraints for allowed `review_flags` vocabulary on staged draft tables.
- Expand failure-mode tests for rollback and missing program mapping.
- Extend edge-function tests for fallback schema compliance and validation coverage.
- Re-run full verification and PR hygiene checks.

Safety guarantees to preserve:
- AI generation remains staged draft only.
- No direct generation-path writes to live `programs` or `goals`.
- BCBA review/promotion gates remain authoritative.

Verification targets:
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- `npm run verify:local`

### Manual create step

Create this Linear issue manually in team `Winningedgeai` using the title and description above, then link the created issue key in PR handoff notes.
