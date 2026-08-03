import { describe, expect, it } from "vitest";

import {
  assertExactLocalRuntimeUrl,
  isPhase2ContainerMode,
} from "../scripts/agent-work-ledger-harness/localRuntime.mjs";

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
    ["postgresql", "://", "postgres", ":", "postgres", "@127.0.0.1:54322/postgres"].join(""),
  ])("accepts loopback URLs in host mode: %s", (value) => {
    expect(() => assertExactLocalRuntimeUrl(value, "LOCAL_URL")).not.toThrow();
  });

  it.each([
    "http://agent-work-items:54321/functions/v1/agent-work-items",
    "http://agent-work-runner:8000/agent-work-runner",
    "http://agent-work-sweeper:8001/agent-work-sweeper",
  ])("accepts only the exact phase2 service hosts in container mode: %s", (value) => {
    expect(() =>
      assertExactLocalRuntimeUrl(value, "LOCAL_URL", { AGENT_WORK_PHASE2_CONTAINER: "1" }),
    ).not.toThrow();
  });

  it.each([
    "http://agent-work-items:54321/functions/v1/agent-work-items",
    "http://agent-work-runner:8000/agent-work-runner",
    "http://agent-work-sweeper:8001/agent-work-sweeper",
  ])("rejects phase2 service hosts outside container mode: %s", (value) => {
    expect(() => assertExactLocalRuntimeUrl(value, "LOCAL_URL")).toThrow(/local host/i);
  });

  it.each([
    "https://project.supabase.co",
    "http://host.docker.internal:54321",
    "http://postgres:5432/postgres",
    "http://agent-work-runner.internal:8000/agent-work-runner",
  ])("rejects non-allowlisted hosts even in container mode: %s", (value) => {
    expect(() =>
      assertExactLocalRuntimeUrl(value, "LOCAL_URL", { AGENT_WORK_PHASE2_CONTAINER: "1" }),
    ).toThrow(/local host/i);
  });
});
