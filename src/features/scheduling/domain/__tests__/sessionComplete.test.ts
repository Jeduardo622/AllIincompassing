import { beforeEach, describe, expect, it, vi } from "vitest";

const callApiMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/api", () => ({
  callApi: callApiMock,
}));

vi.mock("../../../../lib/supabase", () => ({
  supabase: {
    from: supabaseFromMock,
  },
}));

describe("completeSessionFromModal", () => {
  beforeEach(() => {
    callApiMock.mockReset();
    supabaseFromMock.mockReset();
  });

  it("calls sessions-complete edge function with completed outcome", async () => {
    callApiMock.mockResolvedValueOnce(
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

    expect(callApiMock).toHaveBeenCalledWith(
      "/api/sessions-complete",
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
    callApiMock.mockResolvedValueOnce(
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

    expect(callApiMock).toHaveBeenCalledWith(
      "/api/sessions-complete",
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
    callApiMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
    );

    const { completeSessionFromModal } = await import("../sessionComplete");
    await completeSessionFromModal({ sessionId: "session-3", outcome: "completed" });

    const calledWith = JSON.parse(
      callApiMock.mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(calledWith.notes).toBeNull();
  });

  it("throws a normalized error on non-ok response", async () => {
    callApiMock.mockResolvedValueOnce(
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
    callApiMock.mockResolvedValueOnce(
      new Response("not json", { status: 500 }),
    );

    const { completeSessionFromModal } = await import("../sessionComplete");
    await expect(
      completeSessionFromModal({ sessionId: "session-5", outcome: "no-show" }),
    ).rejects.toThrow();
  });
});

const createFromResponse = (result: { data: unknown; error: unknown }) => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve(result)),
    })),
  })),
});

describe("checkInProgressSessionCloseReadiness", () => {
  beforeEach(() => {
    supabaseFromMock.mockReset();
  });

  it("returns not ready when required goal notes coverage is missing", async () => {
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "session_goals") {
        return createFromResponse({
          data: [{ goal_id: "goal-1" }, { goal_id: "goal-2" }],
          error: null,
        });
      }
      if (table === "client_session_notes") {
        return createFromResponse({
          data: [{ goal_notes: { "goal-1": "Covered", "goal-2": "   " } }],
          error: null,
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const { checkInProgressSessionCloseReadiness } = await import("../sessionComplete");
    const result = await checkInProgressSessionCloseReadiness({
      sessionId: "session-1",
      organizationId: "org-1",
    });

    expect(result.ready).toBe(false);
    expect(result.requiredGoalIds).toEqual(["goal-1", "goal-2"]);
    expect(result.missingGoalIds).toEqual(["goal-2"]);
  });

  it("returns ready when linked note rows cover all required goal ids with non-empty notes", async () => {
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "session_goals") {
        return createFromResponse({
          data: [{ goal_id: "goal-a" }, { goal_id: "goal-b" }],
          error: null,
        });
      }
      if (table === "client_session_notes") {
        return createFromResponse({
          data: [
            { goal_notes: { "goal-a": "Goal A progress." } },
            { goal_notes: { "goal-b": "Goal B progress." } },
          ],
          error: null,
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const { checkInProgressSessionCloseReadiness } = await import("../sessionComplete");
    const result = await checkInProgressSessionCloseReadiness({
      sessionId: "session-2",
      organizationId: "org-1",
    });

    expect(result.ready).toBe(true);
    expect(result.missingGoalIds).toEqual([]);
  });
});
