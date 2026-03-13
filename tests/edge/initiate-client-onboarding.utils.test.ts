// @vitest-environment node
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

  it("hashes prefill tokens deterministically", async () => {
    const token = "6de4a43f-7a9b-4c56-a5c6-8a4a6efd09ff";
    const first = await __TESTING__.hashPrefillToken(token);
    const second = await __TESTING__.hashPrefillToken(token);
    expect(first).toHaveLength(64);
    expect(first).toEqual(second);
  });
});

