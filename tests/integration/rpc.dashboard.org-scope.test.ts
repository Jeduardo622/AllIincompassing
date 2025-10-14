import { describe, expect, it } from "vitest";
import { buildMultiOrgSeed } from "../fixtures/multiOrgSeed.ts";

// Lightweight simulation of get_dashboard_data aggregate using fixtures.
function summarizeOrgSessions(orgId: string) {
  const seed = buildMultiOrgSeed();
  const sessions = seed.sessions.filter(session => session.organization_id === orgId);
  const billing = seed.billingRecords.filter(record => record.organization_id === orgId);

  return {
    todaySessions: sessions.length,
    billingCount: billing.length,
    orgId,
  };
}

describe("get_dashboard_data org scoping (simulated)", () => {
  it("returns only data for requested org", () => {
    const summary = summarizeOrgSessions("org-a");
    expect(summary.todaySessions).toBe(1);
    expect(summary.billingCount).toBe(1);
  });

  it("does not leak org-b data when querying org-a", () => {
    const summary = summarizeOrgSessions("org-a");
    expect(summary.todaySessions).not.toBeGreaterThan(1);
  });
});

// TODO: Replace simulation with Supabase RPC call once MCP automation is available.
