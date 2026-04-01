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

  it("surfaces SESSION_NOTES_REQUIRED (409) as a conflict with the backend message", () => {
    // Simulates a NormalizedApiError produced by toNormalizedApiError() when
    // sessions-complete returns { code: "SESSION_NOTES_REQUIRED", status: 409 }.
    const error = Object.assign(
      new Error("Session notes with goal progress are required before closing this session."),
      { status: 409, code: "SESSION_NOTES_REQUIRED" },
    );

    const adapted = adaptScheduleMutationError(error);

    expect(adapted.lifecyclePlan.errorKind).toBe("conflict");
    expect(adapted.lifecyclePlan.resetBranch.source).toBe("409");
    // userMessage is a composed string beginning with the backend message text.
    expect(typeof adapted.userMessage).toBe("string");
    expect(adapted.userMessage as string).toContain(
      "Session notes with goal progress are required",
    );
  });
});
