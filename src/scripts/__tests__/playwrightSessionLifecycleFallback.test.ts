import { describe, expect, it } from "vitest";

import { isAlreadyTerminalLifecycleFallbackResponse } from "../playwrightSessionLifecycleFallback";

describe("playwrightSessionLifecycleFallback", () => {
  it("accepts already-terminal conflicts from the authenticated fallback API", () => {
    expect(isAlreadyTerminalLifecycleFallbackResponse(
      409,
      JSON.stringify({
        success: false,
        error: "Session is already in a terminal state: completed",
        code: "ALREADY_TERMINAL",
      }),
    )).toBe(true);
  });

  it("does not accept unrelated fallback failures", () => {
    expect(isAlreadyTerminalLifecycleFallbackResponse(
      409,
      JSON.stringify({
        success: false,
        error: "Session notes are required",
        code: "SESSION_NOTES_REQUIRED",
      }),
    )).toBe(false);
    expect(isAlreadyTerminalLifecycleFallbackResponse(500, "{\"code\":\"ALREADY_TERMINAL\"}")).toBe(false);
  });
});
