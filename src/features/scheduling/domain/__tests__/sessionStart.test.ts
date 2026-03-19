import { beforeEach, describe, expect, it, vi } from "vitest";

const callEdgeFunctionHttpMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/api", () => ({
  callEdgeFunctionHttp: callEdgeFunctionHttpMock,
}));

describe("startSessionFromModal", () => {
  beforeEach(() => {
    callEdgeFunctionHttpMock.mockReset();
  });

  it("throws when request does not satisfy schema constraints", async () => {
    const { startSessionFromModal } = await import("../sessionStart");
    await expect(
      startSessionFromModal({
        sessionId: "not-a-uuid",
        programId: "not-a-uuid",
        goalId: "not-a-uuid",
      }),
    ).rejects.toThrow("Invalid session start request");
    expect(callEdgeFunctionHttpMock).not.toHaveBeenCalled();
  });

  it("calls edge function when payload is valid", async () => {
    callEdgeFunctionHttpMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: true,
        data: {
          id: "session-1",
          started_at: "2026-03-20T15:00:00.000Z",
        },
      }), { status: 200 }),
    );

    const { startSessionFromModal } = await import("../sessionStart");
    await startSessionFromModal({
      sessionId: "11111111-1111-1111-1111-111111111111",
      programId: "22222222-2222-2222-2222-222222222222",
      goalId: "33333333-3333-3333-3333-333333333333",
      goalIds: ["44444444-4444-4444-4444-444444444444"],
    });

    expect(callEdgeFunctionHttpMock).toHaveBeenCalledWith(
      "sessions-start",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});

