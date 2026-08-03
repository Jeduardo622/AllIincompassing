import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;

export const FIXED_JOB_NAMES = Object.freeze([
  "agent-work-runner-local",
  "agent-work-sweeper-local",
]);

export const FIXED_SECRET_NAMES = Object.freeze([
  "agent_work_local_service_role_key",
  "agent_work_local_runner_invocation_secret",
  "agent_work_local_sweeper_invocation_secret",
]);

export const CLEANUP_AUDIT_MUTATIONS = Object.freeze([
  {
    id: "disable_local_agent_work_queue_scheduler",
    sql: "select public.disable_local_agent_work_queue_scheduler()",
    params: [],
  },
  {
    id: "delete_fixed_vault_secrets",
    sql: "delete from vault.secrets where name = any($1::text[])",
    params: [FIXED_SECRET_NAMES],
  },
  {
    id: "clear_live_queue",
    sql: "delete from pgmq.q_agent_work_steps",
    params: [],
  },
  {
    id: "clear_archive_queue",
    sql: "delete from pgmq.a_agent_work_steps",
    params: [],
  },
]);

export const CLEANUP_AUDIT_PROTECTED_EXTENSIONS = Object.freeze([
  "pgmq",
  "pg_cron",
  "pg_net",
  "supabase_vault",
]);

export const CLEANUP_AUDIT_ASSERTIONS = Object.freeze([
  {
    id: "fixed_cron_jobs",
    sql: "select count(*)::integer as count from cron.job where jobname = any($1::text[])",
    params: [FIXED_JOB_NAMES],
  },
  {
    id: "fixed_vault_secrets",
    sql: "select count(*)::integer as count from vault.secrets where name = any($1::text[])",
    params: [FIXED_SECRET_NAMES],
  },
  {
    id: "live_queue_rows",
    sql: "select count(*)::integer as count from pgmq.q_agent_work_steps",
    params: [],
  },
  {
    id: "archive_queue_rows",
    sql: "select count(*)::integer as count from pgmq.a_agent_work_steps",
    params: [],
  },
  {
    id: "protected_extensions",
    sql: "select extname from pg_extension where extname = any($1::text[]) order by extname",
    params: [CLEANUP_AUDIT_PROTECTED_EXTENSIONS],
    expectedExtensions: CLEANUP_AUDIT_PROTECTED_EXTENSIONS,
  },
]);

export const assertPhase2CleanupDatabaseUrl = (value, env = process.env) => {
  if (env.AGENT_WORK_PHASE2_CONTAINER?.trim() !== "1") {
    throw new Error("cleanup_database_url_not_exact_phase2");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("cleanup_database_url_not_exact_phase2");
  }
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.hostname.toLowerCase() !== "supabase_db_alliincompassing" ||
    parsed.port !== "5432" ||
    parsed.username !== "postgres" ||
    parsed.password !== "postgres" ||
    parsed.pathname !== "/postgres" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("cleanup_database_url_not_exact_phase2");
  }
  return parsed;
};

export const runCleanupAudit = async ({
  connectionString,
  env = process.env,
  ClientImpl = Client,
}) => {
  assertPhase2CleanupDatabaseUrl(connectionString, env);
  const client = new ClientImpl({ connectionString });
  let transactionStarted = false;
  try {
    await client.connect();
    const { rows: ownerRows } = await client.query("select current_user");
    if (ownerRows[0]?.current_user !== "postgres") {
      throw new Error("cleanup_requires_postgres_owner");
    }

    await client.query("begin");
    transactionStarted = true;
    for (const mutation of CLEANUP_AUDIT_MUTATIONS) {
      await client.query(mutation.sql, mutation.params);
    }
    for (const assertion of CLEANUP_AUDIT_ASSERTIONS) {
      const { rows } = await client.query(assertion.sql, assertion.params);
      const passed = assertion.expectedExtensions
        ? assertion.expectedExtensions.every((extension) =>
          rows.some(({ extname }) => extname === extension)
        )
        : Number(rows[0]?.count) === 0;
      if (!passed) {
        throw new Error(`cleanup_assertion_${assertion.id}_failed`);
      }
    }
    await client.query("commit");
    transactionStarted = false;
    return {
      success: true,
      databaseUser: "postgres",
      mutationsApplied: CLEANUP_AUDIT_MUTATIONS.length,
      assertionsPassed: CLEANUP_AUDIT_ASSERTIONS.length,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the first fixed cleanup failure.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
};

const safeFailureCode = (error) => {
  const message = error instanceof Error ? error.message : "";
  return /^cleanup_[a-z0-9_]+$/.test(message)
    ? message
    : "cleanup_audit_failed";
};

const main = async () => {
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (!connectionString) throw new Error("cleanup_database_url_required");
  const summary = await runCleanupAudit({ connectionString });
  console.log(JSON.stringify(summary));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(safeFailureCode(error));
    process.exit(1);
  });
}
