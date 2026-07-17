/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PRODUCTION_PROJECT_REF,
  assertBtFixtureGraph,
  assertBtFixtureMarker,
  assertBranchOwnershipContract,
  assertNonProductionProjectRef,
  buildBtAuthMetadata,
  buildBtOrganizationMetadata,
  buildBtSmokeEmail,
  buildBtSmokeGithubEnv,
  cleanupPartialBtFixture,
} from "../../scripts/provision-ci-smoke-bt-aba";
import type { SupabaseClient } from "@supabase/supabase-js";

const MARKER = "bt-aba-proof-1234";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const GOAL_ID = "55555555-5555-4555-8555-555555555555";
const AUTHORIZATION_ID = "66666666-6666-4666-8666-666666666666";

const validGraph = () => ({
  marker: MARKER,
  actorId: ACTOR_ID,
  organization: { id: ORGANIZATION_ID, name: `BT proof ${MARKER}`, slug: `bt-proof-${MARKER}` },
  profile: { id: ACTOR_ID, organization_id: ORGANIZATION_ID, role: "bt", is_active: true },
  therapist: { id: ACTOR_ID, organization_id: ORGANIZATION_ID, email: buildBtSmokeEmail(MARKER), full_name: `BT ${MARKER}`, title: "BT", status: "active", deleted_at: null },
  roleMappings: [{ name: "bt", isActive: true, expiresAt: "2099-01-01T00:00:00.000Z" }],
  client: { id: CLIENT_ID, organization_id: ORGANIZATION_ID, email: `client.${MARKER}@example.com`, full_name: `Client ${MARKER}`, notes: MARKER, status: "active", deleted_at: null },
  program: { id: PROGRAM_ID, organization_id: ORGANIZATION_ID, client_id: CLIENT_ID, name: `Program ${MARKER}`, description: MARKER, status: "active" },
  goal: { id: GOAL_ID, organization_id: ORGANIZATION_ID, client_id: CLIENT_ID, program_id: PROGRAM_ID, title: `Goal ${MARKER}`, description: MARKER, original_text: MARKER, status: "active" },
  authorization: { id: AUTHORIZATION_ID, organization_id: ORGANIZATION_ID, client_id: CLIENT_ID, provider_id: ACTOR_ID, status: "approved", start_date: "2026-07-15", end_date: "2026-07-17" },
  service: { authorization_id: AUTHORIZATION_ID, organization_id: ORGANIZATION_ID, service_code: "97153", decision_status: "approved", from_date: "2026-07-15", to_date: "2026-07-17" },
  today: "2026-07-16",
});

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

  it("stores the fixture marker only in allowed organization metadata fields", () => {
    expect(buildBtOrganizationMetadata(MARKER)).toEqual({
      tags: [MARKER],
      notes: `Synthetic fixture ${MARKER}`,
    });
    expect(buildBtOrganizationMetadata(MARKER)).not.toHaveProperty("fixture_marker");
  });

  it("removes every exact partial-fixture identity before deleting its auth user", async () => {
    const calls: string[] = [];
    const client = {
      from: (table: string) => ({
        delete: () => ({
          eq: async (column: string, value: string) => {
            calls.push(`${table}.${column}=${value}`);
            return { error: null };
          },
        }),
      }),
      auth: { admin: { deleteUser: async (id: string) => {
        calls.push(`auth.users.id=${id}`);
        return { error: null };
      } } },
    } as unknown as SupabaseClient;

    await cleanupPartialBtFixture(client, {
      actorId: ACTOR_ID,
      organizationId: ORGANIZATION_ID,
      clientId: CLIENT_ID,
      programId: PROGRAM_ID,
      goalId: GOAL_ID,
      authorizationId: AUTHORIZATION_ID,
      authorizationServiceId: "77777777-7777-4777-8777-777777777777",
    });

    expect(calls.at(-1)).toBe(`auth.users.id=${ACTOR_ID}`);
    expect(calls).toContain(`organizations.id=${ORGANIZATION_ID}`);
    expect(calls).toContain(`authorization_services.id=77777777-7777-4777-8777-777777777777`);
  });

  it("removes the pre-auth organization when auth creation never returns a user", async () => {
    const calls: string[] = [];
    const client = {
      from: (table: string) => ({ delete: () => ({ eq: async () => {
        calls.push(table);
        return { error: null };
      } }) }),
      auth: { admin: { deleteUser: async () => {
        calls.push("auth.users");
        return { error: null };
      } } },
    } as unknown as SupabaseClient;

    await cleanupPartialBtFixture(client, {
      organizationId: ORGANIZATION_ID,
      clientId: CLIENT_ID,
      programId: PROGRAM_ID,
      goalId: GOAL_ID,
      authorizationId: AUTHORIZATION_ID,
      authorizationServiceId: "77777777-7777-4777-8777-777777777777",
    });
    expect(calls).toContain("organizations");
    expect(calls).not.toContain("auth.users");

    const source = readFileSync(path.join(process.cwd(), "scripts/provision-ci-smoke-bt-aba.ts"), "utf8");
    const provisionSource = source.slice(source.indexOf("const provision = async"));
    expect(provisionSource.indexOf('created_by: null')).toBeLessThan(provisionSource.indexOf('auth.admin.createUser'));
    expect(provisionSource).toContain('buildBtAuthMetadata(marker, organizationId)');
  });

  it("uses the existing service-only fixture RPC before installing the authoritative bt mapping", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/provision-ci-smoke-bt-aba.ts"), "utf8");
    const provisionSource = source.slice(source.indexOf("const provision = async"));
    const temporaryTherapist = provisionSource.indexOf('role_id: therapistRole.id');
    const profileRpc = provisionSource.indexOf('rpc("provision_ci_rls_fixture_profile"');
    const authoritativeBt = provisionSource.indexOf('role_id: btRole.id');
    expect(provisionSource).toContain('ci_rls_fixture: "true"');
    expect(provisionSource).toContain('ci_rls_expires_at: fixtureExpiry');
    expect(provisionSource.match(/role_id: (?:therapistRole|btRole)\.id, is_active: true, expires_at: fixtureExpiry/g)).toHaveLength(2);
    expect(temporaryTherapist).toBeGreaterThan(-1);
    expect(profileRpc).toBeGreaterThan(temporaryTherapist);
    expect(authoritativeBt).toBeGreaterThan(profileRpc);
  });

  it("exports harness aliases, exact fixture IDs, and disposable acknowledgements", () => {
    expect(buildBtSmokeGithubEnv({
      supabaseUrl: "https://branch-project-ref.supabase.co",
      publishableKey: "publishable-test-key",
      projectRef: "branch-project-ref",
      marker: MARKER,
      email: buildBtSmokeEmail(MARKER),
      password: "generated-test-password",
      clientId: CLIENT_ID,
      programId: PROGRAM_ID,
      goalId: GOAL_ID,
      authorizationId: AUTHORIZATION_ID,
      authorizationServiceId: "77777777-7777-4777-8777-777777777777",
      actorId: ACTOR_ID,
      organizationId: ORGANIZATION_ID,
    })).toEqual(expect.objectContaining({
      VITE_SUPABASE_URL: "https://branch-project-ref.supabase.co",
      VITE_SUPABASE_ANON_KEY: "publishable-test-key",
      PW_BT_PASSWORD: "generated-test-password",
      PW_BT_FIXTURE_MARKER: MARKER,
      PW_BT_CLIENT_ID: CLIENT_ID,
      PW_BT_PROGRAM_ID: PROGRAM_ID,
      PW_BT_GOAL_ID: GOAL_ID,
      PW_BT_AUTHORIZATION_ID: AUTHORIZATION_ID,
      PW_BT_AUTHORIZATION_SERVICE_ID: "77777777-7777-4777-8777-777777777777",
      PW_BT_ACTOR_ID: ACTOR_ID,
      PW_BT_ORGANIZATION_ID: ORGANIZATION_ID,
      PW_BT_SERVICE_CODE: "97153",
      PW_BT_DISPOSABLE_PROJECT_REF: "branch-project-ref",
      PW_BT_DISPOSABLE_ACK: "I_ACKNOWLEDGE_DISPOSABLE_SUPABASE",
      PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK: "delete-branch-after-run",
    }));
    expect(buildBtSmokeGithubEnv({
      supabaseUrl: "https://branch-project-ref.supabase.co",
      publishableKey: "publishable-test-key",
      projectRef: "branch-project-ref",
      marker: MARKER,
      email: buildBtSmokeEmail(MARKER),
      password: "generated-test-password",
      clientId: CLIENT_ID,
      programId: PROGRAM_ID,
      goalId: GOAL_ID,
      authorizationId: AUTHORIZATION_ID,
      authorizationServiceId: "77777777-7777-4777-8777-777777777777",
      actorId: ACTOR_ID,
      organizationId: ORGANIZATION_ID,
    })).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("fails invalid retained-branch ownership before the first provisioning mutation", () => {
    expect(() => assertBranchOwnershipContract(
      "platform-managed-pr-preview",
      "delete-branch-after-run",
    )).toThrow(/ownership.*acknowledgement/i);
    expect(() => assertBranchOwnershipContract(
      "platform-managed-pr-preview",
      "retain-platform-managed-pr-preview",
    )).not.toThrow();

    const source = readFileSync(path.join(process.cwd(), "scripts/provision-ci-smoke-bt-aba.ts"), "utf8");
    const provisionSource = source.slice(source.indexOf("const provision = async"));
    expect(provisionSource.indexOf("assertBranchOwnershipContract(")).toBeLessThan(
      provisionSource.indexOf("createClient("),
    );
  });

  it("never emits generated passwords through stdout workflow commands", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/provision-ci-smoke-bt-aba.ts"), "utf8");
    expect(source).not.toContain("::add-mask::");
  });

  it("accepts only the exact marker-owned single-tenant BT graph", () => {
    expect(() => assertBtFixtureGraph(validGraph())).not.toThrow();
  });

  it.each([
    ["organization mismatch", (graph: ReturnType<typeof validGraph>) => { graph.goal.organization_id = "77777777-7777-4777-8777-777777777777"; }],
    ["extra role", (graph: ReturnType<typeof validGraph>) => { graph.roleMappings.push({ name: "admin", isActive: true }); }],
    ["inactive bt", (graph: ReturnType<typeof validGraph>) => { graph.roleMappings[0].isActive = false; }],
    ["provider mismatch", (graph: ReturnType<typeof validGraph>) => { graph.authorization.provider_id = CLIENT_ID; }],
    ["program client link", (graph: ReturnType<typeof validGraph>) => { graph.program.client_id = ACTOR_ID; }],
    ["goal client link", (graph: ReturnType<typeof validGraph>) => { graph.goal.client_id = ACTOR_ID; }],
    ["goal program link", (graph: ReturnType<typeof validGraph>) => { graph.goal.program_id = ACTOR_ID; }],
    ["authorization client link", (graph: ReturnType<typeof validGraph>) => { graph.authorization.client_id = ACTOR_ID; }],
    ["service authorization link", (graph: ReturnType<typeof validGraph>) => { graph.service.authorization_id = ACTOR_ID; }],
    ["client status", (graph: ReturnType<typeof validGraph>) => { graph.client.status = "inactive"; }],
    ["program status", (graph: ReturnType<typeof validGraph>) => { graph.program.status = "inactive"; }],
    ["goal status", (graph: ReturnType<typeof validGraph>) => { graph.goal.status = "paused"; }],
    ["authorization status", (graph: ReturnType<typeof validGraph>) => { graph.authorization.status = "pending"; }],
    ["service status", (graph: ReturnType<typeof validGraph>) => { graph.service.decision_status = "pending"; }],
    ["authorization date", (graph: ReturnType<typeof validGraph>) => { graph.authorization.end_date = "2026-07-15"; }],
    ["service date", (graph: ReturnType<typeof validGraph>) => { graph.service.from_date = "2026-07-17"; }],
  ])("rejects %s invariant violations", (_label, mutate) => {
    const graph = validGraph();
    mutate(graph);
    expect(() => assertBtFixtureGraph(graph)).toThrow();
  });
});
