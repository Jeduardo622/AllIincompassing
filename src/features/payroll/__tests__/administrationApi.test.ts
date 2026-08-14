import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  callApi: vi.fn(),
}));

import { callApi } from "../../../lib/api";
import {
  executePayrollAdministrationAction,
  hasAnyPayrollAdministrationCapability,
} from "../administrationApi";

const mockedCallApi = vi.mocked(callApi);

const jsonResponse = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

describe("payroll administration api client", () => {
  beforeEach(() => {
    mockedCallApi.mockReset();
  });

  it.each([
    {
      action: {
        action: "grant_capability" as const,
        userId: "44444444-4444-4444-4444-444444444444",
        capability: "payroll.configure_settings" as const,
        effectiveFrom: "2026-08-01T00:00:00Z",
        effectiveThrough: null,
      },
      result: {
        action: "grant_capability" as const,
        capabilityGrantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        replayed: false,
        idempotencyKey: "configure-settings-key",
      },
    },
    {
      action: {
        action: "revoke_capability" as const,
        userId: "44444444-4444-4444-4444-444444444444",
        capability: "payroll.configure_settings" as const,
        effectiveThrough: "2026-08-31T23:59:59Z",
      },
      result: {
        action: "revoke_capability" as const,
        capabilityGrantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        replayed: false,
        idempotencyKey: "configure-settings-key",
      },
    },
  ])("accepts $action.action for payroll.configure_settings with exact idempotency echo", async ({ action, result }) => {
    mockedCallApi.mockResolvedValueOnce(jsonResponse(result, { "Idempotency-Key": "configure-settings-key" }));

    await expect(executePayrollAdministrationAction({
      idempotencyKey: "configure-settings-key",
      action,
    })).resolves.toEqual(result);

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-administration");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("configure-settings-key");
    expect(JSON.parse(String(init?.body))).toEqual(action);
  });

  it("keeps export-only administration access outside the broader administration surface gate", () => {
    expect(hasAnyPayrollAdministrationCapability({
      canConfigureEmployment: false,
      canResolveExceptions: false,
      canLockPeriod: false,
      canReopenPeriod: false,
      canGeneratePeriods: false,
      canExportPeriod: true,
      canViewCompensation: false,
      canManagePolicyMutations: false,
    })).toBe(false);
  });
});
