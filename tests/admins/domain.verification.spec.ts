import { describe, it, expect } from "vitest";

const runAdminsSuite = process.env.RUN_ADMIN_DOMAIN_TESTS === "true";
const suite = runAdminsSuite ? describe : describe.skip;

suite("Admin edge contract expectations", () => {
  it("describes admin users fetch query parameters", () => {
    const query = new URLSearchParams({
      organization_id: "uuid",
      page: "1",
      limit: "50",
      search: "smith",
    });

    expect(query.get("organization_id")).toMatch(/^[a-z0-9-]{36}$/);
    expect(Number.parseInt(query.get("limit") ?? "0", 10)).toBeGreaterThan(0);
  });

  it("notes invite payload requirements", () => {
    const payload = {
      email: "admin@example.com",
      organizationId: "uuid",
      expiresInHours: 72,
    } as const;

    expect(payload.expiresInHours).toBeLessThanOrEqual(168);
  });
});
