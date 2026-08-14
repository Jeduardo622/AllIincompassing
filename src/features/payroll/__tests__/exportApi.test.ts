import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({ callApi: vi.fn() }));

import { callApi } from "../../../lib/api";
import { createOrReusePayrollExport, downloadPayrollExportCsv } from "../exportApi";

const mockedCallApi = vi.mocked(callApi);
const run = {
  runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  payPeriodId: "77777777-7777-4777-8777-777777777777",
  adapterVersion: "provider-neutral-v1",
  replayed: false,
  createdAt: "2026-08-12T19:00:00.000Z",
  exportedAt: "2026-08-12T19:00:00.000Z",
  reconciliationStatus: "reconciled",
  checksumSha256: "a".repeat(64),
  rowCount: 4,
  totalRegularSeconds: 28800,
  totalOvertimeSeconds: 3600,
  totalDoubleTimeSeconds: 0,
  totalMealPremiumCents: 1500,
  totalGrossEarningsCents: 123450,
  sourceSnapshotCount: 2,
  adjustsRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  idempotencyKey: "export-key-1",
};

const jsonResponse = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("payroll export api client", () => {
  beforeEach(() => mockedCallApi.mockReset());

  it("creates or reuses an export with the strict body and exact idempotency echo", async () => {
    mockedCallApi.mockResolvedValueOnce(jsonResponse(run, { "Idempotency-Key": "export-key-1" }));

    await expect(createOrReusePayrollExport({
      idempotencyKey: "export-key-1",
      payPeriodId: run.payPeriodId,
      adapterVersion: "provider-neutral-v1",
    })).resolves.toEqual(run);

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-export");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      payPeriodId: run.payPeriodId,
      adapterVersion: "provider-neutral-v1",
      idempotencyKey: "export-key-1",
    });
  });

  it("fails closed when the export idempotency echo mismatches", async () => {
    mockedCallApi.mockResolvedValueOnce(jsonResponse(
      { ...run, idempotencyKey: "different-body-key" },
      { "Idempotency-Key": "different-header-key" },
    ));

    await expect(createOrReusePayrollExport({
      idempotencyKey: "export-key-1",
      payPeriodId: run.payPeriodId,
      adapterVersion: "provider-neutral-v1",
    })).rejects.toMatchObject({ code: "idempotency_mismatch", status: 502 });
  });

  it("downloads the immutable export through GET with the run id", async () => {
    mockedCallApi.mockResolvedValueOnce(new Response("schema_version,export_id\r\nprovider-neutral-v1,1\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"payroll-export-2026-08-12.csv\"",
      },
    }));

    const result = await downloadPayrollExportCsv(run.runId);
    expect(result.filename).toBe("payroll-export-2026-08-12.csv");
    expect(result.blob.type).toContain("text/csv");
    expect(mockedCallApi).toHaveBeenCalledWith(
      `/api/payroll-export?runId=${run.runId}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fails closed when the download response is missing csv metadata", async () => {
    mockedCallApi.mockResolvedValueOnce(new Response("not csv", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(downloadPayrollExportCsv(run.runId)).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });
  });
});
