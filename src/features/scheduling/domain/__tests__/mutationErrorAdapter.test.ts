import { describe, expect, it } from "vitest";
import { adaptScheduleMutationError } from "../mutationErrorAdapter";

describe("mutationErrorAdapter", () => {
  it("adapts 409 errors with conflict hint and composed user message", () => {
    const adapted = adaptScheduleMutationError({
      status: 409,
      message: "Conflict",
      retryHint: "slot conflict",
    });

    expect(adapted.lifecyclePlan).toEqual({
      phase: "error",
      errorKind: "conflict",
      resetBranch: {
        kind: "mutation-error",
        retryHint: "slot conflict",
        source: "409",
      },
    });
    expect(adapted.userMessage).toBe("Conflict. slot conflict");
    expect(adapted.conflictLogMetadata).toEqual({
      hint: "slot conflict",
      error: "Conflict",
    });
  });

  it("adapts non-409 errors to non-conflict behavior", () => {
    const adapted = adaptScheduleMutationError({
      status: 500,
      message: "Server error",
      retryHint: "should-not-be-used",
    });

    expect(adapted.lifecyclePlan).toEqual({
      phase: "error",
      errorKind: "non-conflict",
      resetBranch: {
        kind: "mutation-error",
        retryHint: null,
        source: "non409",
      },
    });
    expect(adapted.userMessage).toBeInstanceOf(Error);
    expect((adapted.userMessage as Error).message).toBe("Server error");
    expect(adapted.conflictLogMetadata).toBeNull();
  });

  it("uses fallback normalization for unknown errors", () => {
    const adapted = adaptScheduleMutationError(null);

    expect(adapted.normalized.message).toBe("Schedule mutation failed");
    expect(adapted.lifecyclePlan.errorKind).toBe("non-conflict");
    expect(adapted.conflictLogMetadata).toBeNull();
  });

  it("surfaces SESSION_NOTES_REQUIRED (409) as a conflict with only the backend message — no slot-booking hint", () => {
    // Simulates a NormalizedApiError produced by toNormalizedApiError() when
    // sessions-complete returns { code: "SESSION_NOTES_REQUIRED", status: 409 }.
    const error = Object.assign(
      new Error("Session notes with goal progress are required before closing this session."),
      { status: 409, code: "SESSION_NOTES_REQUIRED" },
    );

    const adapted = adaptScheduleMutationError(error);

    expect(adapted.lifecyclePlan.errorKind).toBe("conflict");
    expect(adapted.lifecyclePlan.resetBranch.source).toBe("409");
    // userMessage must be exactly the backend message — the generic slot-booking
    // hint is misleading for this code and must NOT be appended.
    expect(adapted.userMessage).toBe(
      "Session notes with goal progress are required before closing this session.",
    );
    expect(adapted.userMessage as string).not.toContain("time slot was just booked");
  });

  it("still appends the slot-booking hint for generic 409 conflicts (non-SESSION_NOTES_REQUIRED)", () => {
    // A regular scheduling conflict (no code) must still get the composed hint.
    const adapted = adaptScheduleMutationError({
      status: 409,
      message: "Conflict",
      retryHint: "choose a different slot",
    });

    expect(adapted.lifecyclePlan.errorKind).toBe("conflict");
    expect(typeof adapted.userMessage).toBe("string");
    // The hint should be appended for generic 409s.
    expect(adapted.userMessage as string).toContain("choose a different slot");
  });
});
