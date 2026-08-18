/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertSmokeBcbaCleanupOwnership,
  assertSmokeBcbaOwnership,
  assertSmokeBcbaRoleInvariant,
  assertSmokeBcbaAuthorizationInvariant,
  assertDedicatedSmokeBcbaEmail,
  assertSmokeBcbaProfileInvariant,
  buildDefaultSmokeBcbaEmail,
  buildSmokeBcbaAppMetadata,
  buildSmokeBcbaProfileSeed,
  buildSmokeBcbaRoleAssignment,
  getMissingBcbaProvisionSecrets,
  shouldSkipSecretlessPullRequest,
  resolveSmokeBcbaClientId,
  serializeSmokeBcbaError,
  verifySmokeBcbaAuthenticatedReadiness,
} from "../../scripts/provision-ci-smoke-bcba";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("provision-ci-smoke-bcba guards", () => {
  it("uses verified canonical mappings before the service-only profile authority RPC", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "scripts/provision-ci-smoke-bcba.ts"),
      "utf8",
    );
    const actorLookup = source.indexOf("let user = await findUser(client, email)");
    const rollbackBoundary = source.indexOf("try {", actorLookup);
    const reusedActorCleanup = source.indexOf("await cleanupMappings(client, user.id)", actorLookup);
    const freshActorCreate = source.indexOf("client.auth.admin.createUser(", reusedActorCleanup);
    const ownershipReadback = source.indexOf("client.auth.admin.getUserById(userId)");
    const profileSeed = source.indexOf("buildSmokeBcbaProfileSeed(userId, email)");
    const staleRoleCleanup = source.indexOf('.from("user_roles").delete().eq("user_id", userId)');
    const roleMapping = source.indexOf("buildSmokeBcbaRoleAssignment(");
    const roleReadback = source.indexOf('.from("user_roles")\n      .select("role_id,is_active,expires_at")');
    const therapistLink = source.indexOf('.from("user_therapist_links").insert(');
    const profileProvision = source.indexOf('.rpc("provision_ci_smoke_bcba_profile"');

    expect(rollbackBoundary).toBeGreaterThan(actorLookup);
    expect(reusedActorCleanup).toBeGreaterThan(rollbackBoundary);
    expect(freshActorCreate).toBeGreaterThan(reusedActorCleanup);
    expect(ownershipReadback).toBeGreaterThan(-1);
    expect(profileSeed).toBeGreaterThan(ownershipReadback);
    expect(staleRoleCleanup).toBeGreaterThan(profileSeed);
    expect(roleMapping).toBeGreaterThan(staleRoleCleanup);
    expect(roleReadback).toBeGreaterThan(roleMapping);
    expect(therapistLink).toBeGreaterThan(roleReadback);
    expect(profileProvision).toBeGreaterThan(therapistLink);
    expect(source).toContain('ownershipReadbackError ? serializeSmokeBcbaError(ownershipReadbackError) : "missing user"');
    expect(source).toContain('organization mismatch (${String(provisionedOrganizationId)})');
  });

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

  it("seeds the profile without bypassing protected role or organization authority", () => {
    expect(buildSmokeBcbaProfileSeed("user-1", "playwright.ci.bcba.1.1@example.com")).toEqual({
      id: "user-1",
      email: "playwright.ci.bcba.1.1@example.com",
      first_name: "Playwright",
      last_name: "BCBA",
    });
  });

  it("builds an expiring authoritative BCBA role assignment", () => {
    expect(buildSmokeBcbaRoleAssignment("user-1", "role-1", "2026-08-18T01:00:00.000Z")).toEqual({
      user_id: "user-1",
      role_id: "role-1",
      is_active: true,
      expires_at: "2026-08-18T01:00:00.000Z",
    });
  });

  it("requires exact run ownership and an unexpired marker", () => {
    const email = "playwright.ci.bcba.123.2@example.com";
    const env = {
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_JOB: "auth-browser-smoke",
    } as NodeJS.ProcessEnv;
    const now = new Date("2026-08-17T23:00:00.000Z");
    const appMetadata = buildSmokeBcbaAppMetadata(email, env, now);

    expect(appMetadata).toEqual({
      smoke_actor: "bcba",
      smoke_email: email,
      smoke_run_id: "123",
      smoke_run_attempt: "2",
      smoke_job: "auth-browser-smoke",
      smoke_expires_at: "2026-08-18T05:00:00.000Z",
    });
    expect(() => assertSmokeBcbaOwnership({ email, app_metadata: appMetadata }, email, appMetadata, now)).not.toThrow();
    expect(() => assertSmokeBcbaOwnership({
      email,
      app_metadata: { ...appMetadata, smoke_expires_at: "2026-08-18T04:00:00.000Z" },
    }, email, appMetadata, now)).not.toThrow();
    expect(() => assertSmokeBcbaOwnership({
      email,
      app_metadata: { ...appMetadata, smoke_actor: "admin" },
    }, email, appMetadata, now)).toThrow(/ownership/);
    expect(() => assertSmokeBcbaOwnership({
      email,
      app_metadata: { ...appMetadata, smoke_expires_at: "2026-08-17T22:59:59.000Z" },
    }, email, appMetadata, now)).toThrow(/ownership/);
  });

  it("allows marker-scoped cleanup from a later run without broadening actor ownership", () => {
    const email = "playwright.ci.bcba.123.2@example.com";
    const earlierRunMetadata = buildSmokeBcbaAppMetadata(email, {
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_JOB: "auth-browser-smoke",
    }, new Date("2026-08-17T20:00:00.000Z"));

    expect(() => assertSmokeBcbaCleanupOwnership({
      email,
      app_metadata: earlierRunMetadata,
    }, email)).not.toThrow();
    expect(() => assertSmokeBcbaCleanupOwnership({
      email,
      app_metadata: {
        smoke_actor: "bcba",
        smoke_expires_at: "2026-08-17T19:59:59.000Z",
      },
    }, email)).not.toThrow();
    expect(() => assertSmokeBcbaCleanupOwnership({
      email,
      app_metadata: { ...earlierRunMetadata, smoke_actor: "admin" },
    }, email)).toThrow(/cleanup ownership/);
    expect(() => assertSmokeBcbaCleanupOwnership({
      email,
      app_metadata: { ...earlierRunMetadata, smoke_email: "playwright.ci.bcba.other@example.com" },
    }, email)).toThrow(/cleanup ownership/);
  });

  it("requires the exact active unexpired BCBA role singleton", () => {
    const expected = { roleId: "role-1", expiresAt: "2026-08-18T01:00:00.000Z" };
    expect(() => assertSmokeBcbaRoleInvariant([{
      role_id: "role-1",
      is_active: true,
      expires_at: expected.expiresAt,
    }], expected, new Date("2026-08-17T23:00:00.000Z"))).not.toThrow();
    expect(() => assertSmokeBcbaRoleInvariant([], expected)).toThrow(/role singleton/);
    expect(() => assertSmokeBcbaRoleInvariant([
      { role_id: "role-1", is_active: true, expires_at: expected.expiresAt },
      { role_id: "role-2", is_active: true, expires_at: expected.expiresAt },
    ], expected)).toThrow(/role singleton/);
  });

  it("preserves structured Supabase failures in CI output", () => {
    const serialized = serializeSmokeBcbaError({
      code: "42501",
      message: "organization_id is immutable for this role",
      details: "profile authority guard",
    });
    expect(serialized).toBe("42501: organization_id is immutable for this role");
    expect(serialized).not.toContain("profile authority guard");
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
