import { describe, expect, it, vi } from "vitest";
import { __TESTING__ } from "../../supabase/functions/get-sessions-optimized/index.ts";
import * as orgHelpers from "../../supabase/functions/_shared/org.ts";

describe("get-sessions-optimized org scoping", () => {
  it("builds base and summary queries scoped to the organization", () => {
    const builder = { select: vi.fn(() => builder) } as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>;
    const spy = vi.spyOn(orgHelpers, "orgScopedQuery").mockReturnValue(builder);

    __TESTING__.buildSessionBaseQuery({} as any, "org-123");
    __TESTING__.buildSessionSummaryQuery({} as any, "org-123");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(expect.anything(), "sessions", "org-123");
  });
});
