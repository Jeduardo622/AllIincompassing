import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupLiveRlsHarness, type LiveRlsHarness } from "./_helpers/liveRlsHarness.ts";

let harness: LiveRlsHarness = {
  enabled: false,
  required: false,
  skipReason: "Harness not initialized.",
};

beforeAll(async () => {
  harness = await setupLiveRlsHarness();
});

afterAll(async () => {
  if (harness.enabled) {
    await harness.cleanup();
  }
});

describe("get_dashboard_data org scoping (live RPC)", () => {
  it("keeps direct authenticated get_dashboard_data denied", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const result = await orgAClient.rpc("get_dashboard_data");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("42501");
  });

  it("trusted service RPC returns only data for the requested actor org", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAResult = await harness.callTrustedDashboardRpc(harness.orgAAdminUserId, harness.orgAId);
    const orgBResult = await harness.callTrustedDashboardRpc(harness.orgBAdminUserId, harness.orgBId);

    expect(orgAResult.error).toBeNull();
    expect(orgBResult.error).toBeNull();

    const orgAIncompleteSessions = ((orgAResult.data as { incompleteSessions?: Array<{ id: string }> })?.incompleteSessions ?? []);
    const orgABillingAlerts = ((orgAResult.data as { billingAlerts?: Array<{ id: string }> })?.billingAlerts ?? []);
    const orgBIncompleteSessions = ((orgBResult.data as { incompleteSessions?: Array<{ id: string }> })?.incompleteSessions ?? []);
    const orgBBillingAlerts = ((orgBResult.data as { billingAlerts?: Array<{ id: string }> })?.billingAlerts ?? []);

    expect(orgAIncompleteSessions.map(session => session.id)).toContain(harness.orgA.sessionId);
    expect(orgAIncompleteSessions.map(session => session.id)).not.toContain(harness.orgB.sessionId);
    expect(orgABillingAlerts.map(alert => alert.id)).toContain(harness.orgA.billingRecordId);
    expect(orgABillingAlerts.map(alert => alert.id)).not.toContain(harness.orgB.billingRecordId);

    expect(orgBIncompleteSessions.map(session => session.id)).toContain(harness.orgB.sessionId);
    expect(orgBIncompleteSessions.map(session => session.id)).not.toContain(harness.orgA.sessionId);
    expect(orgBBillingAlerts.map(alert => alert.id)).toContain(harness.orgB.billingRecordId);
    expect(orgBBillingAlerts.map(alert => alert.id)).not.toContain(harness.orgA.billingRecordId);
  });

  it("trusted service RPC denies an org-a admin querying org-b", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const result = await harness.callTrustedDashboardRpc(harness.orgAAdminUserId, harness.orgBId);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("42501");
  });
});
