# Migration Governance (Forward-Fix Strategy)

## Strategy
- No migration history rewrite.
- Use forward-fix corrective migrations to normalize state and resolve drift.
- Maintain an immutable baseline index at `docs/migrations/migration-baseline.txt`.

## Classification Model
- `canonical`: original intended migration for a capability.
- `duplicate/backfill`: duplicate intent or replayed migration lineage.
- `corrective`: explicit fix/hotfix/regrant/align cleanup migration.
- `legacy-only`: retained for historical replay/audit, not for new design intent.

## Required Header (for new migrations)
Each new `supabase/migrations/*.sql` file must include, near the top:
- `-- @migration-intent: <what this migration changes>`
- `-- @migration-dependencies: <migration ids or none>`
- `-- @migration-rollback: <rollback approach>`

Recommended creation command (auto-includes required headers):

```bash
npm run migration:new -- <descriptive_migration_name>
```

## CI Guardrails
- `scripts/ci/check-migration-governance.mjs` validates:
  - required metadata header on newly added migrations,
  - duplicate canonical token detection vs baseline.
- Duplicate detection policy:
  - if canonical token already exists in baseline, migration is rejected and must be renamed as an explicit forward-fix migration.

## Release Candidate Health
- Required per RC:
  - run migration governance check,
  - run database drift/security/performance checks,
  - publish a migration health summary with new canonical + corrective migrations listed.
