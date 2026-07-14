import { describe, expect, it, vi } from "vitest";
import {
  assertSmokeBcbaAuthorizationInvariant,
  assertDedicatedSmokeBcbaEmail,
  assertSmokeBcbaProfileInvariant,
  buildDefaultSmokeBcbaEmail,
  getMissingBcbaProvisionSecrets,
  shouldSkipSecretlessPullRequest,
  resolveSmokeBcbaClientId,
  verifySmokeBcbaAuthenticatedReadiness,
} from "../../scripts/provision-ci-smoke-bcba";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("provision-ci-smoke-bcba guards", () => {
  it("only accepts dedicated disposable BCBA emails", () => {
    expect(() => assertDedicatedSmokeBcbaEmail("playwright.ci.bcba.123.1@example.com")).not.toThrow();
    expect(() => assertDedicatedSmokeBcbaEmail("bcba@example.com")).toThrow(/Refusing/);
  });

  it("builds a dedicated email", () => {
    expect(buildDefaultSmokeBcbaEmail()).toMatch(/^playwright\.ci\.bcba\..+@example\.com$/);
  });

  it("skips only secretless pull requests", () => {
    const env = { GITHUB_EVENT_NAME: "pull_request" } as NodeJS.ProcessEnv;
    expect(getMissingBcbaProvisionSecrets(env)).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(getMissingBcbaProvisionSecrets(env, true)).toEqual([
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
    ]);
    expect(shouldSkipSecretlessPullRequest(env)).toBe(true);
    expect(shouldSkipSecretlessPullRequest({ ...env, GITHUB_EVENT_NAME: "push" })).toBe(false);
  });

  it("requires the persisted synthetic profile to retain BCBA tenant context", () => {
    const expected = { userId: "user-1", organizationId: "org-1" };
    expect(() => assertSmokeBcbaProfileInvariant({
      id: "user-1",
      role: "bcba",
      is_active: true,
      organization_id: "org-1",
    }, expected)).not.toThrow();

    for (const profile of [
      null,
      { id: "user-1", role: "client", is_active: true, organization_id: "org-1" },
      { id: "user-1", role: "bcba", is_active: true, organization_id: null },
      { id: "user-1", role: "bcba", is_active: false, organization_id: "org-1" },
    ]) {
      expect(() => assertSmokeBcbaProfileInvariant(profile, expected)).toThrow(/did not persist/);
    }
  });

  it("requires the synthetic authorization to remain approved and tenant-bound", () => {
    const expected = { clientId: "client-1", therapistId: "therapist-1", organizationId: "org-1" };
    expect(() => assertSmokeBcbaAuthorizationInvariant({
      client_id: "client-1",
      provider_id: "therapist-1",
      organization_id: "org-1",
      status: "approved",
    }, expected)).not.toThrow();

    for (const authorization of [
      null,
      { client_id: "client-2", provider_id: "therapist-1", organization_id: "org-1", status: "approved" },
      { client_id: "client-1", provider_id: "therapist-2", organization_id: "org-1", status: "approved" },
      { client_id: "client-1", provider_id: "therapist-1", organization_id: "org-2", status: "approved" },
      { client_id: "client-1", provider_id: "therapist-1", organization_id: "org-1", status: "pending" },
    ]) {
      expect(() => assertSmokeBcbaAuthorizationInvariant(authorization, expected)).toThrow(/did not persist/);
    }
  });

  it("resolves the one client shared by same-tenant sessions and approved authorizations", () => {
    const expected = { therapistId: "therapist-1", organizationId: "org-1" };
    expect(resolveSmokeBcbaClientId([
      { client_id: "client-2", therapist_id: "therapist-1", organization_id: "org-1" },
      { client_id: "client-1", therapist_id: "therapist-1", organization_id: "org-1" },
    ], [
      { client_id: "client-1", provider_id: "therapist-1", organization_id: "org-1", status: "approved" },
    ], expected)).toBe("client-1");
  });

  it.each([
    ["no common client", [{ client_id: "client-1", therapist_id: "therapist-1", organization_id: "org-1" }], []],
    ["ambiguous clients", [
      { client_id: "client-1", therapist_id: "therapist-1", organization_id: "org-1" },
      { client_id: "client-2", therapist_id: "therapist-1", organization_id: "org-1" },
    ], [
      { client_id: "client-1", provider_id: "therapist-1", organization_id: "org-1", status: "approved" },
      { client_id: "client-2", provider_id: "therapist-1", organization_id: "org-1", status: "approved" },
    ]],
    ["cross-tenant session", [{ client_id: "client-1", therapist_id: "therapist-1", organization_id: "org-2" }], [
      { client_id: "client-1", provider_id: "therapist-1", organization_id: "org-1", status: "approved" },
    ]],
    ["wrong provider", [{ client_id: "client-1", therapist_id: "therapist-1", organization_id: "org-1" }], [
      { client_id: "client-1", provider_id: "therapist-2", organization_id: "org-1", status: "approved" },
    ]],
  ])("fails closed for %s", (_label, sessions, authorizations) => {
    expect(() => resolveSmokeBcbaClientId(sessions, authorizations, {
      therapistId: "therapist-1",
      organizationId: "org-1",
    })).toThrow(/exactly one active tenant-bound client/);
  });

  it("proves authenticated organization resolution and the bounded sessions RPC", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "user-1", role: "bcba", is_active: true, organization_id: "org-1" },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
        signOut,
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      rpc,
    } as unknown as SupabaseClient;

    await expect(verifySmokeBcbaAuthenticatedReadiness(client, {
      email: "playwright.ci.bcba.1.1@example.com",
      password: "synthetic-password",
      userId: "user-1",
      organizationId: "org-1",
    })).resolves.toBeUndefined();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["get_sessions_optimized"]);
    const rpcArgs = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(rpcArgs.p_therapist_id).toBeNull();
    expect(rpcArgs.p_client_id).toBeNull();
    expect(Date.parse(String(rpcArgs.p_start_date))).not.toBeNaN();
    expect(Date.parse(String(rpcArgs.p_end_date))).not.toBeNaN();
    expect(Date.parse(String(rpcArgs.p_end_date)) - Date.parse(String(rpcArgs.p_start_date)))
      .toBe(48 * 60 * 60 * 1000);
    expect(signOut).toHaveBeenCalled();
  });

  it.each([
    ["missing org", { id: "user-1", role: "bcba", is_active: true, organization_id: null }, null, /expected organization/],
    ["sessions denied", { id: "user-1", role: "bcba", is_active: true, organization_id: "org-1" }, { code: "42501" }, /org-scoped sessions/],
  ])("fails closed when authenticated readiness reports %s", async (_label, profile, rpcError, expected) => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError });
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
        signOut,
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }),
          })),
        })),
      })),
      rpc,
    } as unknown as SupabaseClient;

    await expect(verifySmokeBcbaAuthenticatedReadiness(client, {
      email: "playwright.ci.bcba.1.1@example.com",
      password: "synthetic-password",
      userId: "user-1",
      organizationId: "org-1",
    })).rejects.toThrow(expected);
    expect(signOut).toHaveBeenCalled();
    if (_label === "missing org") expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when authenticated readiness cannot sign out", async () => {
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: { message: "logout failed" } }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "user-1", role: "bcba", is_active: true, organization_id: "org-1" },
              error: null,
            }),
          })),
        })),
      })),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as SupabaseClient;

    await expect(verifySmokeBcbaAuthenticatedReadiness(client, {
      email: "playwright.ci.bcba.1.1@example.com",
      password: "synthetic-password",
      userId: "user-1",
      organizationId: "org-1",
    })).rejects.toThrow(/logout failed/);
  });

  it("stops before profile or RPC work when authenticated readiness login fails", async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    const signOut = vi.fn();
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "denied" } }),
        signOut,
      },
      from,
      rpc,
    } as unknown as SupabaseClient;

    await expect(verifySmokeBcbaAuthenticatedReadiness(client, {
      email: "playwright.ci.bcba.1.1@example.com",
      password: "synthetic-password",
      userId: "user-1",
      organizationId: "org-1",
    })).rejects.toThrow(/login failed/);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
