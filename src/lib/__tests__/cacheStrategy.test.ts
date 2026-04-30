import { describe, expect, it } from "vitest";
import { generateCacheKey } from "../cacheStrategy";

describe("generateCacheKey.sessions", () => {
  it("scopes session query keys by organization", () => {
    expect(
      generateCacheKey.sessions(
        "2026-03-30T00:00:00.000Z",
        "2026-04-06T00:00:00.000Z",
        "therapist-1",
        "client-1",
        "org-a",
      ),
    ).toEqual([
      "sessions",
      "org-a",
      "2026-03-30T00:00:00.000Z",
      "2026-04-06T00:00:00.000Z",
      "therapist-1",
      "client-1",
    ]);
  });
});
