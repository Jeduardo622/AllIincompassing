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
  it("returns only data for requested org", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const orgBClient = await harness.signInAdminB();
    const orgAResult = await orgAClient.rpc("get_dashboard_data");
    const orgBResult = await orgBClient.rpc("get_dashboard_data");

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

  it("does not leak org-b data when querying org-a", async () => {
    if (!harness.enabled) {
      if (harness.required) {
        throw new Error(harness.skipReason);
      }
      return;
    }

    const orgAClient = await harness.signInAdminA();
    const result = await orgAClient.rpc("get_dashboard_data");

    expect(result.error).toBeNull();
    const orgAIncompleteSessions = ((result.data as { incompleteSessions?: Array<{ id: string }> })?.incompleteSessions ?? []);
    expect(orgAIncompleteSessions.map(session => session.id)).toContain(harness.orgA.sessionId);
    expect(orgAIncompleteSessions.map(session => session.id)).not.toContain(harness.orgB.sessionId);
  });
});
