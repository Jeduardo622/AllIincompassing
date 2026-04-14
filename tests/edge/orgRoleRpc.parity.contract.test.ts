// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { assertUserHasOrgRole, resolveOrgId } from "../../supabase/functions/_shared/org.ts";

describe("P05 edge org RPC payload parity (untargeted)", () => {
  it("resolveOrgId invokes current_user_organization_id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "org-from-rpc", error: null });
    const db = { rpc } as any;
    await expect(resolveOrgId(db)).resolves.toBe("org-from-rpc");
    expect(rpc).toHaveBeenCalledWith("current_user_organization_id");
  });

  it("assertUserHasOrgRole uses the same untargeted payload shape as server role POSTs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const db = { rpc } as any;
    await assertUserHasOrgRole(db, "org-1", "therapist", {});
    expect(rpc).toHaveBeenCalledWith("user_has_role_for_org", {
      role_name: "therapist",
      target_organization_id: "org-1",
    });
  });
});
