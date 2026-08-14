import { beforeEach, describe, expect, it, vi } from "vitest";

const payrollAdministrationHandlerMock = vi.hoisted(() => vi.fn());

vi.mock("../src/server/api/payroll-administration", () => ({
  payrollAdministrationHandler: payrollAdministrationHandlerMock,
}));

import { handler } from "../netlify/functions/payroll-administration";

const createEvent = (overrides: Record<string, unknown> = {}) => ({
  httpMethod: "POST",
  rawUrl: "https://app.allincompassing.ai/api/payroll-administration",
  path: "/api/payroll-administration",
  headers: {
    host: "app.allincompassing.ai",
    origin: "https://app.allincompassing.ai",
    "content-type": "application/json",
    "x-request-id": "netlify-request-id",
    "x-correlation-id": "netlify-correlation-id",
  },
  body: JSON.stringify({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
  isBase64Encoded: false,
  ...overrides,
});

const invoke = async (event = createEvent()) =>
  await handler(event as never, {} as never) as {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
  };

describe("payroll-administration Netlify adapter", () => {
  beforeEach(() => {
    payrollAdministrationHandlerMock.mockReset();
  });

  it("preserves downstream status, body, and protected headers", async () => {
    const body = {
      success: false,
      requestId: "edge-request-id",
      code: "conflict",
      message: "Idempotency conflict.",
      error: "Idempotency conflict.",
      classification: { category: "request", severity: "medium", retryable: false, httpStatus: 409 },
      idempotencyKey: "adapter-key",
    };
    payrollAdministrationHandlerMock.mockResolvedValue(new Response(JSON.stringify(body), {
      status: 409,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "adapter-key",
        "Retry-After": "3",
        "x-request-id": "edge-request-id",
      },
    }));

    const result = await invoke();

    expect(result).toEqual({
      statusCode: 409,
      headers: expect.objectContaining({
        "content-type": "application/json",
        "idempotency-key": "adapter-key",
        "retry-after": "3",
        "x-request-id": "edge-request-id",
      }),
      body: JSON.stringify(body),
      isBase64Encoded: false,
    });
  });

  it("decodes base64 request bodies before invoking the transport handler", async () => {
    const payload = { action: "get_administration", selectedLocalDate: "2026-08-12" };
    let receivedRequest: Request | null = null;
    payrollAdministrationHandlerMock.mockImplementation((request: Request) => {
      receivedRequest = request;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    const result = await invoke(createEvent({
      body: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
      isBase64Encoded: true,
    }));

    expect(result.statusCode).toBe(200);
    expect(receivedRequest).not.toBeNull();
    expect(await receivedRequest!.json()).toEqual(payload);
  });

  it("returns a protected internal_error envelope when the adapter catches", async () => {
    payrollAdministrationHandlerMock.mockRejectedValue(new Error("forced adapter failure"));

    const result = await invoke();
    const body = JSON.parse(result.body) as Record<string, unknown>;

    expect(result.statusCode).toBe(500);
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
