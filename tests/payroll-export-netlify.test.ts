import { beforeEach, describe, expect, it, vi } from "vitest";

const payrollExportHandlerMock = vi.hoisted(() => vi.fn());

vi.mock("../src/server/api/payroll-export", () => ({
  payrollExportHandler: payrollExportHandlerMock,
}));

import { handler } from "../netlify/functions/payroll-export";

const createEvent = (overrides: Record<string, unknown> = {}) => ({
  httpMethod: "GET",
  rawUrl: "https://app.allincompassing.ai/api/payroll-export?runId=11111111-1111-1111-1111-111111111111",
  path: "/api/payroll-export",
  headers: {
    host: "app.allincompassing.ai",
    origin: "https://app.allincompassing.ai",
    "x-request-id": "netlify-request-id",
    "x-correlation-id": "netlify-correlation-id",
  },
  body: null,
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

describe("payroll-export Netlify adapter", () => {
  beforeEach(() => {
    payrollExportHandlerMock.mockReset();
  });

  it("preserves downstream csv status, body, and protected headers", async () => {
    payrollExportHandlerMock.mockResolvedValue(new Response("schema_version,export_id\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'attachment; filename="payroll-export-provider-neutral-v1-2026-08-01-to-2026-08-14-11111111-1111-1111-1111-111111111111.csv"',
        "x-request-id": "edge-export-request",
      },
    }));

    const result = await invoke();

    expect(result).toEqual({
      statusCode: 200,
      headers: expect.objectContaining({
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": 'attachment; filename="payroll-export-provider-neutral-v1-2026-08-01-to-2026-08-14-11111111-1111-1111-1111-111111111111.csv"',
        "x-request-id": "edge-export-request",
      }),
      body: "schema_version,export_id\r\n",
      isBase64Encoded: false,
    });
  });

  it("returns a protected internal_error envelope when the adapter catches", async () => {
    payrollExportHandlerMock.mockRejectedValue(new Error("forced adapter failure"));

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
