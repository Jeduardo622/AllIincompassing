import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260801101500_agent_trace_report_selector_indexes.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const migrationSql = migration.replace(/--.*$/gm, "");
const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const contractPath = path.join(
  process.cwd(),
  "scripts",
  "agent-work-ledger-trace-index-contract.mjs",
);
const contract = existsSync(contractPath)
  ? readFileSync(contractPath, "utf8")
  : "";

describe("agent trace report selector indexes", () => {
  it("indexes tenant-bound request and correlation selectors", () => {
    expect(migration).not.toContain("agent_execution_traces_org_request_created_idx");
    expect(migration).not.toContain("agent_execution_traces_org_correlation_created_idx");
    expect(migration).toMatch(
      /scheduling_orchestration_runs_org_request_created_idx[\s\S]*?scheduling_orchestration_runs\s*\(organization_id,\s*request_id,\s*created_at\)/i,
    );
    expect(migration).toMatch(
      /scheduling_orchestration_runs_org_correlation_created_idx[\s\S]*?scheduling_orchestration_runs\s*\(organization_id,\s*correlation_id,\s*created_at\)/i,
    );
    expect(migration).not.toContain("session_audit_logs_org_created_idx");
  });

  it("indexes every JSONB containment selector with jsonb_path_ops", () => {
    const expected = [
      ["agent_execution_traces_payload_gin_idx", "agent_execution_traces", "payload"],
      ["agent_execution_traces_replay_payload_gin_idx", "agent_execution_traces", "replay_payload"],
      ["scheduling_orchestration_runs_inputs_gin_idx", "scheduling_orchestration_runs", "inputs"],
      ["session_audit_logs_event_payload_gin_idx", "session_audit_logs", "event_payload"],
    ];

    for (const [indexName, tableName, columnName] of expected) {
      expect(migration).toMatch(
        new RegExp(
          `${indexName}[\\s\\S]*?${tableName}\\s+using\\s+gin\\s*\\(${columnName}\\s+jsonb_path_ops\\)`,
          "i",
        ),
      );
    }
  });

  it("is additive and does not alter data authority", () => {
    const indexStatements = migrationSql.match(/create\s+index[\s\S]*?;/gi) ?? [];
    expect(indexStatements).toHaveLength(6);
    expect(migrationSql).not.toMatch(/\b(?:alter|create|drop)\s+(?:table|policy|function)\b/i);
    expect(migrationSql).not.toMatch(/\b(?:grant|revoke|insert|update|delete|truncate)\b/i);
  });

  it("provides a rollback-only local query-plan contract", () => {
    expect(packageJson.scripts?.["agent-work:trace-index-contract"]).toBe(
      "tsx scripts/agent-work-ledger-local-env.ts run -- node scripts/agent-work-ledger-trace-index-contract.mjs",
    );
    expect(contract).toContain("assertLocalPostgresUrl");
    expect(contract).toContain("ROLLBACK");
    expect(contract).toContain("generate_series(1, 20000)");
    expect(contract).toContain("EXPLAIN (ANALYZE, FORMAT JSON");
    expect(contract).toContain("agent_execution_traces_payload_gin_idx");
    expect(contract).toContain("agent_execution_traces_replay_payload_gin_idx");
    expect(contract).toContain("agent_execution_traces_request_id_idx");
    expect(contract).toContain("agent_execution_traces_correlation_id_idx");
    expect(contract).toContain("scheduling_orchestration_runs_inputs_gin_idx");
    expect(contract).toContain("session_audit_logs_event_payload_gin_idx");
    expect(contract).toContain('trace: { correlationId: "target-audit-correlation" }');
    expect(contract).toContain('{ agentOperationId: "target-audit-operation" }');
    expect(contract).toContain('trace: { agentOperationId: "target-nested-audit-operation" }');
    expect(contract).toContain("sanitizeFailure");
    expect(contract).toContain("database_contract_failed");
  });
});
