/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PROJECT_REF,
  assertBtFixtureGraph,
  assertBtFixtureMarker,
  assertNonProductionProjectRef,
  buildBtAuthMetadata,
  buildBtSmokeEmail,
  buildBtSmokeGithubEnv,
} from "../../scripts/provision-ci-smoke-bt-aba";

const MARKER = "bt-aba-proof-1234";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const GOAL_ID = "55555555-5555-4555-8555-555555555555";
const AUTHORIZATION_ID = "66666666-6666-4666-8666-666666666666";

describe("provision-ci-smoke-bt-aba safeguards", () => {
  it("requires a long marker made only from letters, digits, or hyphens", () => {
    expect(() => assertBtFixtureMarker("short")).toThrow(/12 characters/);
    expect(() => assertBtFixtureMarker("invalid_marker_value")).toThrow(/letters, digits, or hyphens/);
    expect(() => assertBtFixtureMarker(MARKER)).not.toThrow();
  });

  it("refuses the production project ref and mismatched runtime refs", () => {
    expect(() => assertNonProductionProjectRef(PRODUCTION_PROJECT_REF, PRODUCTION_PROJECT_REF)).toThrow(/production/i);
    expect(() => assertNonProductionProjectRef("branch-project-ref", "another-project-ref")).toThrow(/mismatch/i);
    expect(() => assertNonProductionProjectRef("branch-project-ref", "branch-project-ref")).not.toThrow();
  });

  it("builds a visibly synthetic marker-owned email", () => {
    expect(buildBtSmokeEmail(MARKER)).toContain(MARKER);
    expect(buildBtSmokeEmail(MARKER)).toMatch(/^playwright\.ci\.bt\./);
  });

  it("does not attach the organization until its row can exist", () => {
    expect(buildBtAuthMetadata(MARKER)).toEqual({ fixture_marker: MARKER });
    expect(buildBtAuthMetadata(MARKER, ORGANIZATION_ID)).toEqual({
      fixture_marker: MARKER,
      organization_id: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
    });
  });

  it("exports harness aliases, exact fixture IDs, and disposable acknowledgements", () => {
    expect(buildBtSmokeGithubEnv({
      supabaseUrl: "https://branch-project-ref.supabase.co",
      publishableKey: "publishable-test-key",
      secretKey: "secret-test-key",
      projectRef: "branch-project-ref",
      marker: MARKER,
      email: buildBtSmokeEmail(MARKER),
      password: "generated-test-password",
      clientId: CLIENT_ID,
      programId: PROGRAM_ID,
      goalId: GOAL_ID,
      authorizationId: AUTHORIZATION_ID,
    })).toEqual(expect.objectContaining({
      VITE_SUPABASE_URL: "https://branch-project-ref.supabase.co",
      VITE_SUPABASE_ANON_KEY: "publishable-test-key",
      SUPABASE_SERVICE_ROLE_KEY: "secret-test-key",
      PW_BT_FIXTURE_MARKER: MARKER,
      PW_BT_CLIENT_ID: CLIENT_ID,
      PW_BT_PROGRAM_ID: PROGRAM_ID,
      PW_BT_GOAL_ID: GOAL_ID,
      PW_BT_AUTHORIZATION_ID: AUTHORIZATION_ID,
      PW_BT_SERVICE_CODE: "97153",
      PW_BT_DISPOSABLE_PROJECT_REF: "branch-project-ref",
      PW_BT_DISPOSABLE_ACK: "I_ACKNOWLEDGE_DISPOSABLE_SUPABASE",
      PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK: "delete-branch-after-run",
    }));
  });

  it("accepts only the exact marker-owned single-tenant BT graph", () => {
    expect(() => assertBtFixtureGraph({
      marker: MARKER,
      actorId: ACTOR_ID,
      organization: { id: ORGANIZATION_ID, name: `BT proof ${MARKER}`, slug: `bt-proof-${MARKER}` },
      profile: { id: ACTOR_ID, organization_id: ORGANIZATION_ID, role: "bt", is_active: true },
      therapist: { id: ACTOR_ID, organization_id: ORGANIZATION_ID, email: buildBtSmokeEmail(MARKER), full_name: `BT ${MARKER}`, title: "BT", status: "active", deleted_at: null },
      roleNames: ["bt"],
      client: { id: CLIENT_ID, organization_id: ORGANIZATION_ID, email: `client.${MARKER}@example.com`, full_name: `Client ${MARKER}`, notes: MARKER, status: "active", deleted_at: null },
      program: { id: PROGRAM_ID, organization_id: ORGANIZATION_ID, client_id: CLIENT_ID, name: `Program ${MARKER}`, description: MARKER, status: "active" },
      goal: { id: GOAL_ID, organization_id: ORGANIZATION_ID, client_id: CLIENT_ID, program_id: PROGRAM_ID, title: `Goal ${MARKER}`, description: MARKER, original_text: MARKER, status: "active" },
      authorization: { id: AUTHORIZATION_ID, organization_id: ORGANIZATION_ID, client_id: CLIENT_ID, provider_id: ACTOR_ID, status: "approved", start_date: "2026-07-15", end_date: "2026-07-17" },
      service: { authorization_id: AUTHORIZATION_ID, organization_id: ORGANIZATION_ID, service_code: "97153", decision_status: "approved", from_date: "2026-07-15", to_date: "2026-07-17" },
      today: "2026-07-16",
    })).not.toThrow();
  });
});
