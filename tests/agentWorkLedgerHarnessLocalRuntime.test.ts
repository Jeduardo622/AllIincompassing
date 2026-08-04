import { describe, expect, it } from "vitest";

import {
  assertExactPhase2FunctionUrl,
  assertLocalPostgresUrl,
  assertLocalSupabaseHttpUrl,
  isPhase2ContainerMode,
} from "../scripts/agent-work-ledger-harness/localRuntime.mjs";
import { buildSyntheticPostgresUrl } from
  "./helpers/syntheticPostgresUrl";

describe("agent work ledger local runtime validator", () => {
  it("keeps host mode disabled unless the phase2 flag is exactly enabled", () => {
    expect(isPhase2ContainerMode({})).toBe(false);
    expect(isPhase2ContainerMode({ AGENT_WORK_PHASE2_CONTAINER: "0" })).toBe(false);
    expect(isPhase2ContainerMode({ AGENT_WORK_PHASE2_CONTAINER: "true" })).toBe(false);
    expect(isPhase2ContainerMode({ AGENT_WORK_PHASE2_CONTAINER: "1" })).toBe(true);
  });

  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
  ])("accepts loopback Supabase HTTP URLs in host mode: %s", (value) => {
    expect(() => assertLocalSupabaseHttpUrl(value, "SUPABASE_URL")).not.toThrow();
  });

  it("accepts only the exact Kong origin and Postgres URL in container mode", () => {
    const env = { AGENT_WORK_PHASE2_CONTAINER: "1" };
    expect(assertLocalSupabaseHttpUrl(
      "http://SUPABASE_KONG_AllIincompassing:8000",
      "SUPABASE_URL",
      env,
    ).origin).toBe("http://supabase_kong_alliincompassing:8000");
    expect(assertLocalPostgresUrl(
      "postgresql://postgres:postgres@SUPABASE_DB_AllIincompassing:5432/postgres",
      "SUPABASE_DB_URL",
      env,
    ).hostname.toLowerCase()).toBe("supabase_db_alliincompassing");
  });

  it.each([
    "http://agent-work-items:8000/agent-work-items",
    "http://agent-work-runner:8000/agent-work-runner",
    "http://agent-work-sweeper:8000/agent-work-sweeper",
  ])("accepts exact function service URLs only in container mode: %s", (value) => {
    expect(() =>
      assertExactPhase2FunctionUrl(value, "FUNCTION_URL", {
        AGENT_WORK_PHASE2_CONTAINER: "1",
      }),
    ).not.toThrow();
  });

  it("rejects compose-only endpoints outside exact container mode", () => {
    expect(() => assertLocalSupabaseHttpUrl(
      "http://supabase_kong_alliincompassing:8000",
      "SUPABASE_URL",
    )).toThrow(/local/i);
    expect(() => assertLocalPostgresUrl(
      "postgresql://postgres:postgres@supabase_db_alliincompassing:5432/postgres",
      "SUPABASE_DB_URL",
    )).toThrow(/local/i);
    expect(() => assertExactPhase2FunctionUrl(
      "http://agent-work-runner:8000/agent-work-runner",
      "FUNCTION_URL",
      { AGENT_WORK_PHASE2_CONTAINER: "true" },
    )).toThrow(/container/i);
  });

  it.each([
    "https://supabase_kong_alliincompassing:8000",
    "http://user@supabase_kong_alliincompassing:8000",
    "http://supabase_kong_alliincompassing:8000/path",
    "http://supabase_kong_alliincompassing:8000/?query=1",
    "http://supabase_kong_alliincompassing:8000/#fragment",
    "http://supabase_kong_alliincompassing:54321",
    "https://project.supabase.co",
    "http://host.docker.internal:54321",
    "http://kong:8000",
    "http://172.18.0.2:8000",
  ])("rejects every non-exact Supabase HTTP endpoint in container mode: %s", (value) => {
    expect(() =>
      assertLocalSupabaseHttpUrl(value, "SUPABASE_URL", {
        AGENT_WORK_PHASE2_CONTAINER: "1",
      }),
    ).toThrow(/local/i);
  });

  it.each([
    buildSyntheticPostgresUrl("postgres", "postgres", "postgres", "supabase_db_alliincompassing", 5432, "postgres", ""),
    buildSyntheticPostgresUrl("postgresql", "other", "postgres", "supabase_db_alliincompassing", 5432, "postgres", ""),
    buildSyntheticPostgresUrl("postgresql", "postgres", "other", "supabase_db_alliincompassing", 5432, "postgres", ""),
    buildSyntheticPostgresUrl("postgresql", "postgres", "postgres", "supabase_db_alliincompassing", 5433, "postgres", ""),
    buildSyntheticPostgresUrl("postgresql", "postgres", "postgres", "supabase_db_alliincompassing", 5432, "other", ""),
    buildSyntheticPostgresUrl("postgresql", "postgres", "postgres", "supabase_db_alliincompassing", 5432, "postgres", "?ssl=true"),
    buildSyntheticPostgresUrl("postgresql", "postgres", "postgres", "host.docker.internal", 5432, "postgres", ""),
    buildSyntheticPostgresUrl("postgresql", "postgres", "postgres", "postgres", 5432, "postgres", ""),
    buildSyntheticPostgresUrl("postgresql", "postgres", "postgres", "172.18.0.3", 5432, "postgres", ""),
  ])("rejects every non-exact container Postgres endpoint: %s", (value) => {
    expect(() => assertLocalPostgresUrl(value, "SUPABASE_DB_URL", {
      AGENT_WORK_PHASE2_CONTAINER: "1",
    })).toThrow(/local/i);
  });

  it.each([
    "https://agent-work-items:8000/agent-work-items",
    "http://user@agent-work-items:8000/agent-work-items",
    "http://agent-work-items:8001/agent-work-items",
    "http://agent-work-items:8000/wrong",
    "http://agent-work-items:8000/agent-work-items?query=1",
    "http://agent-work-runner.internal:8000/agent-work-runner",
  ])("rejects non-exact function service URLs: %s", (value) => {
    expect(() => assertExactPhase2FunctionUrl(value, "FUNCTION_URL", {
      AGENT_WORK_PHASE2_CONTAINER: "1",
    })).toThrow(/function service/i);
  });
});
