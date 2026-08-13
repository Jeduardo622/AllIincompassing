import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationName =
  readdirSync(migrationsDir).find((name) => name.endsWith("payroll_export_ledger.sql")) ?? "";
const migrationPath = migrationName ? path.join(migrationsDir, migrationName) : "";
const migrationExists = migrationName !== "" && existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

const functionDefinition = (qualifiedName: string): string =>
  sql.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0] ?? "";

describe("payroll export ledger migration contract", () => {
  it("creates the generated payroll export ledger migration file with the preserved governance header", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_export_ledger/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("creates append-only export runs and rows with repeated organization composite foreign keys", () => {
    expect(sql).toMatch(/create table(?: if not exists)? public\.payroll_export_runs/i);
    expect(sql).toMatch(/create table(?: if not exists)? public\.payroll_export_rows/i);
    expect(sql).toMatch(/adjusts_export_run_id uuid/i);
    expect(sql).toMatch(/organization_id uuid not null/i);
    expect(sql).toMatch(/pay_period_id uuid not null/i);
    expect(sql).toMatch(/pay_group_id uuid not null/i);
    expect(sql).toMatch(/employment_profile_id uuid not null/i);
    expect(sql).toMatch(/snapshot_id uuid not null/i);
    expect(sql).toMatch(/canonical_hash text not null check \(canonical_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(sql).toMatch(/csv_sha256 text not null check \(csv_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(sql).toMatch(/csv_bytes bytea not null/i);
    expect(sql).toMatch(/foreign key \(pay_period_id,\s*organization_id\)[\s\S]*references public\.pay_periods\(id,\s*organization_id\)/i);
    expect(sql).toMatch(/foreign key \(pay_group_id,\s*organization_id\)[\s\S]*references public\.pay_groups\(id,\s*organization_id\)/i);
    expect(sql).toMatch(/foreign key \(employment_profile_id,\s*organization_id\)[\s\S]*references public\.employment_profiles\(id,\s*organization_id\)/i);
    expect(sql).toMatch(/foreign key \(snapshot_id,\s*organization_id,\s*employment_profile_id,\s*pay_period_id\)[\s\S]*references public\.timesheet_snapshots\(id,\s*organization_id,\s*employment_profile_id,\s*pay_period_id\)/i);
    expect(sql).toMatch(/foreign key \(export_run_id,\s*organization_id\)[\s\S]*references public\.payroll_export_runs\(id,\s*organization_id\)/i);
    expect(sql).toMatch(/foreign key \(adjusts_export_run_id,\s*organization_id\)[\s\S]*references public\.payroll_export_runs\(id,\s*organization_id\)/i);
    expect(sql).toMatch(/create trigger payroll_export_runs_append_only/i);
    expect(sql).toMatch(/create trigger payroll_export_rows_append_only/i);
  });

  it("forces RLS, closes direct mutations for authenticated and service_role, and keeps read access capability-bound", () => {
    for (const tableName of ["payroll_export_runs", "payroll_export_rows"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${tableName} enable row level security`, "i"));
      expect(sql).toMatch(new RegExp(`alter table public\\.${tableName} force row level security`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${tableName} from public, anon, authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${tableName} from service_role`, "i"));
      expect(sql).toMatch(new RegExp(`grant select on public\\.${tableName} to authenticated`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant insert on public\\.${tableName} to authenticated`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant update on public\\.${tableName} to authenticated`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant delete on public\\.${tableName} to authenticated`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant insert on public\\.${tableName} to service_role`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant update on public\\.${tableName} to service_role`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant delete on public\\.${tableName} to service_role`, "i"));
    }

    expect(sql).toMatch(/create policy payroll_export_runs_authenticated_select/i);
    expect(sql).toMatch(/create policy payroll_export_rows_authenticated_select/i);
    expect(sql).toMatch(/app\.current_user_is_payroll_admin\(organization_id\)/i);
    expect(sql).toMatch(/app\.payroll_actor_has_capability\(organization_id,\s*'payroll\.export_period'\)/i);
    expect(sql).not.toMatch(/app\.current_user_can_read_payroll_employee\(organization_id,\s*employment_profile_id\)/i);
  });

  it("defines authenticated-only create and get rpc surfaces that derive actor and org from auth context", () => {
    const createDefinition = functionDefinition("public.create_payroll_export");
    const getDefinition = functionDefinition("public.get_payroll_export");

    expect(sql).toMatch(/create or replace function public\.create_payroll_export\(\s*payload jsonb,\s*idempotency_key text\s*\)/i);
    expect(sql).toMatch(/create or replace function public\.get_payroll_export\(\s*run_id uuid\s*\)/i);
    expect(sql).toMatch(/revoke all on function public\.create_payroll_export\(jsonb,\s*text\) from public,\s*anon,\s*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.create_payroll_export\(jsonb,\s*text\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.create_payroll_export\(jsonb,\s*text\) to authenticated,\s*service_role/i);
    expect(sql).toMatch(/revoke all on function public\.get_payroll_export\(uuid\) from public,\s*anon,\s*service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_payroll_export\(uuid\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.get_payroll_export\(uuid\) to authenticated,\s*service_role/i);

    expect(createDefinition).toMatch(/security definer/i);
    expect(createDefinition).toMatch(/set search_path = ''/i);
    expect(createDefinition).toMatch(/auth\.uid\(\)/i);
    expect(createDefinition).toMatch(/app\.resolve_user_organization_id/i);
    expect(createDefinition).toMatch(/app\.jsonb_contains_authority_fields\(payload\)/i);
    expect(createDefinition).toMatch(/payload ->> 'adapterVersion'/i);
    expect(createDefinition).toMatch(/provider-neutral-v1/i);
    expect(createDefinition).toMatch(/jsonb_object_keys/i);
    expect(createDefinition).toMatch(/payroll\.export_period capability is required/i);
    expect(createDefinition).toMatch(/actor and organization are derived from auth context/i);
    expect(getDefinition).toMatch(/security definer/i);
    expect(getDefinition).toMatch(/set search_path = ''/i);
    expect(getDefinition).toMatch(/auth\.uid\(\)/i);
    expect(getDefinition).toMatch(/app\.resolve_user_organization_id/i);
    expect(getDefinition).toMatch(/payroll\.export_period capability is required/i);
  });

  it("pins canonical output and hash generation to SQL with pgcrypto digest, deterministic ordering, and safe identifier rejection", () => {
    const createDefinition = functionDefinition("public.create_payroll_export");

    expect(sql).toMatch(/create extension if not exists pgcrypto/i);
    expect(createDefinition).toMatch(/digest\(/i);
    expect(createDefinition).toMatch(/sha256/i);
    expect(createDefinition).toMatch(/schema_version,export_id,adjusts_export_id,organization_payroll_id,employee_payroll_id,pay_group_id,period_start,period_end,work_date,earning_code,hours,base_rate,applied_rate,gross_earnings,correction_indicator,snapshot_version,snapshot_hash/i);
    expect(createDefinition).toMatch(/order by[\s\S]*employee_payroll_id[\s\S]*work_date[\s\S]*earning_code/i);
    expect(sql).toMatch(/create or replace function app\.is_safe_payroll_export_identifier[\s\S]*btrim\(p_value\) !~ '\^\[=\+\\-@\]'/i);
    expect(createDefinition).toMatch(/[=+\-@]/i);
    expect(createDefinition).toMatch(/formula/i);
    expect(createDefinition).toMatch(/csv_bytes/i);
    expect(createDefinition).toMatch(/csv_sha256/i);
    expect(createDefinition).toMatch(/convert_to\(/i);
    expect(createDefinition).toMatch(/E'\\r\\n'/i);
    expect(sql).toMatch(/FM999999990\.000000/i);
    expect(sql).not.toMatch(/FM999999990\.0000(?!00)/i);
    expect(createDefinition).toMatch(/app\.payroll_export_applied_rate_text\(.*applied_rate_numerator.*applied_rate_denominator/i);
    expect(createDefinition).not.toMatch(/app\.payroll_export_applied_rate_text\(.*base_rate_cents.*\*.*applied_rate_numerator/i);
  });

  it("builds canonical rows from immutable snapshot lines, rejects export-time recomputation, and persists only emitted rows", () => {
    const createDefinition = functionDefinition("public.create_payroll_export");

    expect(createDefinition).toMatch(/timesheet_approval_current_states/i);
    expect(createDefinition).toMatch(/action = 'locked'/i);
    expect(createDefinition).toMatch(/timesheet_snapshot_current_heads/i);
    expect(createDefinition).toMatch(/timesheet_snapshot_lines/i);
    expect(createDefinition).toMatch(/line_type = 'segment'/i);
    expect(createDefinition).toMatch(/line_type = 'premium'/i);
    expect(createDefinition).toMatch(/line_payload ->> 'dayKey'/i);
    expect(createDefinition).toMatch(/line_payload ->> 'hourlyRateCents'/i);
    expect(createDefinition).toMatch(/line_payload ->> 'grossCents'/i);
    expect(createDefinition).toMatch(/line_payload ->> 'rateVersionId'/i);
    expect(createDefinition).toMatch(/deadlineAt/i);
    expect(createDefinition).toMatch(/employee_rate_versions/i);
    expect(createDefinition).not.toMatch(/pay_period\.ends_on as work_date/i);
    expect(createDefinition).not.toMatch(/effective_from <= v_exported_at/i);
    expect(createDefinition).not.toMatch(/validated\.base_rate_cents::numeric \* validated\.regular_seconds::numeric/i);
    expect(createDefinition).not.toMatch(/validated\.base_rate_cents::numeric \* 3::numeric \* validated\.overtime_seconds::numeric/i);
    expect(createDefinition).not.toMatch(/validated\.base_rate_cents::numeric \* 2::numeric \* validated\.double_time_seconds::numeric/i);
    expect(sql).toMatch(/correction_indicator text not null default 'N'/i);
    expect(createDefinition).toMatch(/'N'::text/i);
    expect(createDefinition).toMatch(/'Y'::text/i);
    expect(createDefinition).toMatch(/insert into public\.payroll_export_rows[\s\S]*from temp_payroll_export_render_rows/i);
    expect(createDefinition).toMatch(/prior_rows as[\s\S]*summed as[\s\S]*sum\(seconds\)::integer as seconds/i);
    expect(createDefinition).toMatch(/prior_rows as[\s\S]*summed as[\s\S]*sum\(gross_cents\)::integer as gross_cents/i);
    expect(createDefinition).toMatch(/immediately prior|previous_run|adjusts_export_run_id/i);
  });

  it("enforces locked assigned-population parity, unresolved blocker denial, same-hash replay, and cumulative delta adjustments", () => {
    const createDefinition = functionDefinition("public.create_payroll_export");

    expect(createDefinition).toMatch(/snapshot is no longer current|current locked snapshot set is required/i);
    expect(createDefinition).toMatch(/assigned active employment population|locked snapshot population|population/i);
    expect(createDefinition).toMatch(/app\.payroll_unresolved_blocker_count/i);
    expect(createDefinition).toMatch(/blocking issues remain unresolved|unresolved/i);
    expect(createDefinition).toMatch(/canonical_hash/i);
    expect(createDefinition).toMatch(/replayed/i);
    expect(createDefinition).toMatch(/adjusts_export_run_id/i);
    expect(createDefinition).toMatch(/delta/i);
  });

  it("persists reconciled totals and metadata, writes the audit event atomically, and updates pay_period exported_at only on first export", () => {
    const createDefinition = functionDefinition("public.create_payroll_export");
    const getDefinition = functionDefinition("public.get_payroll_export");

    expect(createDefinition).toMatch(/gross_earnings_cents|gross_cents/i);
    expect(createDefinition).toMatch(/meal_premium_cents/i);
    expect(createDefinition).toMatch(/adapterVersion/i);
    expect(createDefinition).toMatch(/sourceSnapshotCount/i);
    expect(createDefinition).toMatch(/reconciliationStatus/i);
    expect(createDefinition).toMatch(/reconciled/i);
    expect(createDefinition).toMatch(/exportedAt/i);
    expect(createDefinition).toMatch(/insert into public\.payroll_audit_events/i);
    expect(createDefinition).toMatch(/operation',\s*'create_payroll_export'|create_payroll_export/i);
    expect(createDefinition).toMatch(/insert into public\.payroll_mutation_receipts/i);
    expect(createDefinition).toMatch(/update public\.pay_periods[\s\S]*set exported_at/i);
    expect(createDefinition).toMatch(/and exported_at is null/i);
    expect(getDefinition).toMatch(/adapterVersion/i);
    expect(getDefinition).toMatch(/periodStart/i);
    expect(getDefinition).toMatch(/periodEnd/i);
    expect(getDefinition).toMatch(/csv/i);
    expect(getDefinition).not.toMatch(/sourceSnapshotCount|reconciliationStatus|totals|exportedAt/i);
  });

  it("repairs the payroll administration read model to expose canExportPeriod without changing canGeneratePeriods semantics", () => {
    const administrationDefinition = functionDefinition("public.get_payroll_administration");

    expect(administrationDefinition).toMatch(/create or replace function public\.get_payroll_administration\(\s*selected_local_date date\s*\)/i);
    expect(sql).toMatch(/alter function public\.get_payroll_administration\(date\)\s*rename to get_payroll_administration_without_export_capability/i);
    expect(administrationDefinition).toMatch(/v_result := public\.get_payroll_administration_without_export_capability\(selected_local_date\)/i);
    expect(administrationDefinition).toMatch(/v_can_export_period := app\.payroll_actor_has_capability\(v_actor_org,\s*'payroll\.export_period'\)/i);
    expect(administrationDefinition).toMatch(/\{capabilities,canExportPeriod\}/i);
    expect(administrationDefinition).toMatch(/latestExport/i);
    expect(administrationDefinition).toMatch(/order by run_row\.exported_at desc, run_row\.id desc/i);
    expect(administrationDefinition).toMatch(/payroll administration capability is required/i);
    expect(sql).toMatch(/revoke all on function public\.get_payroll_administration\(date\) from public, anon, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_payroll_administration\(date\) to authenticated/i);
  });
});
