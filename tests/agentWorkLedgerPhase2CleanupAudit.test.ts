import { describe, expect, it } from "vitest";

import {
  CLEANUP_AUDIT_PROTECTED_EXTENSIONS,
  FIXED_JOB_NAMES,
  FIXED_SECRET_NAMES,
  runCleanupAudit,
} from "../scripts/agent-work-ledger-harness/cleanupAudit.mjs";

const createClient = ({
  currentUser = "postgres",
  installedExtensions = ["pg_cron", "pg_net", "pgmq", "supabase_vault"],
  residualCheck = "",
}: {
  currentUser?: string;
  installedExtensions?: string[];
  residualCheck?: string;
} = {}) => {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  class FakeClient {
    connectionString: string;
    constructor(options: { connectionString: string }) {
      this.connectionString = options.connectionString;
    }
    async connect() {
      calls.push({ text: "connect", params: [] });
    }
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      if (text === "select current_user") {
        return { rows: [{ current_user: currentUser }] };
      }
      if (text.includes("count(*)::integer as count")) {
        return {
          rows: [{ count: residualCheck && text.includes(residualCheck) ? 1 : 0 }],
        };
      }
      if (text.includes("from pg_extension")) {
        return { rows: installedExtensions.map((extname) => ({ extname })) };
      }
      return { rows: [], rowCount: 1 };
    }
    async end() {
      calls.push({ text: "end", params: [] });
    }
  }
  return { calls, ClientImpl: FakeClient };
};

describe("agent work ledger phase2 cleanup audit", () => {
  it("runs real owner cleanup and proves cron, Vault, live queue, and archive queue are empty", async () => {
    const { calls, ClientImpl } = createClient();
    const summary = await runCleanupAudit({
      connectionString:
        "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
      env: { AGENT_WORK_PHASE2_CONTAINER: "1" },
      ClientImpl,
    });

    expect(summary).toEqual({
      success: true,
      databaseUser: "postgres",
      mutationsApplied: 4,
      assertionsPassed: 5,
    });
    expect(calls.some(({ text }) =>
      text.includes("disable_local_agent_work_queue_scheduler")
    )).toBe(true);
    expect(calls.find(({ text }) =>
      text.includes("delete from vault.secrets")
    )?.params).toEqual([FIXED_SECRET_NAMES]);
    expect(calls.some(({ text }) =>
      text.includes("delete from pgmq.q_agent_work_steps")
    )).toBe(true);
    expect(calls.some(({ text }) =>
      text.includes("delete from pgmq.a_agent_work_steps")
    )).toBe(true);
    expect(calls.find(({ text }) =>
      text.includes("from cron.job")
    )?.params).toEqual([FIXED_JOB_NAMES]);
    expect(calls.find(({ text }) =>
      text.includes("from pg_extension")
    )).toEqual({
      text: expect.stringContaining("select extname"),
      params: [["pgmq", "pg_cron", "pg_net", "supabase_vault"]],
    });
    expect(calls.every(({ text }) => !/\b(?:drop|alter)\s+extension\b/i.test(text))).toBe(true);
  });

  it("fails closed and rolls back when supabase_vault is not installed", async () => {
    const { calls, ClientImpl } = createClient({
      installedExtensions: ["pg_cron", "pg_net", "pgmq"],
    });
    await expect(runCleanupAudit({
      connectionString:
        "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
      env: { AGENT_WORK_PHASE2_CONTAINER: "1" },
      ClientImpl,
    })).rejects.toThrow(/cleanup_assertion_protected_extensions_failed/);
    expect(calls.some(({ text }) => text === "rollback")).toBe(true);
  });

  it("fails closed and rolls back when any audited state remains", async () => {
    const { calls, ClientImpl } = createClient({
      residualCheck: "pgmq.a_agent_work_steps",
    });
    await expect(runCleanupAudit({
      connectionString:
        "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
      env: { AGENT_WORK_PHASE2_CONTAINER: "1" },
      ClientImpl,
    })).rejects.toThrow(/cleanup_assertion_archive_queue_rows_failed/);
    expect(calls.some(({ text }) => text === "rollback")).toBe(true);
    expect(calls.at(-1)?.text).toBe("end");
  });

  it("refuses cleanup unless the connection is owned by local postgres", async () => {
    const { ClientImpl } = createClient({ currentUser: "service_role" });
    await expect(runCleanupAudit({
      connectionString:
        "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
      env: { AGENT_WORK_PHASE2_CONTAINER: "1" },
      ClientImpl,
    })).rejects.toThrow(/cleanup_requires_postgres_owner/);
  });

  it("requires the literal container flag for destructive cleanup", async () => {
    const { ClientImpl } = createClient();
    await expect(runCleanupAudit({
      connectionString:
        "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
      env: { AGENT_WORK_PHASE2_CONTAINER: "true" },
      ClientImpl,
    })).rejects.toThrow(/cleanup_database_url_not_exact_phase2/);
  });

  it.each([
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "postgresql://postgres:postgres@localhost:54322/postgres",
    "postgresql://other:postgres@supabase_db_alliincompassing:5432/postgres",
    "postgresql://postgres:other@supabase_db_alliincompassing:5432/postgres",
    "postgresql://postgres:postgres@supabase_db_alliincompassing:5433/postgres",
    "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/other",
    "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/postgres?ssl=true",
    "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/postgres#fragment",
  ])("rejects every non-exact destructive cleanup DSN: %s", async (connectionString) => {
    const { ClientImpl } = createClient();
    await expect(runCleanupAudit({
      connectionString,
      env: { AGENT_WORK_PHASE2_CONTAINER: "1" },
      ClientImpl,
    })).rejects.toThrow(/cleanup_database_url_not_exact_phase2/);
  });

  it("protects the installed queue, cron, net, and Vault extensions", () => {
    expect(CLEANUP_AUDIT_PROTECTED_EXTENSIONS).toEqual([
      "pgmq",
      "pg_cron",
      "pg_net",
      "supabase_vault",
    ]);
  });
});
