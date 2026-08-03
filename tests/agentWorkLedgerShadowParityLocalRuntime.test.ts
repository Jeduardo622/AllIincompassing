import { describe, expect, it, vi } from "vitest";

import { assertMatchesRunningLocalStack } from
  "../scripts/agent-work-ledger-shadow-parity.mjs";

const loopbackStatus = [
  'API_URL="http://127.0.0.1:54321"',
  'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
].join("\n");

const statusRunner = (stdout = loopbackStatus) => vi.fn(() => ({
  status: 0,
  stdout,
  stderr: "",
}));

describe("agent work ledger shadow parity local stack identity", () => {
  it("preserves exact loopback identity matching in host mode", () => {
    const spawnImpl = statusRunner();

    expect(() => assertMatchesRunningLocalStack(
      "http://127.0.0.1:54321",
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      { env: {}, spawnImpl },
    )).not.toThrow();
    expect(spawnImpl).toHaveBeenCalledOnce();
  });

  it("maps only the exact Compose endpoints without invoking the host CLI", () => {
    const spawnImpl = vi.fn(() => ({
      status: 1,
      stdout: "",
      stderr: "unavailable in the container",
    }));

    expect(() => assertMatchesRunningLocalStack(
      "http://SUPABASE_KONG_AllIincompassing:8000",
      "postgresql://postgres:postgres@SUPABASE_DB_AllIincompassing:5432/postgres",
      {
        env: {
          AGENT_WORK_PHASE2_CONTAINER: "1",
          AGENT_WORK_PHASE2_PROJECT_ID: "AllIincompassing",
        },
        spawnImpl,
      },
    )).not.toThrow();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      "http://kong:8000",
      "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/postgres",
    ],
    [
      "https://project.supabase.co",
      "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/postgres",
    ],
    [
      "http://172.18.0.2:8000",
      "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/postgres",
    ],
    [
      "http://supabase_kong_alliincompassing:8000",
      "postgresql://postgres:postgres@postgres:5432/postgres",
    ],
  ])("rejects non-exact container endpoint pair %#", (supabaseUrl, databaseUrl) => {
    expect(() => assertMatchesRunningLocalStack(
      supabaseUrl,
      databaseUrl,
      {
        env: {
          AGENT_WORK_PHASE2_CONTAINER: "1",
          AGENT_WORK_PHASE2_PROJECT_ID: "AllIincompassing",
        },
        spawnImpl: statusRunner(),
      },
    )).toThrow();
  });

  it("rejects a non-loopback status identity in host mode", () => {
    const nonLocalStatus = [
      'API_URL="https://project.supabase.co"',
      'DB_URL="postgresql://postgres:postgres@db.project.supabase.co:5432/postgres"',
    ].join("\n");

    expect(() => assertMatchesRunningLocalStack(
      "http://127.0.0.1:54321",
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      {
        env: {},
        spawnImpl: statusRunner(nonLocalStatus),
      },
    )).toThrow("local_stack_identity_mismatch");
  });

  it.each([
    {},
    { AGENT_WORK_PHASE2_PROJECT_ID: "alliincompassing" },
    { AGENT_WORK_PHASE2_PROJECT_ID: "OtherProject" },
  ])("rejects container identity without the exact fixed project mapping: %#", (extraEnv) => {
    expect(() => assertMatchesRunningLocalStack(
      "http://supabase_kong_alliincompassing:8000",
      "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/postgres",
      {
        env: {
          AGENT_WORK_PHASE2_CONTAINER: "1",
          ...extraEnv,
        },
        spawnImpl: statusRunner(),
      },
    )).toThrow("local_stack_identity_mismatch");
  });

  it("compares supplied container endpoints to the fixed project translation", () => {
    expect(() => assertMatchesRunningLocalStack(
      "http://supabase_kong_alliincompassing:8001",
      "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/postgres",
      {
        env: {
          AGENT_WORK_PHASE2_CONTAINER: "1",
          AGENT_WORK_PHASE2_PROJECT_ID: "AllIincompassing",
        },
        spawnImpl: statusRunner(),
      },
    )).toThrow("local_stack_identity_mismatch");
  });
});
