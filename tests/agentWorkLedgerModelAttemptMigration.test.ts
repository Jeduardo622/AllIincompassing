import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260801090000_agent_work_ledger_core.sql",
  ),
  "utf8",
);

describe("agent work model attempt snapshot migration", () => {
  it("stores the complete pre-provider snapshot on the attempt", () => {
    const attempts = migration.match(
      /create table if not exists public\.agent_work_attempts[\s\S]*?\n\);/i,
    )?.[0] ?? "";

    expect(attempts).toMatch(/temperature\s+numeric/i);
    expect(attempts).toMatch(/model_request_schema_version\s+text/i);
    expect(attempts).toMatch(/agent_work_attempts_temperature_range/i);
  });

  it("snapshots only an exact running attempt through a service-role-only RPC", () => {
    const snapshotRpc = migration.match(
      /create or replace function public\.snapshot_agent_work_model_attempt\([^]*?\$\$;/i,
    )?.[0] ?? "";

    expect(snapshotRpc).toMatch(/security definer/i);
    expect(snapshotRpc).toMatch(/set search_path = ''/i);
    expect(snapshotRpc).toMatch(/app\.actor_can_manage_agent_work_row/i);
    expect(snapshotRpc).toMatch(/attempt\.organization_id\s*=\s*p_organization_id/i);
    expect(snapshotRpc).toMatch(/attempt\.client_id\s+is not distinct from\s+p_client_id/i);
    expect(snapshotRpc).toMatch(/attempt\.work_item_id\s*=\s*p_work_item_id/i);
    expect(snapshotRpc).toMatch(/attempt\.step_id\s*=\s*p_step_id/i);
    expect(snapshotRpc).toMatch(/attempt\.status\s*=\s*'running'/i);
    expect(snapshotRpc).toMatch(/item\.workflow_version\s*=\s*p_workflow_version/i);
    expect(snapshotRpc).toMatch(/for update/i);
    expect(snapshotRpc).toMatch(/Attempt snapshot mismatch/i);
    expect(snapshotRpc).toMatch(/blocker_codes text\[\]/i);
    expect(snapshotRpc).toMatch(/suggested_action_codes text\[\]/i);
    expect(snapshotRpc).toMatch(/evidence_source_ids uuid\[\]/i);
    expect(snapshotRpc).toMatch(/from public\.agent_work_evidence evidence/i);
    expect(snapshotRpc).toMatch(/evidence\.step_id\s*=\s*p_step_id/i);
    expect(snapshotRpc).toMatch(/No authoritative evidence sources/i);
    expect(snapshotRpc).toMatch(/Attempt already snapshotted/i);

    expect(migration).toMatch(
      /revoke all on function public\.snapshot_agent_work_model_attempt\([^;]+from public, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.snapshot_agent_work_model_attempt\([^;]+to service_role/i,
    );
  });

  it("keeps model-attempt metadata manager-only", () => {
    const attemptReadPolicy = migration.match(
      /create policy agent_work_attempts_org_read[\s\S]*?\);/i,
    )?.[0] ?? "";

    expect(attemptReadPolicy).toMatch(/current_user_can_manage_agent_work_row/i);
    expect(attemptReadPolicy).not.toMatch(/current_user_can_read_agent_work_row/i);
  });

  it("records model usage without transitioning the workflow step", () => {
    const resultRpc = migration.match(
      /create or replace function public\.record_agent_work_model_attempt_result\([^]*?\$\$;/i,
    )?.[0] ?? "";

    expect(resultRpc).toMatch(/security definer/i);
    expect(resultRpc).toMatch(/set search_path = ''/i);
    expect(resultRpc).toMatch(/update public\.agent_work_attempts/i);
    expect(resultRpc).not.toMatch(/update public\.agent_work_steps/i);
    expect(resultRpc).not.toMatch(/agent_work_recompute_item_status/i);
    expect(migration).toMatch(
      /revoke all on function public\.record_agent_work_model_attempt_result\([^;]+from public, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.record_agent_work_model_attempt_result\([^;]+to service_role/i,
    );
  });
});
