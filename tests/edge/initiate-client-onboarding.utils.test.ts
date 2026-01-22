import { describe, expect, it } from "vitest";
import { __TESTING__ } from "../../supabase/functions/initiate-client-onboarding/index.ts";

describe("initiate-client-onboarding helpers", () => {
  it("normalizes client names into first/last", () => {
    const parsed = __TESTING__.parseClientName("Ada Lovelace");
    expect(parsed).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  it("trims and filters service preferences", () => {
    const cleaned = __TESTING__.sanitizeServicePreference([" ABA ", " ", "Speech"]);
    expect(cleaned).toEqual(["ABA", "Speech"]);
  });
});
