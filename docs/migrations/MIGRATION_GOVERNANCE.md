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

## Parity reporting (raw vs actionable)

This repo compares **local migration filenames** (`supabase/migrations/<version>_*.sql`) to **`supabase_migrations.schema_migrations.version`** on the target database. Remote rows often use **different version strings** for the same logical change, so a large **raw** pending set is expected after long-running projects.

### Definitions (`scripts/report-migration-parity.mjs`)

| Field | Meaning |
|-------|--------|
| **`pendingVersions` (raw pending)** | Count of local migration **versions** with **no** matching row on the remote ledger. This is a **filename-vs-ledger gap**, not an automatic “apply these 92 files” queue. |
| **`actionablePendingVersions`** | Subset of raw pending **not** listed in **`config/migration-drift-manifest.json`**. Treat this as the **operational apply/triage queue** for that environment. |
| **Manifest-suppressed** | Versions in the drift manifest (bulk **`LEDGER_ONLY_DRIFT`** from triage inventory + human **`SUPERSEDED_DO_NOT_APPLY`** preserved on regen). Suppression **does not change** raw pending; it only clears **actionable** pending for parity reporting. |

### Drift manifest

- **Path:** `config/migration-drift-manifest.json`
- **Regenerate:** `node scripts/build-migration-drift-manifest.mjs` (reads `reports/migration-triage-inventory.json` when present; **preserves** existing **`SUPERSEDED_DO_NOT_APPLY`** rows from the current manifest; dedupes by **`version`**).
- **Purpose:** Human-reviewed **parity accounting** only. It is **not** a DDL allowlist and **not** permission to replay unsafe historical SQL on main.

### When actionable pending is zero

If **`actionablePendingVersions` is `0`**, the operational cleanup for that project is **complete**: there are **no** remaining manifest-visible items that should be treated as “must apply next” from this report. A non-zero **raw** pending count still reflects **reviewed non-actionable history** (ledger naming drift + suppressions), **not** an open bulk-apply backlog.

If the drift manifest is **missing or invalid** (`driftManifestWarning` in the report JSON), **`actionablePendingVersions` falls back to the full raw pending set** (no suppression). Fix or restore `config/migration-drift-manifest.json` before trusting actionable semantics; **`parityInterpretation.driftManifestLoaded`** reflects load success.

### Canonical apply path

Apply migrations only through the **normal Supabase / pipeline workflow** (e.g. CLI against the intended database, hosted promotion, or **`scripts/apply-remote-migrations.mjs`** when explicitly used for a controlled host). **Do not** use the parity report as a batch apply driver, run one-off DDL against shared environments without a matching repo migration, or rely on tools that insert **non-canonical** rows into `supabase_migrations.schema_migrations`.

### When triage changes, regenerate the manifest

If **`reports/migration-triage-inventory.json`** (or human **`SUPERSEDED_DO_NOT_APPLY`** decisions) change in a material way, run **`node scripts/build-migration-drift-manifest.mjs`** and **commit** the resulting **`config/migration-drift-manifest.json`** so **`actionablePendingVersions`** stays aligned with reviewed intent.

### Avoiding future drift (checklist)

- **No ad hoc shared DB changes:** do not apply SQL manually to shared/staging/production without an immediate repo follow-up (new forward-fix migration or an explicitly documented, reviewed exception path).
- **Canonical ledger writes only:** avoid workflows that record migrations under ad hoc version strings; keep applies on the **approved** Supabase / pipeline path so `schema_migrations` stays reconcilable with `supabase/migrations/*.sql`.
- **Manifest in sync:** when triage or suppression decisions change, follow **When triage changes, regenerate the manifest** above (single source for the command and paths).
- **Separate preview vs main signals:** local/preview replay succeeding does **not** replace hosted **ledger parity** checks; use the right script/CI gate for each environment.
- **Small reviewed slices:** prefer narrow migrations with governance headers over large catch-up dumps that are hard to review and easy to mis-apply.

### Runtime merge parity (`check-runtime-migration-parity`)

Merge-added migration checks (`scripts/ci/check-runtime-migration-parity.mjs`, `scripts/ci/runtime-migration-parity.mjs`) can treat a row as satisfied by **migration `name`** only when the hosted `schema_migrations.version` is **greater than or equal to** the repo filename version for that same `name`. If the hosted ledger recorded an **earlier** timestamp than the repo file for the same logical migration, CI may report the migration as missing even though the DDL already ran. The bounded fix is to **rename the repo migration file** so its version matches the hosted row (same SQL body), not to rewrite remote migration history.

**Example — `repair_client_session_notes_goal_ids_if_still_uuid`:** the repo filename is `20260416141755_repair_client_session_notes_goal_ids_if_still_uuid.sql`. A hosted row with the **same `name`** and a **newer** version (for example `20260418100000_...`) is **not** a merge-parity failure under the rule above; audit with `select version, name from supabase_migrations.schema_migrations where name = 'repair_client_session_notes_goal_ids_if_still_uuid'` (and confirm `client_session_notes_goal_ids_text_array` is present). Do **not** replay the repair body on environments where `goal_ids` is already `text[]`, and avoid ad hoc `schema_migrations` edits except through an explicitly approved Supabase repair workflow.

Changelog-style summary of the completed cleanup: [`RELEASE_NOTES.md`](../../RELEASE_NOTES.md#migration-ledger-parity-cleanup-operational-complete).

### Optional future work (out of scope for parity cleanup)

Aligning **every** local filename version with a ledger row (ledger “perfection”) is a **separate** initiative from actionable-queue cleanup and requires its own plan; it is **not** required for a healthy **`actionablePendingVersions === 0`** state.
