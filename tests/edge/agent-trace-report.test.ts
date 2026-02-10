import { describe, expect, it } from "vitest";

import { __TESTING__ } from "../../supabase/functions/agent-trace-report/index.ts";

describe("agent-trace-report utility", () => {
  it("parses selectors from POST payload", () => {
    const req = new Request("https://example.test/functions/v1/agent-trace-report", {
      method: "POST",
    });

    const selector = __TESTING__.parseSelector(req, {
      correlationId: "corr-123",
      requestId: "req-123",
      agentOperationId: "op-123",
    });

    expect(selector).toEqual({
      correlationId: "corr-123",
      requestId: "req-123",
      agentOperationId: "op-123",
    });
  });

  it("throws when selector is missing", () => {
    const req = new Request("https://example.test/functions/v1/agent-trace-report", {
      method: "GET",
    });

    expect(() => __TESTING__.parseSelector(req, {})).toThrowError(Response);
  });

  it("extracts agent operation id from idempotency key", () => {
    expect(__TESTING__.parseAgentOperationFromIdempotencyKey("schedule_session:op-55")).toBe("op-55");
    expect(__TESTING__.parseAgentOperationFromIdempotencyKey("")).toBeNull();
    expect(__TESTING__.parseAgentOperationFromIdempotencyKey("invalid")).toBeNull();
  });
});
