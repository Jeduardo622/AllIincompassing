import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../exportApi", () => ({
  createOrReusePayrollExport: vi.fn(),
  downloadPayrollExportCsv: vi.fn(),
}));

import { createOrReusePayrollExport, downloadPayrollExportCsv } from "../exportApi";
import { payrollAdministrationQueryKey } from "../usePayrollAdministration";
import { usePayrollExport } from "../usePayrollExport";

const scope = { organizationId: "org-1", userId: "user-1", localDate: "2026-08-12" };

function Probe() {
  const payrollExport = usePayrollExport(scope);
  return (
    <div>
      <button type="button" onClick={() => void payrollExport.createPayrollExportMutation.mutateAsync({
        idempotencyKey: "export-key-1",
        payPeriodId: "77777777-7777-4777-8777-777777777777",
        adapterVersion: "provider-neutral-v1",
      })}>create-export</button>
      <button type="button" onClick={() => void payrollExport.downloadPayrollExportMutation.mutateAsync({
        runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      })}>download-export</button>
    </div>
  );
}

describe("usePayrollExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createOrReusePayrollExport).mockResolvedValue({} as never);
    vi.mocked(downloadPayrollExportCsv).mockResolvedValue({
      filename: "payroll-export-2026-08-12.csv",
      blob: new Blob(["csv"], { type: "text/csv" }),
    });
  });

  it("invalidates the authoritative administration read model after export", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);

    screen.getByRole("button", { name: "create-export" }).click();
    await waitFor(() => expect(createOrReusePayrollExport).toHaveBeenCalled());
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: payrollAdministrationQueryKey("org-1", "user-1", "2026-08-12"),
    });
  });

  it("routes csv downloads through the exact blob client", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);

    screen.getByRole("button", { name: "download-export" }).click();
    await waitFor(() => expect(downloadPayrollExportCsv).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ));
  });
});
