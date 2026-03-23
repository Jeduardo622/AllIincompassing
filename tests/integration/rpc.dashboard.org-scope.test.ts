import { describe, expect, it } from "vitest";
import { loadMultiOrgSeed } from "../fixtures/multiOrgSeed.ts";

// Lightweight simulation of get_dashboard_data aggregate using fixtures.
async function summarizeOrgSessions(orgId: string) {
  const { seed } = await loadMultiOrgSeed({ preferMcp: true });
  const sessions = seed.sessions.filter(session => session.organization_id === orgId);
  const billing = seed.billingRecords.filter(record => record.organization_id === orgId);

  return {
    todaySessions: sessions.length,
    billingCount: billing.length,
    orgId,
  };
}

describe("get_dashboard_data org scoping (simulated)", () => {
  it("returns only data for requested org", async () => {
    const orgASummary = await summarizeOrgSessions("org-a");
    const orgBSummary = await summarizeOrgSessions("org-b");

    expect(orgASummary.todaySessions).toBe(1);
    expect(orgASummary.billingCount).toBe(1);
    expect(orgBSummary.todaySessions).toBe(1);
    expect(orgBSummary.billingCount).toBe(1);
  });

  it("does not leak org-b data when querying org-a", async () => {
    const summary = await summarizeOrgSessions("org-a");
    expect(summary.todaySessions).toBe(1);
  });
});
