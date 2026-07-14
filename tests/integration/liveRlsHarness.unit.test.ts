import { describe, expect, it, vi } from "vitest";
import {
  buildLiveRlsAppMetadata,
  persistLiveRlsAppMetadata,
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
});
