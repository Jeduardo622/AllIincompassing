import { beforeEach, describe, expect, it, vi } from "vitest";

const payrollApprovalsHandlerMock = vi.hoisted(() => vi.fn());

vi.mock("../src/server/api/payroll-approvals", () => ({
  payrollApprovalsHandler: payrollApprovalsHandlerMock,
}));

import { handler } from "../netlify/functions/payroll-approvals";

const createEvent = () => ({
  httpMethod: "POST",
  rawUrl: "https://app.allincompassing.ai/api/payroll-approvals",
  path: "/api/payroll-approvals",
  headers: {
    host: "app.allincompassing.ai",
    origin: "https://app.allincompassing.ai",
    "content-type": "application/json",
    "x-request-id": "netlify-request-id",
    "x-correlation-id": "netlify-correlation-id",
  },
  body: JSON.stringify({ action: "submit" }),
  isBase64Encoded: false,
});

const invoke = async () =>
  await handler(createEvent() as never, {} as never) as {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
  };

describe("payroll-approvals Netlify adapter", () => {
  beforeEach(() => {
    payrollApprovalsHandlerMock.mockReset();
  });

  it("returns a protected internal_error envelope when the adapter catches", async () => {
    payrollApprovalsHandlerMock.mockRejectedValue(new Error("forced adapter failure"));

    const result = await invoke();
    const body = JSON.parse(result.body) as Record<string, unknown>;

    expect(result.statusCode).toBe(500);
    expect(result.isBase64Encoded).toBe(false);
    expect(result.headers).toEqual(expect.objectContaining({
      "access-control-allow-origin": "https://app.allincompassing.ai",
      "content-type": "application/json",
      "x-request-id": "netlify-request-id",
      "x-correlation-id": "netlify-correlation-id",
    }));
    expect(body).toEqual({
      success: false,
      error: "Internal server error",
      requestId: "netlify-request-id",
      code: "internal_error",
      message: "Internal server error",
      classification: {
        category: "internal",
        severity: "critical",
        retryable: false,
        httpStatus: 500,
      },
    });
  });
});
