import { describe, expect, it, vi } from "vitest";
import {
  createAgentOperationContext,
  isRetryableAgentError,
  withAgentRetry,
} from "../agentTransactions";

describe("agentTransactions", () => {
  it("creates stable operation and idempotency identifiers", () => {
    const context = createAgentOperationContext("cancel_sessions", 3);
    expect(context.actionType).toBe("cancel_sessions");
    expect(context.operationId.length).toBeGreaterThan(0);
    expect(context.idempotencyKey).toContain("cancel_sessions:");
    expect(context.maxAttempts).toBe(3);
  });

  it("retries retryable errors and succeeds within bounds", async () => {
    const context = createAgentOperationContext("start_session", 3);
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("temporary failure"), { status: 503 }))
      .mockResolvedValueOnce("ok");

    const result = await withAgentRetry(context, operation);
    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const context = createAgentOperationContext("start_session", 3);
    const operation = vi.fn().mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403 }));

    await expect(withAgentRetry(context, operation)).rejects.toThrow("forbidden");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("classifies network and 5xx errors as retryable", () => {
    expect(isRetryableAgentError(Object.assign(new Error("network unreachable"), { status: 0 }))).toBe(true);
    expect(isRetryableAgentError(Object.assign(new Error("internal"), { status: 500 }))).toBe(true);
    expect(isRetryableAgentError(Object.assign(new Error("bad request"), { status: 400 }))).toBe(false);
  });
});
