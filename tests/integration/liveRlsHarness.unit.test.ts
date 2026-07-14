import { describe, expect, it, vi } from "vitest";
import {
  buildLiveRlsAppMetadata,
  persistLiveRlsAppMetadata,
  reconcileLiveRlsRole,
} from "./_helpers/liveRlsHarness.ts";

describe("live RLS harness actor metadata", () => {
  it("marks the actor as an expiring service-created fixture", () => {
    const before = Date.now();
    const metadata = buildLiveRlsAppMetadata();
    expect(metadata.ci_rls_fixture).toBe(true);
    expect(new Date(metadata.ci_rls_expires_at).getTime()).toBeGreaterThan(before);
    expect(new Date(metadata.ci_rls_expires_at).getTime()).toBeLessThanOrEqual(before + 60 * 60 * 1000 + 1000);
  });

  it("persists and reads back the expiring marker before provisioning", async () => {
    const appMetadata = buildLiveRlsAppMetadata();
    const updateUserById = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { app_metadata: appMetadata } },
      error: null,
    });

    await persistLiveRlsAppMetadata(
      { auth: { admin: { updateUserById, getUserById } } } as never,
      "00000000-0000-4000-8000-000000000001",
      appMetadata,
    );

    expect(updateUserById).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      { app_metadata: appMetadata },
    );
    expect(getUserById).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });

  it("fails closed when Auth does not return the persisted marker", async () => {
    const updateUserById = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { app_metadata: {} } },
      error: null,
    });

    await expect(
      persistLiveRlsAppMetadata(
        { auth: { admin: { updateUserById, getUserById } } } as never,
        "00000000-0000-4000-8000-000000000001",
        buildLiveRlsAppMetadata(),
      ),
    ).rejects.toThrow("Synthetic RLS actor metadata was not persisted with an unexpired marker");
  });

  it("reconciles the complete active role set to the expected fixture role", async () => {
    const expectedRoleId = "00000000-0000-4000-8000-000000000010";
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: expectedRoleId }, error: null });
    const roleEq = vi.fn().mockReturnValue({ maybeSingle });
    const roleSelect = vi.fn().mockReturnValue({ eq: roleEq });
    const deactivateUserEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: deactivateUserEq });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const activeStatusEq = vi.fn().mockResolvedValue({
      data: [{ role_id: expectedRoleId }],
      error: null,
    });
    const activeUserEq = vi.fn().mockReturnValue({ eq: activeStatusEq });
    const activeSelect = vi.fn().mockReturnValue({ eq: activeUserEq });
    const appMetadata = buildLiveRlsAppMetadata();
    const getUserById = vi.fn().mockResolvedValue({
      data: {
        user: {
          email: "admin.fixture@example.com",
          app_metadata: appMetadata,
        },
      },
      error: null,
    });
    const from = vi.fn((table: string) =>
      table === "roles"
        ? { select: roleSelect }
        : { update, upsert, select: activeSelect },
    );

    await reconcileLiveRlsRole(
      { auth: { admin: { getUserById } }, from } as never,
      "00000000-0000-4000-8000-000000000001",
      "admin",
    );

    expect(from).toHaveBeenNthCalledWith(1, "roles");
    expect(from).toHaveBeenNthCalledWith(2, "user_roles");
    expect(from).toHaveBeenNthCalledWith(3, "user_roles");
    expect(from).toHaveBeenNthCalledWith(4, "user_roles");
    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(deactivateUserEq).toHaveBeenCalledWith(
      "user_id",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: "00000000-0000-4000-8000-000000000001",
        role_id: expectedRoleId,
        is_active: true,
        expires_at: null,
      },
      { onConflict: "user_id,role_id" },
    );
    expect(activeUserEq).toHaveBeenCalledWith(
      "user_id",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(activeStatusEq).toHaveBeenCalledWith("is_active", true);
  });
});
