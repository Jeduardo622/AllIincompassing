/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { cleanupMarkerOwnedBtFixture } from "../../scripts/cleanup-ci-smoke-bt-aba";

const marker = "bt-aba-proof-1234";
const ids = {
  actorId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  clientId: "33333333-3333-4333-8333-333333333333",
  programId: "44444444-4444-4444-8444-444444444444",
  goalId: "55555555-5555-4555-8555-555555555555",
  authorizationId: "66666666-6666-4666-8666-666666666666",
  authorizationServiceId: "77777777-7777-4777-8777-777777777777",
};
const sessionId = "88888888-8888-4888-8888-888888888888";

const clientMock = (authMarker = marker, programOrganizationId = ids.organizationId, discoverSession = false) => {
  const deletes: string[] = [];
  let authDeleted = false;
  const rows: Record<string, unknown> = {
    organizations: { id: ids.organizationId, name: `BT proof ${marker}`, slug: `bt-proof-${marker}`, metadata: {} },
    profiles: { id: ids.actorId, organization_id: ids.organizationId, role: "bt", is_active: true },
    therapists: { id: ids.actorId, organization_id: ids.organizationId, email: `playwright.${marker}@example.com`, full_name: `BT ${marker}`, title: "BT", status: "active", deleted_at: null },
    clients: { id: ids.clientId, organization_id: ids.organizationId, email: `client.${marker}@example.com`, full_name: `Client ${marker}`, notes: `Synthetic ${marker}`, status: "active", deleted_at: null },
    programs: { id: ids.programId, organization_id: programOrganizationId, client_id: ids.clientId, name: `Program ${marker}`, description: marker, status: "active", created_by: ids.actorId },
    goals: { id: ids.goalId, organization_id: ids.organizationId, client_id: ids.clientId, program_id: ids.programId, title: `Goal ${marker}`, description: marker, original_text: marker, status: "active", created_by: ids.actorId },
    authorizations: { id: ids.authorizationId, authorization_number: `AUTH-${marker}`, diagnosis_description: marker, organization_id: ids.organizationId, client_id: ids.clientId, provider_id: ids.actorId, status: "approved", start_date: "2000-01-01", end_date: "2099-01-01", created_by: ids.actorId },
    authorization_services: { id: ids.authorizationServiceId, service_description: marker, unit_type: marker, organization_id: ids.organizationId, authorization_id: ids.authorizationId, service_code: "97153", decision_status: "approved", from_date: "2000-01-01", to_date: "2099-01-01", created_by: ids.actorId },
    sessions: { id: sessionId, notes: marker, client_id: ids.clientId, therapist_id: ids.actorId },
  };
  const client = {
    from: (table: string) => ({
      delete: () => ({ eq: async (column: string, value: string) => {
        deletes.push(`${table}.${column}=${value}`);
        return { error: null };
      } }),
      select: (_columns: string, options?: { head?: boolean }) => ({
        match: async () => ({ data: discoverSession ? [rows.sessions] : [], error: null }),
        eq: (_column: string, _value: string) => table === "user_roles"
          ? Promise.resolve({ data: [{ is_active: true, expires_at: "2099-01-01T00:00:00.000Z", roles: { name: "bt" } }], error: null })
          : options?.head
          ? Promise.resolve({ error: null, count: 0 })
          : { maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) },
      }),
    }),
    auth: { admin: {
      getUserById: async () => authDeleted
        ? ({ data: { user: null }, error: { message: "not found" } })
        : ({ data: { user: { user_metadata: { fixture_marker: authMarker }, app_metadata: { fixture_marker: authMarker } } }, error: null }),
      deleteUser: async () => { authDeleted = true; deletes.push(`auth.users.id=${ids.actorId}`); return { error: null }; },
    } },
  } as unknown as SupabaseClient;
  return { client, deletes };
};

describe("marker-owned BT fixture cleanup", () => {
  it("deletes session audit/note dependencies before the exact graph and auth user", async () => {
    const { client, deletes } = clientMock();
    await cleanupMarkerOwnedBtFixture(client, ids, marker, sessionId);

    expect(deletes.slice(0, 3)).toEqual([
      `client_session_notes.session_id=${sessionId}`,
      `session_goals.session_id=${sessionId}`,
      `sessions.id=${sessionId}`,
    ]);
    expect(deletes.at(-1)).toBe(`auth.users.id=${ids.actorId}`);
  });

  it("fails closed before any delete when auth marker ownership is not exact", async () => {
    const { client, deletes } = clientMock("another-marker");
    await expect(cleanupMarkerOwnedBtFixture(client, ids, marker, null)).rejects.toThrow(/not owned/);
    expect(deletes).toEqual([]);
  });

  it("discovers and removes the exact marked session when private state was never written", async () => {
    const { client, deletes } = clientMock(marker, ids.organizationId, true);
    await cleanupMarkerOwnedBtFixture(client, ids, marker, null);
    expect(deletes).toContain(`sessions.id=${sessionId}`);
  });

  it("fails closed before any delete when an exported child ID crosses tenant scope", async () => {
    const { client, deletes } = clientMock(marker, "99999999-9999-4999-8999-999999999999");
    await expect(cleanupMarkerOwnedBtFixture(client, ids, marker, null)).rejects.toThrow(/program organization/i);
    expect(deletes).toEqual([]);
  });
});
