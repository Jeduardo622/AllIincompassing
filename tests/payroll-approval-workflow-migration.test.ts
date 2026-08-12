import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationName = "20260812122436_payroll_approval_workflow.sql";
const migrationPath = path.join(process.cwd(), "supabase", "migrations", migrationName);
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

describe("payroll approval workflow migration contract", () => {
  it("creates the generated migration file with the preserved governance header", () => {
    expect(migrationExists).toBe(true);
    expect(sql).toMatch(/@migration-intent:\s*payroll_approval_workflow/i);
    expect(sql).not.toMatch(/Write migration SQL here/i);
  });

  it("upgrades snapshots with immutable canonical bindings that include revisioned final results", () => {
    expect(sql).toMatch(/alter table public\.timesheet_snapshots[\s\S]*add column if not exists canonical_snapshot_hash text/i);
    expect(sql).toMatch(/canonical_snapshot_hash text[\s\S]*\^\[0-9a-f\]\{64\}\$/i);
    expect(sql).toMatch(/add column if not exists snapshot_version integer not null default 1/i);
    expect(sql).toMatch(/add column if not exists calculation_revision integer not null default 1/i);
    expect(sql).toMatch(/update public\.timesheet_snapshots[\s\S]*canonical_snapshot_hash/i);
    expect(sql).toMatch(/jsonb_build_object\([\s\S]*'calculationRevision'[\s\S]*'totals'[\s\S]*'canonicalPayload'/i);
    expect(sql).toMatch(/canonicalSnapshotHash/i);
  });

  it("creates append-only approval and blocker-resolution chains with repeated tenant keys", () => {
    expect(sql).toMatch(/create table(?: if not exists)? public\.timesheet_approvals/i);
    expect(sql).toMatch(/create table(?: if not exists)? public\.payroll_blocker_resolutions/i);
    expect(sql).toMatch(/previous_transition_id uuid/i);
    expect(sql).toMatch(/previous_resolution_id uuid/i);
    expect(sql).toMatch(/snapshot_hash text not null check \(snapshot_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(sql).toMatch(/payload_hash text not null check \(payload_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(sql).toMatch(/organization_id uuid not null/i);
    expect(sql).toMatch(/employment_profile_id uuid not null/i);
    expect(sql).toMatch(/pay_period_id uuid not null/i);
    expect(sql).toMatch(/occurred_at timestamptz not null/i);
    expect(sql).toMatch(/received_at timestamptz not null/i);
    expect(sql).toMatch(/attestation boolean/i);
    expect(sql).toMatch(/comment text/i);
    expect(sql).toMatch(/reason text/i);
    expect(sql).toMatch(/idempotency_key text not null/i);
    expect(sql).toMatch(/create trigger timesheet_approvals_append_only/i);
    expect(sql).toMatch(/create trigger payroll_blocker_resolutions_append_only/i);
  });

  it("defines the bounded transition graph, resolution authority, and current-state projections", () => {
    expect(sql).toMatch(/create or replace function app\.payroll_approval_transition_allowed/i);
    expect(sql).toMatch(/'submitted'[\s\S]*'manager_approved'[\s\S]*'returned'[\s\S]*'locked'[\s\S]*'reopened'[\s\S]*'approval_invalidated'/i);
    expect(sql).toMatch(/no row\/draft -> submitted|when p_previous_action is null and p_next_action = 'submitted'/i);
    expect(sql).toMatch(/create or replace view public\.timesheet_approval_current_states/i);
    expect(sql).toMatch(/create or replace view public\.payroll_blocker_resolution_current_states/i);
    expect(sql).toMatch(/time_correction_requests/i);
    expect(sql).toMatch(/session_attendance_correction_requests/i);
    expect(sql).toMatch(/timekeeping_exceptions/i);
    expect(sql).toMatch(/resolved'[\s\S]*reopened/i);
  });

  it("adds authenticated-only actor-bound approval and blocker-resolution rpc surfaces", () => {
    expect(sql).toMatch(/create or replace function public\.transition_timesheet_approval\(\s*p_payload jsonb,\s*p_idempotency_key text\s*\)/i);
    expect(sql).toMatch(/create or replace function public\.resolve_payroll_blocker\(\s*p_payload jsonb,\s*p_idempotency_key text\s*\)/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/IDEMPOTENCY_CONFLICT/i);
    expect(sql).toMatch(/insert into public\.payroll_mutation_receipts/i);
    expect(sql).toMatch(/insert into public\.payroll_audit_events/i);
    expect(sql).toMatch(/revoke all on function public\.transition_timesheet_approval\(jsonb, text\) from public, anon, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.transition_timesheet_approval\(jsonb, text\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.transition_timesheet_approval\(jsonb, text\) to authenticated,\s*service_role/i);
    expect(sql).toMatch(/revoke all on function public\.resolve_payroll_blocker\(jsonb, text\) from public, anon, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.resolve_payroll_blocker\(jsonb, text\) to authenticated/i);
  });

  it("fails closed on snapshot freshness, exact authority, unresolved blockers, and payload conflicts", () => {
    expect(sql).toMatch(/attestation.*true/i);
    expect(sql).toMatch(/current lockable snapshot/i);
    expect(sql).toMatch(/stale snapshot|snapshot is no longer current/i);
    expect(sql).toMatch(/manager_user_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/actor_user_id <> snapshot_row\.created_by|v_actor <> v_snapshot\.created_by/i);
    expect(sql).toMatch(/return comment is required|comment is required for return/i);
    expect(sql).toMatch(/reopen reason is required|reason is required for reopen/i);
    expect(sql).toMatch(/unresolved blocking issues|blocking issues remain unresolved/i);
    expect(sql).toMatch(/profile\/metadata authority denied|actor and organization are derived from auth context/i);
    expect(sql).toMatch(/payload-conflicting replay|IDEMPOTENCY_CONFLICT/i);
  });

  it("re-derives lock state from the latest approval transition instead of mutable pay period projections", () => {
    expect(sql).toMatch(/create or replace function app\.payroll_event_is_locked\(/i);
    expect(sql).toMatch(/from public\.timesheet_approvals/i);
    expect(sql).toMatch(/order by approval_row\.occurred_at desc,\s*approval_row\.received_at desc,\s*approval_row\.id desc/i);
    expect(sql).toMatch(/approval_row\.action = 'locked'/i);
    expect(sql).not.toMatch(/period_row\.locked_at is not null or period_row\.exported_at is not null/i);
  });

  it("forces RLS and closes direct dml while keeping minimum read access scoped by employee, exact manager, or explicit payroll grant", () => {
    for (const tableName of ["timesheet_approvals", "payroll_blocker_resolutions"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${tableName} enable row level security`, "i"));
      expect(sql).toMatch(new RegExp(`alter table public\\.${tableName} force row level security`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${tableName} from public, anon, authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${tableName} from service_role`, "i"));
      expect(sql).toMatch(new RegExp(`grant select on public\\.${tableName} to authenticated`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant insert on public\\.${tableName} to authenticated`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant update on public\\.${tableName} to authenticated`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant delete on public\\.${tableName} to authenticated`, "i"));
    }

    expect(sql).toMatch(/create policy timesheet_approvals_authenticated_select/i);
    expect(sql).toMatch(/create policy payroll_blocker_resolutions_authenticated_select/i);
    expect(sql).toMatch(/app\.current_user_can_read_payroll_employee\(organization_id,\s*employment_profile_id\)/i);
    expect(sql).toMatch(/employee_manager_assignments assignment_row/i);
    expect(sql).toMatch(/payroll\.lock_period/i);
    expect(sql).toMatch(/payroll\.reopen_period/i);
    expect(sql).toMatch(/payroll\.resolve_exceptions/i);
  });
});
