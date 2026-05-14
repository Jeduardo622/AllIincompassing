import { describe, expect, it } from "vitest";

import {
  assertSmokeClientMarker,
  buildPromotedLiveCleanupQueries,
  requireSmokeClientId,
} from "../../../scripts/lib/assessment-upload-promote-smoke-guards";

describe("assessment upload promote smoke guards", () => {
  it("requires an explicit dedicated smoke client", () => {
    expect(() => requireSmokeClientId(undefined)).toThrow("PW_ASSESSMENT_CLIENT_ID is required");
    expect(() => requireSmokeClientId("   ")).toThrow("PW_ASSESSMENT_CLIENT_ID is required");
    expect(requireSmokeClientId(" client-123 ")).toBe("client-123");
  });

  it("requires a visible smoke-only client marker before destructive promotion", () => {
    expect(() => assertSmokeClientMarker("Jane Real Client", "client-123")).toThrow(
      "clearly marked smoke client",
    );
    expect(() => assertSmokeClientMarker("", "client-123")).toThrow("clearly marked smoke client");
    expect(() => assertSmokeClientMarker("CalOptima Redacted Client", "client-123")).toThrow(
      "clearly marked smoke client",
    );
    expect(() => assertSmokeClientMarker("CalOptima Redacted Smoke Client", "client-123")).not.toThrow();
    expect(() => assertSmokeClientMarker("Synthetic Test Client", "client-123")).not.toThrow();
  });

  it("builds exact org/client-scoped cleanup filters for promoted live records", () => {
    const queries = buildPromotedLiveCleanupQueries({
      assessmentDocumentId: "assessment id",
      organizationId: "org id",
      clientId: "client id",
      programIds: ["program/one", "program two"],
      goalIds: ["goal/one", "goal two"],
    });

    expect(queries.goalDataPoints).toBe(
      "goal_id=in.(goal%2Fone,goal%20two)&assessment_document_id=eq.assessment%20id&organization_id=eq.org%20id&client_id=eq.client%20id",
    );
    expect(queries.goals).toBe(
      "program_id=in.(program%2Fone,program%20two)&organization_id=eq.org%20id&client_id=eq.client%20id",
    );
    expect(queries.programs).toBe(
      "id=in.(program%2Fone,program%20two)&organization_id=eq.org%20id&client_id=eq.client%20id",
    );
  });

  it("does not build broad cleanup filters when no promoted program IDs exist", () => {
    expect(
      buildPromotedLiveCleanupQueries({
        assessmentDocumentId: "assessment-id",
        organizationId: "org-id",
        clientId: "client-id",
        programIds: [],
        goalIds: [],
      }),
    ).toEqual({});
  });

  it("does not build a goal data point cleanup filter until promoted goal IDs are known", () => {
    const queries = buildPromotedLiveCleanupQueries({
      assessmentDocumentId: "assessment-id",
      organizationId: "org-id",
      clientId: "client-id",
      programIds: ["program-id"],
      goalIds: [],
    });

    expect(queries.goalDataPoints).toBeUndefined();
    expect(queries.goals).toContain("program_id=in.(program-id)");
    expect(queries.programs).toContain("id=in.(program-id)");
  });
});
