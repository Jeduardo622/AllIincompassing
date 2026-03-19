import { describe, expect, it } from "vitest";
import { toNormalizedApiError } from "../sdk/errors";

describe("toNormalizedApiError", () => {
  it("prefers payload error message and preserves metadata", () => {
    const error = toNormalizedApiError(
      {
        error: "Conflict detected",
        code: "THERAPIST_CONFLICT",
        hint: "Choose another time",
        retryAfter: "2026-03-19T12:00:00.000Z",
        retryAfterSeconds: 30,
        orchestration: { step: "hold" },
      },
      409,
      "Fallback message",
    );

    expect(error.message).toBe("Conflict detected");
    expect(error.status).toBe(409);
    expect(error.code).toBe("THERAPIST_CONFLICT");
    expect(error.hint).toBe("Choose another time");
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.orchestration).toEqual({ step: "hold" });
  });

  it("falls back to supplied fallback message when payload is null", () => {
    const error = toNormalizedApiError(null, 500, "Request failed");
    expect(error.message).toBe("Request failed");
    expect(error.status).toBe(500);
    expect(error.retryAfter).toBeNull();
    expect(error.retryAfterSeconds).toBeNull();
  });
});
