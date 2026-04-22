import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getSupabaseConfig: vi.fn(() => ({
      supabaseUrl: "https://test.supabase.co",
      anonKey: "anon-key",
    })),
  };
});

import { getSupabaseConfig, resolveOrgAndRoleWithStatus } from "../api/shared";

const accessToken = "header.payload.signature";

function jsonResponse(data: unknown, status = 200): Response {
  const text = data === "" ? "" : JSON.stringify(data);
  return new Response(text, { status, headers: { "Content-Type": "application/json" } });
}

describe("P05 resolveOrgAndRoleWithStatus (untargeted RPC equivalence)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://test.supabase.co",
      anonKey: "anon-key",
    });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("calls current_user_is_super_admin, current_user_organization_id, then user_has_role_for_org for therapist/admin/org_admin/org_member", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse("org-1"))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(false));

    await resolveOrgAndRoleWithStatus(accessToken);

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/rest/v1/rpc/current_user_is_super_admin");
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain("/rest/v1/rpc/current_user_organization_id");

    const therapistInit = fetchSpy.mock.calls[2]?.[1] as RequestInit;
    const adminInit = fetchSpy.mock.calls[3]?.[1] as RequestInit;
    const orgAdminInit = fetchSpy.mock.calls[4]?.[1] as RequestInit;
    const orgMemberInit = fetchSpy.mock.calls[5]?.[1] as RequestInit;
    expect(JSON.parse(String(therapistInit.body))).toEqual({
      role_name: "therapist",
      target_organization_id: "org-1",
    });
    expect(JSON.parse(String(adminInit.body))).toEqual({
      role_name: "admin",
      target_organization_id: "org-1",
    });
    expect(JSON.parse(String(orgAdminInit.body))).toEqual({
      role_name: "org_admin",
      target_organization_id: "org-1",
    });
    expect(JSON.parse(String(orgMemberInit.body))).toEqual({
      role_name: "org_member",
      target_organization_id: "org-1",
    });
  });

  it("returns therapist + admin flags from user_has_role_for_org truth table", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse("org-1"))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(false));

    await expect(resolveOrgAndRoleWithStatus(accessToken)).resolves.toEqual({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: true,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
  });

  it("treats super-admin only when RPC returns true with OK", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse("org-1"))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(false));

    await expect(resolveOrgAndRoleWithStatus(accessToken)).resolves.toEqual({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: true,
      upstreamError: false,
    });
  });

  it("returns no org and false roles when organization RPC yields empty / invalid body", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(""));

    await expect(resolveOrgAndRoleWithStatus(accessToken)).resolves.toEqual({
      organizationId: null,
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("sets upstreamError when a role RPC returns 503", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse("org-1"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(false));

    await expect(resolveOrgAndRoleWithStatus(accessToken)).resolves.toEqual({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: true,
    });
  });
});
