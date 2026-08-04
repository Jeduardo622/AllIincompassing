import pg from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertLocalPostgresUrl } from "./agent-work-ledger-harness/localRuntime.mjs";

const { Client } = pg;

const FIXTURE_COUNT = 20_000;
const EXPECTED_INDEXES = [
  "agent_execution_traces_request_id_idx",
  "agent_execution_traces_correlation_id_idx",
  "agent_execution_traces_payload_gin_idx",
  "agent_execution_traces_replay_payload_gin_idx",
  "scheduling_orchestration_runs_org_request_created_idx",
  "scheduling_orchestration_runs_org_correlation_created_idx",
  "scheduling_orchestration_runs_inputs_gin_idx",
  "session_audit_logs_event_payload_gin_idx",
];

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const sanitizeFailure = (error) => {
  const message = error instanceof Error ? error.message : "";
  const missingPlan = message.match(/^Query plan did not use ([a-z0-9_]+)\.$/);
  if (missingPlan && EXPECTED_INDEXES.includes(missingPlan[1])) {
    return `plan_missing:${missingPlan[1]}`;
  }
  if (message === "Trace selector index catalog is incomplete.") {
    return "index_catalog_incomplete";
  }
  if (message === "Synthetic local session fixture is missing.") {
    return "fixture_missing";
  }
  if (
    message === "SUPABASE_DB_URL is required." ||
    message === "SUPABASE_DB_URL must use an exact local Postgres endpoint."
  ) {
    return "local_preflight_failed";
  }
  return "database_contract_failed";
};

export const attachDatabaseErrorGuard = (database) => {
  let failure = null;
  database.on("error", () => {
    failure ??= new Error("database_client_failed");
  });
  return () => failure;
};

const explain = async (database, sql, values, expectedIndex) => {
  const { rows } = await database.query(
    `EXPLAIN (ANALYZE, FORMAT JSON, COSTS OFF, TIMING OFF, SUMMARY OFF) ${sql}`,
    values,
  );
  const plan = JSON.stringify(rows[0]?.["QUERY PLAN"] ?? null);
  assert(plan.includes(expectedIndex), `Query plan did not use ${expectedIndex}.`);
};

const main = async () => {
  const databaseUrl = requiredEnv("SUPABASE_DB_URL");
  assertLocalPostgresUrl(databaseUrl, "SUPABASE_DB_URL");

  const database = new Client({ connectionString: databaseUrl });
  const readDatabaseFailure = attachDatabaseErrorGuard(database);
  let connected = false;
  let transactionStarted = false;
  try {
    await database.connect();
    connected = true;
    const fixture = await database.query(
      `
        select sessions.id as session_id, sessions.organization_id
        from public.sessions
        where sessions.organization_id is not null
        order by sessions.id
        limit 1
      `,
    );
    const sessionId = fixture.rows[0]?.session_id;
    const organizationId = fixture.rows[0]?.organization_id;
    assert(sessionId && organizationId, "Synthetic local session fixture is missing.");

    const indexRows = await database.query(
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
        order by indexname
      `,
      [EXPECTED_INDEXES],
    );
    const actualIndexes = indexRows.rows.map((row) => row.indexname).sort();
    assert(
      JSON.stringify(actualIndexes) === JSON.stringify([...EXPECTED_INDEXES].sort()),
      "Trace selector index catalog is incomplete.",
    );

    await database.query("BEGIN");
    transactionStarted = true;
    await database.query("SET LOCAL statement_timeout = '30s'");
    await database.query("SET LOCAL synchronous_commit = off");
    await database.query(
      `
        insert into public.agent_execution_traces (
          request_id,
          correlation_id,
          organization_id,
          step_name,
          status,
          payload,
          replay_payload
        )
        select
          'synthetic-request-' || value,
          'synthetic-correlation-' || value,
          $1::uuid,
          'synthetic_step',
          'ok',
          jsonb_build_object(
            'agentOperationId',
            case when value = 20000 then 'target-operation' else 'synthetic-operation-' || value end
          ),
          jsonb_build_object(
            'agentOperationId',
            case when value = 19999 then 'target-replay-operation' else 'synthetic-replay-' || value end
          )
        from generate_series(1, 20000) as value
      `,
      [organizationId],
    );
    await database.query(
      `
        insert into public.scheduling_orchestration_runs (
          organization_id,
          request_id,
          correlation_id,
          workflow,
          status,
          inputs
        )
        select
          $1::uuid,
          'synthetic-request-' || value,
          'synthetic-correlation-' || value,
          'hold',
          'ok',
          jsonb_build_object(
            'agentOperationId',
            case when value = 20000 then 'target-operation' else 'synthetic-operation-' || value end
          )
        from generate_series(1, 20000) as value
      `,
      [organizationId],
    );
    await database.query(
      `
        insert into public.session_audit_logs (
          session_id,
          organization_id,
          event_type,
          event_payload
        )
        select
          $1::uuid,
          $2::uuid,
          'synthetic_event',
          case
            when value = 20000 then jsonb_build_object('trace', jsonb_build_object('requestId', 'target-request'))
            when value = 19999 then jsonb_build_object('trace', jsonb_build_object('correlationId', 'target-audit-correlation'))
            when value = 19998 then jsonb_build_object('agentOperationId', 'target-audit-operation')
            when value = 19997 then jsonb_build_object('trace', jsonb_build_object('agentOperationId', 'target-nested-audit-operation'))
            else jsonb_build_object('trace', jsonb_build_object('requestId', 'synthetic-request-' || value))
          end
        from generate_series(1, 20000) as value
      `,
      [sessionId, organizationId],
    );

    await database.query("ANALYZE public.agent_execution_traces");
    await database.query("ANALYZE public.scheduling_orchestration_runs");
    await database.query("ANALYZE public.session_audit_logs");

    const probes = [
      [
        "select id from public.agent_execution_traces where organization_id = $1 and request_id = $2 order by created_at limit 500",
        [organizationId, "synthetic-request-20000"],
        "agent_execution_traces_request_id_idx",
      ],
      [
        "select id from public.agent_execution_traces where organization_id = $1 and correlation_id = $2 order by created_at limit 500",
        [organizationId, "synthetic-correlation-20000"],
        "agent_execution_traces_correlation_id_idx",
      ],
      [
        "select id from public.agent_execution_traces where organization_id = $1 and payload @> $2::jsonb order by created_at limit 500",
        [organizationId, JSON.stringify({ agentOperationId: "target-operation" })],
        "agent_execution_traces_payload_gin_idx",
      ],
      [
        "select id from public.agent_execution_traces where organization_id = $1 and replay_payload @> $2::jsonb order by created_at limit 500",
        [organizationId, JSON.stringify({ agentOperationId: "target-replay-operation" })],
        "agent_execution_traces_replay_payload_gin_idx",
      ],
      [
        "select id from public.scheduling_orchestration_runs where organization_id = $1 and request_id = $2 order by created_at limit 500",
        [organizationId, "synthetic-request-20000"],
        "scheduling_orchestration_runs_org_request_created_idx",
      ],
      [
        "select id from public.scheduling_orchestration_runs where organization_id = $1 and correlation_id = $2 order by created_at limit 500",
        [organizationId, "synthetic-correlation-20000"],
        "scheduling_orchestration_runs_org_correlation_created_idx",
      ],
      [
        "select id from public.scheduling_orchestration_runs where organization_id = $1 and inputs @> $2::jsonb order by created_at limit 500",
        [organizationId, JSON.stringify({ agentOperationId: "target-operation" })],
        "scheduling_orchestration_runs_inputs_gin_idx",
      ],
      [
        "select id from public.session_audit_logs where organization_id = $1 and event_payload @> $2::jsonb order by created_at limit 500",
        [organizationId, JSON.stringify({ trace: { requestId: "target-request" } })],
        "session_audit_logs_event_payload_gin_idx",
      ],
      [
        "select id from public.session_audit_logs where organization_id = $1 and event_payload @> $2::jsonb order by created_at limit 500",
        [organizationId, JSON.stringify({ trace: { correlationId: "target-audit-correlation" } })],
        "session_audit_logs_event_payload_gin_idx",
      ],
      [
        "select id from public.session_audit_logs where organization_id = $1 and event_payload @> $2::jsonb order by created_at limit 500",
        [organizationId, JSON.stringify({ agentOperationId: "target-audit-operation" })],
        "session_audit_logs_event_payload_gin_idx",
      ],
      [
        "select id from public.session_audit_logs where organization_id = $1 and event_payload @> $2::jsonb order by created_at limit 500",
        [organizationId, JSON.stringify({ trace: { agentOperationId: "target-nested-audit-operation" } })],
        "session_audit_logs_event_payload_gin_idx",
      ],
    ];

    for (const [sql, values, expectedIndex] of probes) {
      await explain(database, sql, values, expectedIndex);
    }
    assert(!readDatabaseFailure(), "database_client_failed");

    console.log(JSON.stringify({
      success: true,
      fixtureCount: FIXTURE_COUNT,
      indexCount: EXPECTED_INDEXES.length,
      planCheckCount: probes.length,
      indexes: [...EXPECTED_INDEXES].sort(),
    }));
  } finally {
    if (transactionStarted) {
      await database.query("ROLLBACK").catch(() => undefined);
      await database.query("ANALYZE public.agent_execution_traces").catch(() => undefined);
      await database.query("ANALYZE public.scheduling_orchestration_runs").catch(() => undefined);
      await database.query("ANALYZE public.session_audit_logs").catch(() => undefined);
    }
    if (connected) await database.end().catch(() => undefined);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({ success: false, reasonCode: sanitizeFailure(error) }));
    process.exit(1);
  });
}
