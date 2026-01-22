import { describe, expect, it, vi } from "vitest";
import { __TESTING__ } from "../../supabase/functions/get-dropdown-data/index.ts";
import * as orgHelpers from "../../supabase/functions/_shared/org.ts";

type SelectResult = { data: unknown[]; error: null };

const makeBuilder = (result: SelectResult) => {
  const chained: Record<string, any> = {};
  const chain = () => chained;

  chained.select = vi.fn(() => chain());
  chained.is = vi.fn(() => chain());
  chained.eq = vi.fn(() => chain());
  chained.order = vi.fn(() => Promise.resolve(result));

  return chained;
};

describe("get-dropdown-data org scoping", () => {
  it("scopes therapist and client queries by organization", async () => {
    const builder = makeBuilder({ data: [], error: null });
    const spy = vi.spyOn(orgHelpers, "orgScopedQuery").mockImplementation(
      () => builder as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    await __TESTING__.fetchDropdownData(
      {} as any,
      "org-123",
      false,
      ["therapists", "clients"],
    );

    expect(spy).toHaveBeenCalledWith(expect.anything(), "therapists", "org-123");
    expect(spy).toHaveBeenCalledWith(expect.anything(), "clients", "org-123");
    expect(builder.eq).toHaveBeenCalledWith("status", "active");
  });
});
