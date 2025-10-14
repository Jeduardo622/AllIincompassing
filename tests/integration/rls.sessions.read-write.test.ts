import { describe, expect, it } from "vitest";
import { buildMultiOrgSeed } from "../fixtures/multiOrgSeed.ts";
import { ForbiddenError } from "../../supabase/functions/_shared/org.ts";

function simulateRlsSelect<T extends { organization_id: string }>(
  rows: readonly T[],
  orgId: string,
) {
  return rows.filter(row => row.organization_id === orgId);
}

function simulateRlsUpdate<T extends { organization_id: string; id: string }>(
  rows: readonly T[],
  orgId: string,
  targetId: string,
) {
  const record = rows.find(row => row.id === targetId);
  if (!record) {
    throw new ForbiddenError("Record not visible");
  }
  if (record.organization_id !== orgId) {
    throw new ForbiddenError("Cross-org mutation denied");
  }
  return record;
}

describe("RLS sessions read/write simulation", () => {
  const seed = buildMultiOrgSeed();

  it("returns only same-org sessions to org-a member", () => {
    const accessible = simulateRlsSelect(seed.sessions, "org-a");
    expect(accessible.every(session => session.organization_id === "org-a")).toBe(true);
    expect(accessible.map(session => session.id)).toEqual(["sess-001"]);
  });

  it("prevents org-a admin from updating org-b session", () => {
    expect(() => simulateRlsUpdate(seed.sessions, "org-a", "sess-002")).toThrow(ForbiddenError);
  });
});

// TODO: Replace simulation with Supabase-backed integration tests once MCP is available in CI.
