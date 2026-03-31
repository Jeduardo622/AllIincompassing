import { beforeEach, describe, expect, it, vi } from "vitest";

const callEdgeFunctionHttpMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/api", () => ({
  callEdgeFunctionHttp: callEdgeFunctionHttpMock,
}));

describe("completeSessionFromModal", () => {
  beforeEach(() => {
    callEdgeFunctionHttpMock.mockReset();
  });

  it("calls sessions-complete edge function with completed outcome", async () => {
    callEdgeFunctionHttpMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { session: { id: "session-1", status: "completed" }, outcome: "completed" },
        }),
        { status: 200 },
      ),
    );

    const { completeSessionFromModal } = await import("../sessionComplete");
    await completeSessionFromModal({
      sessionId: "session-1",
      outcome: "completed",
      notes: "Session complete",
    });

    expect(callEdgeFunctionHttpMock).toHaveBeenCalledWith(
      "sessions-complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "session-1",
          outcome: "completed",
          notes: "Session complete",
        }),
      }),
    );
  });

  it("calls sessions-complete edge function with no-show outcome", async () => {
    callEdgeFunctionHttpMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { session: { id: "session-2", status: "no-show" }, outcome: "no-show" },
        }),
        { status: 200 },
      ),
    );

    const { completeSessionFromModal } = await import("../sessionComplete");
    await completeSessionFromModal({
      sessionId: "session-2",
      outcome: "no-show",
    });

    expect(callEdgeFunctionHttpMock).toHaveBeenCalledWith(
      "sessions-complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "session-2",
          outcome: "no-show",
          notes: null,
        }),
      }),
    );
  });

  it("sends null notes when notes are not provided", async () => {
    callEdgeFunctionHttpMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
    );

    const { completeSessionFromModal } = await import("../sessionComplete");
    await completeSessionFromModal({ sessionId: "session-3", outcome: "completed" });

    const calledWith = JSON.parse(
      callEdgeFunctionHttpMock.mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(calledWith.notes).toBeNull();
  });

  it("throws a normalized error on non-ok response", async () => {
    callEdgeFunctionHttpMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, error: "Session is already in a terminal state: completed", code: "ALREADY_TERMINAL" }),
        { status: 409 },
      ),
    );

    const { completeSessionFromModal } = await import("../sessionComplete");
    await expect(
      completeSessionFromModal({ sessionId: "session-4", outcome: "completed" }),
    ).rejects.toThrow();
  });

  it("throws on network/parse failure", async () => {
    callEdgeFunctionHttpMock.mockResolvedValueOnce(
      new Response("not json", { status: 500 }),
    );

    const { completeSessionFromModal } = await import("../sessionComplete");
    await expect(
      completeSessionFromModal({ sessionId: "session-5", outcome: "no-show" }),
    ).rejects.toThrow();
  });
});
