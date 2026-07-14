import { describe, expect, it } from "vitest";
import { buildLiveRlsProfileFixture } from "./_helpers/liveRlsHarness.ts";

describe("live RLS harness profile fixtures", () => {
  it("keeps tenant and role state explicit for privileged actors", () => {
    expect(buildLiveRlsProfileFixture({
      userId: "admin-1",
      email: "admin@example.com",
      organizationId: "org-1",
      role: "admin",
    })).toEqual({
      id: "admin-1",
      email: "admin@example.com",
      organization_id: "org-1",
      role: "admin",
      is_active: true,
    });
  });

  it("keeps no-org outsiders fail-closed without inventing a privileged role", () => {
    expect(buildLiveRlsProfileFixture({
      userId: "outsider-1",
      email: "outsider@example.com",
      organizationId: null,
      role: "none",
    })).toMatchObject({
      organization_id: null,
      role: "client",
      is_active: true,
    });
  });
});
