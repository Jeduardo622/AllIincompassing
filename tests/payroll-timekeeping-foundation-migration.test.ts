import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationName =
  "20260811190901_payroll_timekeeping_foundation.sql";
const migrationPath = path.join(migrationsDir, migrationName);
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

const requiredTables = [
  "employment_profiles",
  "payroll_organization_settings",
  "employee_rate_versions",
  "pay_groups",
  "pay_group_assignments",
  "pay_periods",
  "payroll_policy_versions",
  "payroll_capability_grants",
  "employee_manager_assignments",
  "payroll_mutation_receipts",
  "payroll_audit_events",
  "employee_time_events",
  "session_attendance_events",
  "time_correction_requests",
  "session_attendance_correction_requests",
  "timekeeping_exceptions",
  "payroll_retention_policies",
  "payroll_legal_holds",
] as const;

describe("payroll timekeeping foundation migration contract", () => {
  it("creates the payroll foundation migration file", () => {
    expect(migrationExists).toBe(true);
  });

  it("replaces the generated dependency placeholder and creates every protected table with forced RLS", () => {
    expect(sql).toMatch(
      /@migration-dependencies:\s*20260810222545_bt_closeout_legacy_therapist_compat\.sql/i,
    );

    for (const table of requiredTables) {
      expect(sql).toMatch(
        new RegExp(`create table(?: if not exists)? public\\.${table}`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table} force row level security`,
          "i",
        ),
      );
    }
  });

  it("hardens payroll functions, append-only protections, and least-privilege grants", () => {
    expect(sql).toMatch(/create or replace function app\.payroll_feature_enabled\(/i);
    expect(sql).toMatch(/create or replace function app\.payroll_actor_has_capability\(/i);
    expect(sql).toMatch(/create or replace function app\.reject_payroll_source_mutation\(/i);
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function public\.record_employee_time_event\([^)]*\) from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.request_session_attendance_correction\([^)]*\) from public, anon/i);
    expect(sql).toMatch(
      /revoke\s+insert\s*,\s*update\s*,\s*delete[\s\S]+employee_time_events[\s\S]+authenticated/i,
    );
    expect(sql).toMatch(
      /create trigger[\s\S]+before update or delete on public\.employee_time_events[\s\S]+app\.reject_payroll_source_mutation/i,
    );
    expect(sql).toMatch(
      /create trigger[\s\S]+before update or delete on public\.payroll_audit_events[\s\S]+app\.reject_payroll_source_mutation/i,
    );
  });

  it("encodes the v1 fail-closed feature gate, one-active-org employment boundary, and therapist composite tenant link", () => {
    expect(sql).toMatch(/insert into public\.feature_flags[\s\S]+payroll_timekeeping_v1/i);
    expect(sql).toMatch(/default_enabled[\s\S]+false/i);
    expect(sql).toMatch(
      /insert into public\.payroll_policy_versions[\s\S]+activation_status[\s\S]+'inactive'/i,
    );
    expect(sql).toMatch(
      /exclude using gist[\s\S]+user_id with =[\s\S]+daterange\(active_from, coalesce\(active_through \+ 1/i,
    );
    expect(sql).toMatch(
      /alter table public\.therapists[\s\S]+add constraint[\s\S]+unique\s*\(id,\s*organization_id\)/i,
    );
    expect(sql).toMatch(
      /foreign key \(therapist_id,\s*organization_id\)[\s\S]+references public\.therapists\(id,\s*organization_id\) on delete restrict/i,
    );
  });
});
