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

import {
  currentUserCanCaptureTrialEvent,
  currentUserCanManageLockedTrialEvent,
  currentUserCanManageProgramsGoals,
  currentUserCanTakeClientData,
  currentUserIsBcbaForOrg,
  getSupabaseConfig,
  resolveOrgAndRoleWithStatus,
  resolveSchedulingOrgAndRoleWithStatus,
  sessionHasLockedNote,
} from "../api/shared";
import type { Database } from "../../lib/generated/database.types";

const accessToken = "header.payload.signature";
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    if (typeof originalServiceRoleKey === "string") {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
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

  it("checks program-goal management through the exposed capability RPC, not broad role aliases", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(true));

    await expect(currentUserCanManageProgramsGoals(accessToken, "org-1")).resolves.toEqual({
      allowed: true,
      upstreamError: false,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/rest/v1/rpc/current_user_can_manage_programs_goals");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ target_organization_id: "org-1" });
  });

  it("checks exact persisted BCBA authority within the requested organization", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(true));

    await expect(currentUserIsBcbaForOrg(accessToken, "org-1")).resolves.toEqual({
      allowed: true,
      upstreamError: false,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/rest/v1/rpc/user_has_role_for_org");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      role_name: "bcba",
      target_organization_id: "org-1",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${accessToken}`);
  });

  it("checks trial-event capture and lock helpers through exposed public RPC wrappers", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(false))
      .mockResolvedValueOnce(jsonResponse(true));

    await expect(currentUserCanTakeClientData(accessToken, "org-1", "client-1")).resolves.toEqual({
      allowed: true,
      upstreamError: false,
    });
    await expect(currentUserCanCaptureTrialEvent(accessToken, "org-1", "client-1")).resolves.toEqual({
      allowed: true,
      upstreamError: false,
    });
    await expect(currentUserCanManageLockedTrialEvent(accessToken, "org-1")).resolves.toEqual({
      allowed: false,
      upstreamError: false,
    });
    await expect(sessionHasLockedNote(accessToken, "session-1")).resolves.toEqual({
      locked: true,
      upstreamError: false,
    });

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/rest/v1/rpc/current_user_can_take_client_data");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      target_organization_id: "org-1",
      target_client_id: "client-1",
    });
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain("/rest/v1/rpc/current_user_can_capture_trial_event");
    expect(JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      target_organization_id: "org-1",
      target_client_id: "client-1",
    });
    expect(String(fetchSpy.mock.calls[2]?.[0])).toContain("/rest/v1/rpc/current_user_can_manage_locked_trial_event");
    expect(JSON.parse(String((fetchSpy.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      target_organization_id: "org-1",
    });
    expect(String(fetchSpy.mock.calls[3]?.[0])).toContain("/rest/v1/rpc/session_has_locked_note");
    expect(JSON.parse(String((fetchSpy.mock.calls[3]?.[1] as RequestInit).body))).toEqual({
      target_session_id: "session-1",
    });
  });

  it("treats non-OK capability and lock RPC responses as upstream validation failures", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "42501" }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "42501" }), { status: 403 }));

    await expect(currentUserCanManageProgramsGoals(accessToken, "org-1")).resolves.toEqual({
      allowed: false,
      upstreamError: true,
    });
    await expect(currentUserCanTakeClientData(accessToken, "org-1", "client-1")).resolves.toEqual({
      allowed: false,
      upstreamError: true,
    });
    await expect(currentUserCanCaptureTrialEvent(accessToken, "org-1", "client-1")).resolves.toEqual({
      allowed: false,
      upstreamError: true,
    });
    await expect(currentUserCanManageLockedTrialEvent(accessToken, "org-1")).resolves.toEqual({
      allowed: false,
      upstreamError: true,
    });
    await expect(sessionHasLockedNote(accessToken, "session-1")).resolves.toEqual({
      locked: true,
      upstreamError: true,
    });
  });

  it("keeps generated database types in sync with public trial-event helper RPC wrappers", () => {
    type PublicFunctions = keyof Database["public"]["Functions"];
    const requiredFunctions: PublicFunctions[] = [
      "current_user_can_capture_trial_event",
      "current_user_can_take_client_data",
      "current_user_can_manage_locked_trial_event",
      "session_has_locked_note",
    ];

    expect(requiredFunctions).toEqual([
      "current_user_can_capture_trial_event",
      "current_user_can_take_client_data",
      "current_user_can_manage_locked_trial_event",
      "session_has_locked_note",
    ]);
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

  it("derives scheduling org context from the target therapist for super-admins without direct org context", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(""))
      .mockResolvedValueOnce(jsonResponse([{ organization_id: "org-therapist" }]));

    await expect(resolveSchedulingOrgAndRoleWithStatus(accessToken, "therapist-1")).resolves.toEqual({
      organizationId: "org-therapist",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: true,
      upstreamError: false,
      resolvedViaServiceRole: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(String(fetchSpy.mock.calls[2]?.[0])).toContain("/rest/v1/therapists?select=organization_id&id=eq.therapist-1");
    const init = fetchSpy.mock.calls[2]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${accessToken}`);
  });

  it("uses service-role therapist lookup only for super-admin scheduling fallback when direct scope is absent", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(""))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }))
      .mockResolvedValueOnce(jsonResponse([{ organization_id: "org-service-scope" }]));

    await expect(resolveSchedulingOrgAndRoleWithStatus(accessToken, "therapist-2")).resolves.toEqual({
      organizationId: "org-service-scope",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: true,
      upstreamError: false,
      resolvedViaServiceRole: true,
    });
    const init = fetchSpy.mock.calls[3]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).apikey).toBe("service-role-key");
  });

  it("clears fallback-specific upstream error state when service-role therapist lookup resolves the org", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(""))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([{ organization_id: "org-service-scope" }]));

    await expect(resolveSchedulingOrgAndRoleWithStatus(accessToken, "therapist-503")).resolves.toEqual({
      organizationId: "org-service-scope",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: true,
      upstreamError: false,
      resolvedViaServiceRole: true,
    });
  });

  it("fails closed for super-admin scheduling fallback when no direct org and no therapist target scope resolve", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(""))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(resolveSchedulingOrgAndRoleWithStatus(accessToken, "therapist-missing")).resolves.toEqual({
      organizationId: null,
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: true,
      upstreamError: false,
      resolvedViaServiceRole: false,
    });
  });
});
